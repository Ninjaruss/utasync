#!/usr/bin/env node
/**
 * The LRC catastrophe screen. **This is not an accuracy measurement and cannot certify
 * anything** (ADR-0006, CLAUDE.md rule 1): a catalogue LRC carries ~0.3 s of its own
 * uncertainty (L39) and an unknown per-song offset, and it is arm D's own prior, so a small
 * |D - LRC| means only "D did not move far". What it CAN do is tell 0.3 s from 10 s.
 *
 *   node experiments/phase0/lrcScreen.mjs            # what D decides
 *   node experiments/phase0/lrcScreen.mjs --shipped  # after the pinned -> prior fallback (L38)
 *
 * Reads the local arm D runs in .cache/phase0/runs (not committed: they contain lyric text).
 * Prints song ids, line indices, counts and seconds -- never a line of lyrics (ADR-0004).
 *
 * Each song is centred on its own median signed shift, so a version or edit offset (stranger's
 * 237 s LRC against 233.57 s of audio) cannot be counted as alignment error.
 */
import { readFileSync, readdirSync } from 'node:fs'
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const f = n => n.toFixed(2)
const rows = []
const detail = []
for (const file of readdirSync('.cache/phase0/runs').filter(n => n.endsWith('.D-whisper-knowntext_lrc.json') && !n.includes('per4'))) {
  const run = JSON.parse(readFileSync(`.cache/phase0/runs/${file}`, 'utf8'))
  const lines = run.lines.filter(l => l.priorKnown && l.prior != null)
  if (!lines.length) continue
  // alignedStart is what D actually decided; startTime is after the pinned->prior fallback.
  const pick = process.argv.includes('--shipped') ? (l => l.startTime) : (l => l.alignedStart ?? l.startTime)
  const signed = lines.map(l => pick(l) - l.prior)
  const med = q(signed, 0.5)
  const raw = signed.map(Math.abs)
  const centred = signed.map(s => Math.abs(s - med))
  const over1 = lines.filter((l, i) => centred[i] > 1)
  const counts = new Map()
  for (const l of run.lines) counts.set(l.original, (counts.get(l.original) || 0) + 1)
  const big = lines.map((l, i) => ({ i: l.index, e: centred[i], dup: counts.get(l.original) > 1, pin: !!l.pinned })).filter(x => x.e > 2)
  detail.push(big.length
    ? `  ${run.song}: ${big.length} over 2 s | lines ${big.map(b => b.i).join(',')} | repeated text: ${big.filter(b => b.dup).length} | flagged: ${big.filter(b => b.pin).length} | errors ${big.map(b => b.e.toFixed(1)).join(', ')}`
    : `  ${run.song}: none over 2 s`)
  rows.push({
    song: run.song, n: lines.length, med,
    rawP50: q(raw, .5), rawP90: q(raw, .9),
    cP50: q(centred, .5), cP90: q(centred, .9), cMax: Math.max(...centred),
    over1: over1.length, over1flagged: over1.filter(l => l.pinned).length,
    over2: centred.filter(c => c > 2).length,
  })
}
console.log('| song | lines | median signed shift | centred p50 | centred p90 | worst | >1 s | of those flagged | >2 s |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of rows.sort((a, b) => b.cP90 - a.cP90)) {
  console.log(`| ${r.song} | ${r.n} | ${f(r.med)} s | ${f(r.cP50)} s | ${f(r.cP90)} s | ${f(r.cMax)} s | ${r.over1} | ${r.over1flagged} | ${r.over2} |`)
}
// The alibi for a big disagreement is that the LRC matched a repeated chorus line to the wrong
// occurrence. Checked rather than assumed: a line whose text appears more than once in the sheet
// is marked, so a reader can see how many of the outliers it could explain.
console.log('\nEvery line over 2 s, with the repeated-text alibi checked:')
for (const d of detail) console.log(d)
const all = rows.reduce((a, r) => a + r.n, 0), o1 = rows.reduce((a, r) => a + r.over1, 0)
console.log(`\npooled: ${all} lines, ${o1} over 1 s after centring (${(100 * o1 / all).toFixed(0)}%), ${rows.reduce((a, r) => a + r.over2, 0)} over 2 s`)
