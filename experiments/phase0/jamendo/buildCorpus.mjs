#!/usr/bin/env node
/**
 * Builds benchmark fixtures from the JamendoLyrics dataset (Durand, Stoller & Ewert,
 * ICASSP 2023; https://huggingface.co/datasets/jamendolyrics/jamendolyrics).
 *
 *   node experiments/phase0/jamendo/buildCorpus.mjs <path to jamendolyrics-src> [--out .cache/jamendo] [--uncertainty 0.2]
 *
 * WHY THIS CORPUS. The gate needs onsets that are neither our own output nor a catalogue
 * LRC. JamendoLyrics is real accompanied music whose line onsets were aligned by hand,
 * independently of this project, so it is evidence in a way an LRC is not (CLAUDE.md rule 1).
 * It is the only such source here with ACCOMPANIED audio: PJS medleys are solo sentences
 * separated by silence, which flatters an aligner (spec §8.4).
 *
 * WHAT IT IS NOT. These songs are English, French, German and Spanish — no Japanese. They
 * measure the timing machinery, not Japanese reading or pairing, so they cannot stand in for
 * the gate's real-J-pop half.
 *
 * Outputs, all local (audio and lyric text are never committed; ADR-0004, CLAUDE.md rule 6):
 *   <out>/<id>.mp3          a copy of the source audio
 *   <out>/<id>.lyrics.txt   the lyric sheet, one line per annotated line, in order
 *   <out>/<id>.truth.json   annotation, kind "corpus-onsets", per-line textHash (no text)
 *   <out>/manifest.json     a benchmarks/sync-style manifest for sync-benchmark / score.mjs
 *
 * The sheet is derived from the annotation CSV's own `lyrics_line` column rather than from the
 * dataset's separate lyrics file, so the sheet and the truth cannot disagree about how the song
 * is split into lines — the exact mismatch `assertAnnotationDescribesSheet` exists to catch.
 *
 * `--uncertainty` is per-line and gates `withinReferenceTolerance` and the gate's eligibility
 * rule, so it is a measured-or-declared constant: see the measurement ledger. It has no default
 * that could be inherited silently; pass it explicitly.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { hashLyricLine, LYRIC_HASH_VERSION } from '../../../scripts/lib/lyricHash.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(2)
const src = args[0]
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const OUT = resolve(root, opt('--out', '.cache/jamendo'))
const UNCERTAINTY = Number(opt('--uncertainty', 'NaN'))

if (!src || !existsSync(src)) {
  console.error('usage: buildCorpus.mjs <jamendolyrics folder> [--out .cache/jamendo] --uncertainty <seconds>')
  process.exit(2)
}
if (!Number.isFinite(UNCERTAINTY) || UNCERTAINTY <= 0) {
  console.error('--uncertainty <seconds> is required: it gates tolerance and gate eligibility, so it may not default silently. See the measurement ledger.')
  process.exit(2)
}

const sha = (b) => createHash('sha256').update(b).digest('hex')

/** Minimal RFC4180-ish parser: the lyric text may contain commas and quotes. */
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  const [header, ...rest] = rows.filter(r => r.length > 1 || r[0] !== '')
  return rest.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

/** The sheet and the onsets come from one source, so they cannot disagree. */
export function sheetAndOnsets(csvRows) {
  const kept = csvRows.filter(r => (r.lyrics_line ?? '').trim())
  const texts = kept.map(r => r.lyrics_line.trim())
  const onsets = kept.map(r => Number(r.start_time))
  if (onsets.some(o => !Number.isFinite(o) || o < 0)) throw new Error('non-finite or negative start_time')
  for (let i = 1; i < onsets.length; i++) if (onsets[i] < onsets[i - 1]) throw new Error(`onsets are not monotonic at line ${i + 1}`)
  return { texts, onsets }
}

