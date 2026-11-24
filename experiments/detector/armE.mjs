#!/usr/bin/env node
/**
 * Arm E of experiments/detector/2026-11-25-reliability-signal.md, scored ONLY on the PJS
 * medleys, whose onsets are measured truth (phoneme labels, uncertainty 0.02 s) and which
 * played no part in finding the signal.
 *
 * E flags line i when the prior's gap before it is > GAP_FACTOR x the song's median prior gap
 * AND D's own gap before it is < COLLAPSE x the prior's. Both constants were fixed in the
 * pre-registration before this file existed.
 *
 * Prints ids, indices, counts and seconds only (ADR-0004).
 */
import { readFileSync } from 'node:fs'
const GAP_FACTOR = 2, COLLAPSE = 0.5
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

const man = JSON.parse(readFileSync('.cache/pjs-per4/manifest.json', 'utf8'))
let cat = [], stab = []
for (const s of man.songs) {
  const ann = JSON.parse(readFileSync(s.reference.annotationPath, 'utf8'))
  const run = JSON.parse(readFileSync(`.cache/phase0/runs/${s.id}.D-whisper-knowntext_lrc.json`, 'utf8'))
  const truth = (ann.lines || ann.onsets).filter(l => !l.excluded)
  const L = run.lines
  const priorGaps = L.map((l, i) => i === 0 ? null : l.prior - L[i - 1].prior).filter(g => g != null && g > 0)
  const medPrior = q(priorGaps, 0.5)
  truth.forEach((t, i) => {
    const l = L[i]; if (!l || t.onset == null) return
    const err = Math.abs(l.startTime - t.onset)
    const label = err > 2 ? cat : err <= 1 ? stab : null
    if (!label) return
    const pGap = i === 0 ? null : l.prior - L[i - 1].prior
    const dGap = i === 0 ? null : l.startTime - L[i - 1].startTime
    const fired = pGap != null && pGap > GAP_FACTOR * medPrior && dGap < COLLAPSE * pGap
    label.push({ song: s.id, index: l.index, err, fired, pinned: !!l.pinned })
  })
}
const rc = cat.filter(r => r.fired).length, fa = stab.filter(r => r.fired).length
const needR = Math.ceil(0.75 * cat.length), allowF = Math.floor(0.15 * stab.length)
console.log(`dataset: ${cat.length} catastrophes, ${stab.length} stable`)
console.log('| arm | recall (needed >= ' + needR + ') | false alarms (allowed <= ' + allowF + ') | verdict |')
console.log('| --- | --- | --- | --- |')
console.log(`| E gap inversion | ${rc} of ${cat.length} | ${fa} of ${stab.length} | ${rc >= needR && fa <= allowF ? '**PASS**' : 'FAIL'} |`)
console.log(`\nfor comparison, the product's existing flag on the same lines:`)
console.log(`| D pinned | ${cat.filter(r => r.pinned).length} of ${cat.length} | ${stab.filter(r => r.pinned).length} of ${stab.length} | |`)
console.log('\nmissed catastrophes (error, whether pinned):')
for (const r of cat.filter(r => !r.fired)) console.log(`  ${r.song} line ${r.index}: ${r.err.toFixed(1)}s${r.pinned ? ' (pinned)' : ''}`)
