#!/usr/bin/env node
/**
 * Phase 0, arm D: Whisper KNOWN-TEXT alignment, refined inside windows around a prior.
 *
 * The lyric text is known, so nothing is transcribed. For every sheet line we force the
 * decoder through [sot, lang, transcribe, notimestamps, <prev line>, <line>, <next line>]
 * on a <=30 s audio window placed around the PRIOR timings of those lines, and read the
 * line's start from the cross-attention DTW that transformers.js already implements
 * (WhisperForConditionalGeneration._extract_token_timestamps — the same alignment-head
 * method as openai/whisper `find_alignment` and stable-ts `align`).
 *
 * The window comes from the prior, never from this aligner's own output, so a bad line
 * cannot cascade into the next one (the independence rule from commit 8317b17).
 *
 * Priors:
 *   --prior lrc          the catalogue LRC stored in the legacy lrc-truth fixture (arm B)
 *   --prior run:<path>   a completed AutoAlignFlow benchmark run (arm A)
 *
 * Usage (repo root, no network needed — reads the transformers.js model cache):
 *   node experiments/phase0/knownTextAlign.mjs <songId> --prior lrc
 *   node experiments/phase0/knownTextAlign.mjs will-death-poetry --prior run:.cache/sync-benchmark/runs/<id>.json
 *
 * Output: .cache/phase0/runs/<songId>.<arm>.json. Never prints lyric text.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const songId = args[0]
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt }
const priorSpec = opt('--prior', 'lrc')
const modelId = opt('--model', 'Xenova/whisper-small')
const lang = opt('--lang', 'ja')
const limit = Number(opt('--limit', '0')) // debug: only the first N lines
// Planted-offset stress test: shift the prior by a known amount. A method that is anchored
// to the audio lands on the same positions whatever the shift; one that follows its
// prior moves with it.
const priorShift = Number(opt('--prior-shift', '0'))
// Text forced BEFORE the window's lines so the lead-in audio has a token to absorb it.
// Without it the first text token is pinned to the window start (spike 2026-11-04).
const filler = opt('--filler', '')
if (!songId) { console.error('usage: knownTextAlign.mjs <songId> --prior lrc|run:<path>'); process.exit(2) }

const SR = 16000
const MAX_WIN = 30
const LEAD = 1.0   // seconds of audio before the previous line's prior start
const TAIL = 0.5   // seconds after the line-after-next's prior start

// ---------- inputs (hash-checked against the frozen benchmark manifest) ----------
const sha = (b) => createHash('sha256').update(b).digest('hex')
// --manifest selects another corpus in the same format (e.g. .cache/pjs/manifest.json).
const manifest = JSON.parse(readFileSync(resolve(root, opt('--manifest', 'benchmarks/sync/manifest.json')), 'utf8'))
const song = manifest.songs.find((s) => s.id === songId)
if (!song) throw new Error(`unknown song ${songId}`)
if (song.split === 'heldout' && !args.includes('--heldout')) throw new Error('held-out song: pass --heldout explicitly')
const audioPath = resolve(root, song.audio)
const lyricsPath = resolve(root, song.lyrics)
if (sha(readFileSync(audioPath)) !== song.audioSha256) throw new Error('audio hash mismatch')
if (sha(readFileSync(lyricsPath)) !== song.lyricsSha256) throw new Error('lyrics hash mismatch')
const texts = readFileSync(lyricsPath, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)

// ---------- audio: ffmpeg does the resampling properly ----------
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', audioPath, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
const audio = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
const duration = audio.length / SR

// ---------- prior ----------
const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
function bigramSim(a, b) {
  const na = norm(a), nb = norm(b)
  if (na.length < 2 || nb.length < 2) return na && na === nb ? 1 : 0
  const g = new Map()
  for (let i = 0; i < na.length - 1; i++) { const k = na.slice(i, i + 2); g.set(k, (g.get(k) ?? 0) + 1) }
  let inter = 0
  for (let i = 0; i < nb.length - 1; i++) { const k = nb.slice(i, i + 2); const c = g.get(k) ?? 0; if (c) { inter++; g.set(k, c - 1) } }
  return inter / (Math.max(na.length, nb.length) - 1)
}
/** Monotonic sheet→LRC DP match (same shape as scripts/lib/lrcTruth.mjs, kept local so the
 * experiment imports nothing from the pipeline under test). */
