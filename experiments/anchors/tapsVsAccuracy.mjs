#!/usr/bin/env node
/**
 * The simulation of experiments/anchors/2026-11-25-taps-vs-accuracy.md.
 * Reference = each song's catalogue LRC (a reference, NOT truth: L39, L62). Error is reported on
 * the UNTAPPED lines only. Prints ids, counts and seconds -- never lyric text (ADR-0004).
 */
import { readFileSync, readdirSync } from 'node:fs'
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const KS = [2, 3, 5, 8, 12]

/** Anchor indices: line 0 plus the k-1 lines with the largest preceding gap. */
function byGap(ref, k) {
  // Index 0 carries Infinity, so it is always chosen; taking the top k and sorting gives exactly
  // k anchors. (The first version added 0 separately, then sliced the sorted list, which could
  // drop the LAST anchor and made the curve non-monotonic.)
  const gaps = ref.map((t, i) => ({ i, g: i === 0 ? Infinity : t - ref[i - 1] })).sort((a, b) => b.g - a.g)
  return gaps.slice(0, k).map(x => x.i).sort((a, b) => a - b)
}
const everyNth = (ref, k) => Array.from({ length: k }, (_, n) => Math.round(n * (ref.length - 1) / (k - 1)))

/** Fill between anchors; weight = 1 per line (even) or the line's character count (by length). */
function interpolate(ref, anchors, weights) {
  const out = ref.slice()
  for (let a = 0; a < anchors.length - 1; a++) {
    const lo = anchors[a], hi = anchors[a + 1]
    if (hi - lo <= 1) continue
    const span = ref[hi] - ref[lo]
    const total = weights.slice(lo, hi).reduce((s, w) => s + w, 0)
    let acc = 0
    for (let i = lo + 1; i < hi; i++) { acc += weights[i - 1]; out[i] = ref[lo] + span * (acc / total) }
  }
  // after the last anchor, keep the song's median line gap rather than inventing a span
  const med = q(ref.map((t, i) => i === 0 ? null : t - ref[i - 1]).filter(Boolean), 0.5)
  for (let i = anchors[anchors.length - 1] + 1; i < out.length; i++) out[i] = out[i - 1] + med
  return out
}

const songs = []
for (const f of readdirSync('.cache/phase0/runs').filter(n => n.endsWith('.D-whisper-knowntext_lrc.json') && !n.includes('per4'))) {
  const run = JSON.parse(readFileSync(`.cache/phase0/runs/${f}`, 'utf8'))
  const L = run.lines.filter(l => l.priorKnown && l.prior != null)
  if (L.length < 15) continue
  songs.push({ id: run.song, ref: L.map(l => l.prior), len: L.map(l => Math.max(1, (l.original || '').length)) })
}

for (const pick of [{ name: 'tapped at the longest silences', f: byGap }, { name: 'tapped every nth line (control)', f: everyNth }]) {
  console.log(`\n### ${pick.name}\n`)
  console.log('| song | lines | ' + KS.map(k => `k=${k}`).join(' | ') + ' |')
  console.log('| --- | --- | ' + KS.map(() => '---').join(' | ') + ' |')
  for (const s of songs) {
    const cells = KS.map(k => {
      const anchors = pick.f(s.ref, k)
      const set = new Set(anchors)
      const best = ['even', 'len'].map(rule => {
        const w = rule === 'even' ? s.ref.map(() => 1) : s.len
        const got = interpolate(s.ref, anchors, w)
        const errs = s.ref.map((t, i) => set.has(i) ? null : Math.abs(got[i] - t)).filter(e => e != null)
        return { rule, within: 100 * errs.filter(e => e <= 1).length / errs.length, p90: q(errs, 0.9) }
      })
      const b = best.sort((x, y) => y.within - x.within)[0]
      return `${b.within.toFixed(0)}% ${b.rule}`
    })
    console.log(`| ${s.id} | ${s.ref.length} | ${cells.join(' | ')} |`)
  }
}
console.log('\n(cell = % of UNTAPPED lines within 1.0 s of the reference, and which rule won)')
