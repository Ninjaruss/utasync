#!/usr/bin/env node
/**
 * Builds a benchmark corpus with KNOWN line onsets from the PJS Japanese singing corpus
 * (Koguchi & Takamichi, arXiv:2006.02959; CC BY-SA 4.0, commercial use allowed). No listening
 * pass needed: every PJS song is one sung sentence recorded solo, so its onset is measurable.
 *
 *   node experiments/phase0/pjs/buildCorpus.mjs <path to extracted PJS folder> [--per 6] [--bed <wav>] [--bed-db -6]
 *
 * For each group of --per songs it writes a "medley": the sentences concatenated with known
 * gaps, one lyric line per sentence. Outputs (all local, under .cache/pjs/):
 *   medley-NN.wav, lyrics-NN.txt
 *   (the annotation is NOT here: it goes to experiments/phase0/pjs/annotations/<id>.json, hash-only
 *   and committed; audio, lyric sheets and the manifest below stay local)
 *   lrc-NN.json     a synthetic catalogue LRC = truth + constant offset + jitter (seeded),
 *                   used only as the PRIOR for arm D, never as truth
 *   manifest.json   benchmarks/sync-style manifest for knownTextAlign.mjs / score.mjs --manifest
 *
 * Onset of each sentence, in order of preference:
 *   1. a phoneme label file (HTS mono .lab, "start end phoneme", 100 ns units): first non-silence phoneme
 *   2. energy onset on the solo recording: first 10 ms frame whose RMS exceeds
 *      max(8 × noise floor, 5% of peak) and stays above it for 50 ms
 * The method used is recorded per line. Lyrics come from the MusicXML <lyric><text> elements.
 *
 * --bed mixes a backing track under the medley (looped) to test robustness to accompaniment.
 * Use only openly licensed audio. Without --bed the singing is unaccompanied.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { buildAnnotation, annotationFileToCheck } from './annotation.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(2)
const src = args[0]
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const PER = Number(opt('--per', '6'))
const BED = opt('--bed', '')
const BED_DB = Number(opt('--bed-db', '-6'))
const OUT = resolve(root, opt('--out', '.cache/pjs'))
const ANN_DIR = join(root, 'experiments/phase0/pjs/annotations')
if (!src || !existsSync(src)) { console.error('usage: buildCorpus.mjs <PJS folder> [--per 6] [--bed file.wav]'); process.exit(2) }

const SR = 16000
const sha = (b) => createHash('sha256').update(b).digest('hex')
let seed = 20261104
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())

// ---------- find songs ----------
function walk(d) {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
const files = walk(src)
const songWavs = files.filter((p) => /_song\.wav$/i.test(p)).sort()
if (!songWavs.length) throw new Error('no *_song.wav files found under ' + src)

function lyricsFromXml(xmlPath) {
  const xml = readFileSync(xmlPath, 'utf8')
  const parts = [...xml.matchAll(/<lyric\b[^>]*>[\s\S]*?<text>([^<]*)<\/text>[\s\S]*?<\/lyric>/g)].map((m) => m[1].trim())
  return parts.join('')
}
function labelOnset(labPath) {
  for (const line of readFileSync(labPath, 'utf8').split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)/)
    if (!m) continue
    if (/^(pau|sil|br|cl)$/i.test(m[3])) continue
    return Number(m[1]) / 1e7
  }
  return null
}
function decode(path) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
}
function energyOnset(x) {
  const hop = SR / 100
  const rms = []
  for (let i = 0; i + hop <= x.length; i += hop) {
    let s = 0
    for (let k = 0; k < hop; k++) s += x[i + k] * x[i + k]
    rms.push(Math.sqrt(s / hop))
  }
  const sorted = [...rms].sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 1e-6
  const thr = Math.max(8 * floor, 0.05 * sorted.at(-1))
  for (let i = 0; i + 5 <= rms.length; i++) {
    if (rms.slice(i, i + 5).every((v) => v > thr)) return i / 100
  }
  return null
}

const songs = songWavs.map((wav) => {
  const dir = dirname(wav)
  const stem = basename(wav).replace(/_song\.wav$/i, '')
  const xml = files.find((p) => dirname(p) === dir && /\.(xml|musicxml)$/i.test(p))
  const lab = files.find((p) => basename(p).startsWith(stem) && /\.lab$/i.test(p) && !/full/i.test(p))
  const audio = decode(wav)
  let onset = lab ? labelOnset(lab) : null
  const method = onset != null ? 'phoneme-label' : 'energy'
  if (onset == null) onset = energyOnset(audio)
  const text = xml ? lyricsFromXml(xml) : ''
  return { id: stem, audio, onset, method, text }
}).filter((s) => s.onset != null && s.text)
console.log(`${songs.length} usable songs of ${songWavs.length} (label onsets: ${songs.filter((s) => s.method === 'phoneme-label').length})`)

// ---------- medleys ----------
mkdirSync(OUT, { recursive: true })
const bed = BED ? decode(BED) : null
const manifest = { schemaVersion: 1, source: 'PJS corpus (CC BY-SA 4.0), concatenated by buildCorpus.mjs', songs: [] }
for (let g = 0; g * PER < songs.length; g++) {
  const group = songs.slice(g * PER, g * PER + PER)
  if (group.length < 2) break
  const gaps = group.map((_, i) => (i === 0 ? 3.0 : 1.5 + 2.5 * rand())) // seconds of silence before each song
  const total = group.reduce((t, s, i) => t + gaps[i] + s.audio.length / SR, 0) + 2
  const mix = new Float32Array(Math.ceil(total * SR))
  const lines = []
  let t = 0
  group.forEach((s, i) => {
    t += gaps[i]
    mix.set(s.audio, Math.round(t * SR))
    lines.push({ text: s.text, onset: Number((t + s.onset).toFixed(3)), method: s.method, source: s.id })
    t += s.audio.length / SR
  })
  if (bed) {
    const gain = 10 ** (BED_DB / 20)
    for (let i = 0; i < mix.length; i++) mix[i] += gain * bed[i % bed.length]
  }
  let peak = 0
  for (const v of mix) peak = Math.max(peak, Math.abs(v))
  if (peak > 0.99) for (let i = 0; i < mix.length; i++) mix[i] *= 0.99 / peak

  const id = `pjs-medley-${String(g + 1).padStart(2, '0')}${bed ? '-bed' : ''}`
  const truthPath = join(ANN_DIR, `${id}.json`)
  annotationFileToCheck(truthPath) // before any output: never replace truth that is not corpus-onsets
  const wavPath = join(OUT, `${id}.wav`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-c:a', 'pcm_s16le', wavPath], { input: Buffer.from(mix.buffer) })
  const lyricsPath = join(OUT, `${id}.lyrics.txt`)
  writeFileSync(lyricsPath, lines.map((l) => l.text).join('\n') + '\n')
  const audioSha256 = sha(readFileSync(wavPath)), lyricsSha256 = sha(readFileSync(lyricsPath))

  // Synthetic catalogue LRC: one constant offset per medley plus per-line jitter, like a
  // human-tapped LRC. Prior only.
  const offset = 0.3 * (rand() < 0.5 ? -1 : 1) + 0.2 * gauss()
  const lrc = lines.map((l) => {
    const time = Math.max(0, l.onset + offset + 0.15 * gauss())
    const mm = String(Math.floor(time / 60)).padStart(2, '0'), ss = (time % 60).toFixed(2).padStart(5, '0')
    return `[${mm}:${ss}]${l.text}`
  }).join('\n')
  const lrcPath = join(OUT, `${id}.lrc.json`)
  writeFileSync(lrcPath, JSON.stringify({ syncedLyrics: lrc, plantedOffset: offset }, null, 2) + '\n')

  mkdirSync(ANN_DIR, { recursive: true })
  writeFileSync(truthPath, JSON.stringify(buildAnnotation({ lines, audioSha256, lyricsSha256 }), null, 2) + '\n')
  const rel = (p) => p.slice(root.length + 1)
  manifest.songs.push({
    id, split: 'development', audio: rel(wavPath), lyrics: rel(lyricsPath), audioSha256, lyricsSha256,
    reference: { kind: 'corpus-onsets', legacyPath: rel(lrcPath), annotationPath: rel(truthPath) },
  })
  console.log(`${id}: ${lines.length} lines, ${total.toFixed(1)} s, prior offset ${offset.toFixed(2)} s`)
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${manifest.songs.length} medleys and ${join(OUT, 'manifest.json')}`)