function matchSheet(sheet, rows) {
  const n = sheet.length, m = rows.length
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  const ch = Array.from({ length: n + 1 }, () => new Int8Array(m + 1))
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    let best = dp[i - 1][j], c = 1
    if (dp[i][j - 1] > best) { best = dp[i][j - 1]; c = 2 }
    const s = bigramSim(sheet[i - 1], rows[j - 1].text)
    if (s >= 0.5 && dp[i - 1][j - 1] + s > best) { best = dp[i - 1][j - 1] + s; c = 3 }
    dp[i][j] = best; ch[i][j] = c
  }
  const out = new Array(n).fill(null)
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (ch[i][j] === 3) { out[i - 1] = rows[j - 1].time; i--; j-- } else if (ch[i][j] === 2) j--; else i--
  }
  return out
}
let prior, priorLabel
if (priorSpec === 'lrc') {
  const legacy = song.reference?.legacyPath
  if (!legacy || !legacy.endsWith('.json')) throw new Error('song has no stored catalogue LRC')
  const j = JSON.parse(readFileSync(resolve(root, legacy), 'utf8'))
  const rows = []
  for (const line of (j.syncedLyrics ?? '').split('\n')) {
    const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/)
    if (m && m[3].trim()) rows.push({ time: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() })
  }
  prior = matchSheet(texts, rows)
  priorLabel = 'lrc'
} else if (priorSpec.startsWith('run:')) {
  const run = JSON.parse(readFileSync(resolve(root, priorSpec.slice(4)), 'utf8'))
  if (run.song !== songId || run.status !== 'completed') throw new Error('prior run must be a completed run of this song')
  if (run.audioSha256 !== song.audioSha256 || run.lyricsSha256 !== song.lyricsSha256) throw new Error('prior run hash mismatch')
  prior = texts.map((t, i) => (run.lines?.[i]?.original === t && Number.isFinite(run.lines[i].startTime) ? run.lines[i].startTime : null))
  priorLabel = `run:${basename(priorSpec)}`
} else throw new Error('bad --prior')

if (priorShift) prior = prior.map((p) => (p == null ? null : Math.max(0, p + priorShift)))
// fill gaps by linear interpolation so every line has a window (marked as interpolated)
const priorKnown = prior.map((p) => p != null)
{
  const idx = prior.map((p, i) => (p != null ? i : -1)).filter((i) => i >= 0)
  if (idx.length < 2) throw new Error('prior covers fewer than 2 lines')
  for (let i = 0; i < prior.length; i++) {
    if (prior[i] != null) continue
    const a = [...idx].reverse().find((k) => k < i), b = idx.find((k) => k > i)
    if (a == null) prior[i] = Math.max(0, prior[b] - 3 * (b - i))
    else if (b == null) prior[i] = Math.min(duration - 1, prior[a] + 3 * (i - a))
    else prior[i] = prior[a] + ((prior[b] - prior[a]) * (i - a)) / (b - a)
  }
}

// ---------- model (local cache only; no network) ----------
// PHASE0_TRANSFORMERS lets the experiment use a platform-matched install of the same
// version (e.g. inside a Linux VM whose repo node_modules were installed on macOS).
const tfPath = process.env.PHASE0_TRANSFORMERS
  ? resolve(process.env.PHASE0_TRANSFORMERS, 'node_modules/@huggingface/transformers/dist/transformers.node.mjs')
  : '@huggingface/transformers'
const { AutoProcessor, AutoTokenizer, WhisperForConditionalGeneration, Tensor, env } = await import(tfPath)
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = resolve(root, 'node_modules/@huggingface/transformers/.cache') + '/'
const processor = await AutoProcessor.from_pretrained(modelId)
const tokenizer = await AutoTokenizer.from_pretrained(modelId)
const model = await WhisperForConditionalGeneration.from_pretrained(modelId, { dtype: 'q8' })
const gc = model.generation_config
const prefixIds = [gc.decoder_start_token_id, gc.lang_to_id[`<|${lang}|>`], gc.task_to_id.transcribe, gc.no_timestamps_token_id]
if (prefixIds.some((x) => !Number.isInteger(x))) throw new Error('could not resolve Whisper special tokens')
const enc = (t) => tokenizer.encode(t, { add_special_tokens: false })

