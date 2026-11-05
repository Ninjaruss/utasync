#!/usr/bin/env node
// Turns a local .lrc into a committable, hash-only annotation. Never writes or prints lyric text.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseLrc } from './lib/lrcParse.mjs'
import { hashLyricLine, LYRIC_HASH_VERSION } from './lib/lyricHash.mjs'
import { hash, lyricLines } from './lib/syncBenchmark.mjs'

const [id, lrcPath] = process.argv.slice(2)
if (!id || !lrcPath) {
  console.error('usage: node scripts/lrc-to-annotation.mjs <song-id> <path-to.lrc>')
  process.exit(2)
}
const fail = msg => { console.error(msg); process.exit(1) }

const manifest = JSON.parse(readFileSync('benchmarks/sync/manifest.json', 'utf8'))
const song = manifest.songs.find(s => s.id === id)
if (!song) fail(`no song "${id}" in benchmarks/sync/manifest.json`)
const out = song.reference?.annotationPath
if (!out) fail(`song "${id}" has no reference.annotationPath`)

let sheet
try { sheet = lyricLines(readFileSync(song.lyrics, 'utf8')) } catch { fail(`lyric sheet ${song.lyrics} is not available locally`) }
let rows
try { rows = parseLrc(readFileSync(lrcPath, 'utf8')) } catch (e) { fail(`cannot read or parse LRC: ${e.message}`) }
if (rows.length !== sheet.length) {
  fail(`LRC has ${rows.length} lyric lines but the lyric sheet has ${sheet.length}; not writing a mismatched annotation`)
}

const annotation = {
  kind: 'lrc-derived',
  lineHashVersion: LYRIC_HASH_VERSION,
  audioSha256: song.audioSha256,
  lyricsSha256: hash(readFileSync(song.lyrics)),
  lines: rows.map(r => ({ textHash: hashLyricLine(r.text), onset: r.timeSeconds, uncertainty: 0.3, excluded: false })),
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(annotation, null, 2) + '\n')
console.log(`wrote ${out}: ${rows.length} lines, kind lrc-derived`)