export function buildAnnotation({ texts, onsets, audioSha256, lyricsSha256, uncertainty, songId }) {
  if (texts.length !== onsets.length) throw new Error('sheet/onset length mismatch')
  return {
    schemaVersion: 1,
    kind: 'corpus-onsets',
    status: 'adjudicated',
    reviewer: 'JamendoLyrics (Durand, Stoller & Ewert, ICASSP 2023)',
    predictionsShown: false,
    priorPredictionExposure: 'none',
    lineHashVersion: LYRIC_HASH_VERSION,
    audioSha256,
    lyricsSha256,
    song: songId,
    convention: 'line start as manually aligned by the JamendoLyrics annotators; uncertainty declared, not re-measured here',
    lines: texts.map((t, i) => ({
      textHash: hashLyricLine(t),
      onset: Number(onsets[i].toFixed(3)),
      uncertainty: UNCERTAINTY,
      excluded: false,
    })),
  }
}

const annDir = join(src, 'annotations', 'lines')
if (!existsSync(annDir)) throw new Error(`no annotations/lines under ${src}`)
mkdirSync(OUT, { recursive: true })

const manifest = {
  schemaVersion: 1,
  source: 'JamendoLyrics (CC-licensed Jamendo audio; per-song LicenseType in JamendoLyrics.csv), converted by jamendo/buildCorpus.mjs',
  target: { fractionWithinHalfSecond: 0.9, maxErrorSeconds: 2 },
  songs: [],
}

/**
 * The benchmark route only accepts `/^[a-z0-9-]+$/` (src/main.tsx), so a song whose id
 * carries uppercase or underscores can be staged but never run — the harness simply does
 * not start and you get the ordinary app. Slug every id here so that cannot happen.
 */
export function slugifySongId(name) {
  const slug = `jamendo-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!/^[a-z0-9-]+$/.test(slug) || !slug) throw new Error(`cannot slugify ${JSON.stringify(name)}`)
  return slug
}

for (const file of readdirSync(annDir).filter(f => f.endsWith('.csv')).sort()) {
  const sourceName = basename(file, '.csv')
  const id = slugifySongId(sourceName)
  const mp3 = join(src, 'mp3', `${sourceName}.mp3`)
  if (!existsSync(mp3)) { console.log(`skip ${id}: no audio downloaded`); continue }
  const audioBytes = readFileSync(mp3)
  // A symlink stub, not audio: the dataset stores the real file under subsets/<lang>/.
  if (audioBytes.length < 10_000) { console.log(`skip ${id}: audio looks like a pointer stub (${audioBytes.length} bytes)`); continue }

  const { texts, onsets } = sheetAndOnsets(parseCsv(readFileSync(join(annDir, file), 'utf8')))
  if (!texts.length) { console.log(`skip ${id}: no annotated lines`); continue }

  const audioOut = join(OUT, `${id}.mp3`)
  copyFileSync(mp3, audioOut)
  const sheet = texts.join('\n') + '\n'
  const lyricsOut = join(OUT, `${id}.lyrics.txt`)
  writeFileSync(lyricsOut, sheet)

  const audioSha256 = sha(readFileSync(audioOut)), lyricsSha256 = sha(sheet)
  const truthOut = join(OUT, `${id}.truth.json`)
  writeFileSync(truthOut, JSON.stringify(
    buildAnnotation({ texts, onsets, audioSha256, lyricsSha256, uncertainty: UNCERTAINTY, songId: id }), null, 2) + '\n')

  const rel = (p) => p.slice(root.length + 1)
  manifest.songs.push({
    id, split: 'development',
    // The dataset's own filename, kept so a row can be traced back to its source song.
    sourceName,
    audio: rel(audioOut), lyrics: rel(lyricsOut),
    audioSha256, lyricsSha256,
    reference: { kind: 'corpus-onsets', annotationPath: rel(truthOut) },
  })
  console.log(`${id}: ${texts.length} lines, onsets ${onsets[0].toFixed(2)}–${onsets.at(-1).toFixed(2)} s`)
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${manifest.songs.length} song(s) and ${join(OUT, 'manifest.json')} (uncertainty ${UNCERTAINTY} s)`)