/** Align `lineTexts` (consecutive sheet lines) inside [t0, t1]; returns each line's first-token time. */
async function alignWindow(t0, t1, lineTexts) {
  const slice = audio.subarray(Math.floor(t0 * SR), Math.min(audio.length, Math.floor(t1 * SR)))
  const { input_features } = await processor(slice)
  const ids = [...prefixIds], firstTok = []
  if (filler) ids.push(...enc(filler))
  for (const t of lineTexts) { firstTok.push(ids.length); ids.push(...enc(t)) }
  const out = await model.generate({
    inputs: input_features,
    decoder_input_ids: new Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    max_new_tokens: 1,
    return_token_timestamps: true,
    alignment_heads: gc.alignment_heads,
    num_frames: Math.floor((slice.length / SR) * 50),
  })
  const seq = Array.from(out.sequences.data, Number)
  for (let k = 0; k < ids.length; k++) if (seq[k] !== ids[k]) throw new Error('decoder did not keep the forced prefix')
  const ts = Array.from(out.token_timestamps.data)
  return firstTok.map((k) => t0 + ts[k])
}

// ---------- run ----------
const started = Date.now()
const n = limit > 0 ? Math.min(limit, texts.length) : texts.length
const lines = []
for (let i = 0; i < n; i++) {
  const a = Math.max(0, i - 1), b = Math.min(texts.length - 1, i + 1)
  const after = b + 1 < texts.length ? prior[b + 1] : Math.min(duration, prior[b] + 8)
  let t0 = Math.max(0, prior[a] - LEAD)
  let t1 = Math.min(duration, after + TAIL)
  let ctx = texts.slice(a, b + 1), pos = i - a
  if (t1 - t0 > MAX_WIN) { // too long: drop the previous line, then clamp
    ctx = texts.slice(i, b + 1); pos = 0
    t0 = Math.max(0, prior[i] - 3)
    t1 = Math.min(duration, t0 + MAX_WIN, after + TAIL)
  }
  if (t1 - t0 < 1) t1 = Math.min(duration, t0 + 4)
  const starts = await alignWindow(t0, t1, ctx)
  const start = starts[pos]
  // pinned: the start sits on the window edge, i.e. the line was the first text in its window and
  // DTW pinned it there. Such lines follow the prior instead of the audio (spike 2026-11-04).
  const pinned = start - t0 < 0.1
  // A pinned start is an artifact of where the window was cut, not a measurement, so the line
  // keeps its prior instead: never worse than the prior, which the pinned value usually is.
  // The raw value stays in alignedStart.
  const finalStart = pinned ? prior[i] : start
  lines.push({ index: i, original: texts[i], prior: prior[i], priorKnown: priorKnown[i], startTime: finalStart, alignedStart: start, shift: finalStart - prior[i], window: [t0, t1], pinned, fallback: pinned ? 'prior' : null })
  process.stdout.write(`line ${i + 1}/${n} shift ${(finalStart - prior[i]).toFixed(2)}s${pinned ? ' PINNED -> prior' : ''}\n`)
}
for (let i = 0; i < lines.length; i++) lines[i].endTime = i + 1 < lines.length ? lines[i + 1].startTime : duration

const arm = `D-whisper-knowntext${filler ? '~filler' : ''}@${priorLabel === 'lrc' ? 'lrc' : 'run'}${priorShift ? `${priorShift > 0 ? '+' : ''}${priorShift}s` : ''}`
const result = {
  runId: `${songId}.${arm}.${new Date().toISOString()}`,
  song: songId, workflow: 'phase0-knowntext', arm, prior: priorLabel, priorShift, model: modelId, dtype: 'q8', lang,
  audioSha256: song.audioSha256, lyricsSha256: song.lyricsSha256,
  status: n === texts.length ? 'completed' : 'partial',
  params: { LEAD, TAIL, MAX_WIN, context: 'prev+line+next', filler },
  elapsedSeconds: (Date.now() - started) / 1000, audioSeconds: duration,
  lines,
}
const outDir = resolve(root, '.cache/phase0/runs')
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, `${songId}.${arm.replace(/[^a-zA-Z0-9.-]+/g, '_')}.json`)
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
console.log(`done ${songId} ${arm}: ${n} lines in ${result.elapsedSeconds.toFixed(0)}s -> ${outPath}`)
