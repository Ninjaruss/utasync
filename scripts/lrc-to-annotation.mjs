#!/usr/bin/env node
// Turns a local .lrc into a committable, hash-only annotation. Never writes or prints lyric text.
// The LRC supplies onsets only; textHash comes from the lyric SHEET, because the scorer matches by index against it.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLrc } from './lib/lrcParse.mjs'
import { hashLyricLine, LYRIC_HASH_VERSION } from './lib/lyricHash.mjs'
import { hash, lyricLines } from './lib/syncBenchmark.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [id, lrcPath, outArg] = process.argv.slice(2)
if (!id || !lrcPath) {
  console.error('usage: node scripts/lrc-to-annotation.mjs <song-id> <path-to.lrc> [output-path]')
  process.exit(2)
}
const fail = msg => { console.error(msg); process.exit(1) }

const manifest = JSON.parse(readFileSync(resolve(root, 'benchmarks/sync/manifest.json'), 'utf8'))
const song = manifest.songs.find(s => s.id === id)
if (!song) fail(`no song "${id}" in benchmarks/sync/manifest.json`)
if (typeof song.audioSha256 !== 'string' || !song.audioSha256) fail(`song "${id}" has no audioSha256 in the manifest`)
const out = outArg ? resolve(outArg) : song.reference?.annotationPath && resolve(root, song.reference.annotationPath)
if (!out) fail(`song "${id}" has no reference.annotationPath`)

// Never destroy hand-made truth: only create a new file or replace another lrc-derived one.
if (existsSync(out)) {
  let existing
  try { existing = JSON.parse(readFileSync(out, 'utf8')) } catch { fail(`${out} exists but is not readable JSON; refusing to overwrite`) }
  if (existing.kind !== 'lrc-derived') fail(`${out} already holds a "${existing.kind}" annotation; refusing to overwrite`)
}

let sheet
try { sheet = lyricLines(readFileSync(resolve(root, song.lyrics), 'utf8')) } catch { fail(`lyric sheet ${song.lyrics} is not available locally`) }
let rows
try { rows = parseLrc(readFileSync(lrcPath, 'utf8')) } catch (e) { fail(`cannot read or parse LRC: ${e.message}`) }
if (rows.length !== sheet.length) {
  fail(`LRC has ${rows.length} lyric lines but the lyric sheet has ${sheet.length}; not writing a mismatched annotation`)
}
for (let i = 0; i < rows.length; i++) {
  if (hashLyricLine(sheet[i]) !== hashLyricLine(rows[i].text)) {
    fail(`LRC line ${i + 1} (at ${rows[i].timeSeconds}s) does not match sheet line ${i + 1}; not writing a mismatched annotation`)
  }
}

const annotation = {
  kind: 'lrc-derived',
  lineHashVersion: LYRIC_HASH_VERSION,
  audioSha256: song.audioSha256,
  lyricsSha256: hash(readFileSync(resolve(root, song.lyrics))),
  // uncertainty 0.3 s gates withinReferenceTolerance/outsideInterval in scoreRun. It brackets the
// measured LRC-vs-singing offsets of +0.31 s and -0.36 s (ledger L30 / L36 arm D); it is not
// itself measured. See ledger L39.
lines: sheet.map((line, i) => ({ textHash: hashLyricLine(line), onset: rows[i].timeSeconds, uncertainty: 0.3, excluded: false })),
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(annotation, null, 2) + '\n')
console.log(`wrote ${out}: ${sheet.length} lines, kind lrc-derived`)
