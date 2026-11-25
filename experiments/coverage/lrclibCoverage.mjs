#!/usr/bin/env node
/**
 * How much of a real playlist already has SYNCED lyrics on LRCLIB — i.e. how often the app
 * needs an aligner at all. The question nothing in this repository had asked.
 *
 *   node experiments/coverage/lrclibCoverage.mjs <song-coverage.csv> [out.json]
 *
 * The CSV is the Weeb Bangers pipeline's output (playlist_position, song, artist, …,
 * source_url), whose source_url resolves each song to an LRCLIB record id. One request at a
 * time, ~350 ms apart, 10 s timeout, generic User-Agent (L51's pacing, nothing identifying).
 *
 * Prints song titles, artists and counts. Never a line of lyrics (ADR-0004).
 */
import { readFileSync, writeFileSync } from 'node:fs'

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

const songs = parseCsv(readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const out = []
for (const s of songs) {
  const id = (s.source_url || '').match(/get\/(\d+)/)?.[1]
  const base = { pos: s.playlist_position, song: s.song, artist: s.artist, id: id ?? null }
  if (!id) { out.push({ ...base, state: `no-lrclib-record:${s.status}` }); continue }
  let state = 'error'
  try {
    const res = await fetch(`https://lrclib.net/api/get/${id}`, {
      headers: { 'User-Agent': 'lrc-coverage-check/1.0' }, signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) state = res.status === 404 ? 'gone' : `http-${res.status}`
    else {
      const j = await res.json()
      state = j.instrumental ? 'instrumental'
        : j.syncedLyrics?.trim() ? 'synced'
          : j.plainLyrics?.trim() ? 'plain-only' : 'empty'
    }
  } catch (e) { state = `error-${e.name}` }
  out.push({ ...base, state })
  await sleep(350)
}
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(out, null, 1))
const synced = out.filter(r => r.state === 'synced').length
console.log(`${out.length} songs | synced ${synced} (${(100 * synced / out.length).toFixed(0)}%)`)
console.log(out.reduce((m, r) => (m[r.state.split(':')[0]] = (m[r.state.split(':')[0]] || 0) + 1, m), {}))
console.log('\nnot synced:')
for (const r of out.filter(r => r.state !== 'synced')) console.log(`  ${String(r.pos).padStart(3)} ${r.song} — ${r.artist} [${r.state}]`)
