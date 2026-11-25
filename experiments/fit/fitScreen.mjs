#!/usr/bin/env node
/**
 * Does an LRC belong to the audio it is about to be stored against?
 *
 *   node experiments/fit/fitScreen.mjs <song-coverage.csv>   # fetch (cached) + score
 *   node experiments/fit/fitScreen.mjs <song-coverage.csv> --score-only
 *
 * The gate is pre-registered in 2026-11-25-does-this-lrc-fit-this-song.md. Read it first.
 *
 * Matched pairs: each record's synced lyrics against its OWN declared duration.
 * Mismatched pairs: record X's lyrics against sibling record Y's duration, |dX - dY| >= 10 s —
 * the real failure, where the user's file is cut Y and the lyrics fetched are cut X.
 *
 * Records are cached under .cache/fit/ (gitignored). Prints ids, counts, times and seconds.
 * Never a line of lyrics (ADR-0004).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const CACHE = '.cache/fit'
const MISMATCH_SEC = 10 // the experiment's definition of "a different cut"; see the gate doc

/** Minimal RFC-4180 reader: the titles contain commas, and a naive split drops those rows. */
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const head = rows.shift()
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

/** The same grammar as android/align/Lrc.kt: repeated tags, [offset:], enhanced word tags. */
export function lrcTimes(source) {
  const TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)]/
  let offset = 0
  const times = []
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    const off = line.match(/^\[offset:\s*([+-]?\d+)\s*]/i)
    if (off) offset = Number(off[1]) / 1000
    let rest = line
    const here = []
    for (;;) {
      const m = TAG.exec(rest)
      if (!m || m.index !== 0) break
      here.push(Number(m[1]) * 60 + Number(m[2].replace(':', '.')))
      rest = rest.slice(m[0].length)
    }
    if (!here.length) continue
    if (!rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim()) continue
    for (const t of here) times.push(Math.max(0, t - offset))
  }
  return times.sort((a, b) => a - b)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const UA = { 'User-Agent': 'lrc-fit-check/1.0' }

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) })
  if (!res.ok) return null
  return res.json()
}

/** One cache file per song: its own record and its siblings, lyrics included (local only). */
async function fetchAll(songs) {
  mkdirSync(CACHE, { recursive: true })
  for (const s of songs) {
    const id = (s.source_url || '').match(/get\/(\d+)/)?.[1]
    if (!id) continue
    const path = `${CACHE}/${id}.json`
    if (existsSync(path)) continue
    const own = await getJson(`https://lrclib.net/api/get/${id}`)
    await sleep(350)
    const q = new URLSearchParams({ track_name: s.song, artist_name: s.artist })
    const siblings = await getJson(`https://lrclib.net/api/search?${q}`)
    await sleep(350)
    writeFileSync(path, JSON.stringify({ own, siblings: siblings ?? [] }))
    process.stderr.write('.')
  }
  process.stderr.write('\n')
}

/** One pair: lyric timestamps vs the duration of the audio they would be stored against. */
function pair(kind, songId, lyricId, times, audioSec, declaredSec) {
  return { kind, songId, lyricId, audioSec, declaredSec, n: times.length, times }
}

function buildPairs(songs) {
  const matched = [], mismatched = []
  for (const s of songs) {
    const id = (s.source_url || '').match(/get\/(\d+)/)?.[1]
    if (!id || !existsSync(`${CACHE}/${id}.json`)) continue
    const { own, siblings } = JSON.parse(readFileSync(`${CACHE}/${id}.json`, 'utf8'))
    if (!own?.syncedLyrics?.trim() || !(own.duration > 0)) continue
    const times = lrcTimes(own.syncedLyrics)
    if (times.length < 4) continue // nothing to say about a 3-line record either way
    matched.push(pair('matched', id, own.id, times, own.duration, own.duration))
    for (const sib of siblings) {
      if (!(sib.duration > 0) || sib.id === own.id) continue
      if (Math.abs(sib.duration - own.duration) < MISMATCH_SEC) continue
      mismatched.push(pair('mismatched', id, own.id, times, sib.duration, own.duration))
    }
  }
  return { matched, mismatched }
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]
}
const rate = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : 0)
const show = r => `${(100 * r).toFixed(0)}%`

const trailing = p => p.audioSec - p.times[p.times.length - 1]
const ratio = p => (p.times[p.times.length - 1] - p.times[0]) / p.audioSec

const csv = process.argv[2]
if (!csv) { console.error('usage: fitScreen.mjs <song-coverage.csv> [--score-only]'); process.exit(2) }
const songs = parseCsv(readFileSync(csv, 'utf8').replace(/^﻿/, ''))
if (!process.argv.includes('--score-only')) await fetchAll(songs)

const { matched, mismatched } = buildPairs(songs)
console.log(`pairs: ${matched.length} matched, ${mismatched.length} mismatched `
  + `(|dur diff| >= ${MISMATCH_SEC}s), over ${new Set(mismatched.map(p => p.songId)).size} songs`)

// Thresholds are read off the MATCHED population only, never tuned for recall.
const G = pct(matched.map(trailing), 95)
const LO = pct(matched.map(ratio), 2.5)
const HI = pct(matched.map(ratio), 97.5)
console.log(`thresholds from matched p95 / p2.5 / p97.5: G=${G.toFixed(1)}s `
  + `ratio=[${LO.toFixed(3)}, ${HI.toFixed(3)}]`)

const arms = {
  'A past the end': p => p.times.some(t => t > p.audioSec),
  'B trailing gap': p => trailing(p) > G,
  'D span ratio': p => ratio(p) < LO || ratio(p) > HI,
  'A or B': p => p.times.some(t => t > p.audioSec) || trailing(p) > G,
}
console.log('\narm              recall   false alarms   gate')
for (const [name, f] of Object.entries(arms)) {
  const r = rate(mismatched, f), fa = rate(matched, f)
  const pass = r >= 0.8 && fa <= 0.05
  console.log(`${name.padEnd(16)} ${show(r).padStart(5)}   ${show(fa).padStart(12)}   ${pass ? 'PASS' : 'fail'}`)
}

// Arm C (declared vs audio duration) is unevaluable here: the pairs are DEFINED by that
// difference, so it would score 100%/0% by construction. Reported, not counted.
console.log(`\narm C declared-duration gap is circular under this construction `
  + `(pairs are built from it): not evaluated.`)

const far = mismatched.filter(p => Math.abs(p.audioSec - p.declaredSec) >= 60)
console.log(`\nof the mismatched pairs, ${far.length} differ by >= 60 s (TV size vs full, say); `
  + `arm A catches ${show(rate(far, arms['A past the end']))} of those`)
const near = mismatched.filter(p => Math.abs(p.audioSec - p.declaredSec) < 30)
console.log(`${near.length} differ by < 30 s; arm A catches ${show(rate(near, arms['A past the end']))}, `
  + `A-or-B ${show(rate(near, arms['A or B']))}`)
