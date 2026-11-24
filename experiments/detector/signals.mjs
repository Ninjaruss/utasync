#!/usr/bin/env node
/**
 * Scores the candidate reliability signals of
 * experiments/detector/2026-11-25-reliability-signal.md against the LRC screen's labels.
 *
 * Labels are a falsifier, never truth (L62, ADR-0006). Prints song ids, line indices, counts
 * and seconds -- never lyric text (ADR-0004). Reads local runs in .cache/phase0/runs.
 */
import { readFileSync, readdirSync } from 'node:fs'

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const runFile = n => JSON.parse(readFileSync(`.cache/phase0/runs/${n}`, 'utf8'))
const SPACING_FACTOR = 3 // fixed in the pre-registration, before this file existed

const rows = []
for (const file of readdirSync('.cache/phase0/runs').filter(n => n.endsWith('.D-whisper-knowntext_lrc.json') && !n.includes('per4'))) {
  const run = runFile(file)
  const lines = run.lines.filter(l => l.priorKnown && l.prior != null)
  if (!lines.length) continue
  const med = q(lines.map(l => l.startTime - l.prior), 0.5)
  const starts = lines.map(l => l.startTime)
  const gaps = starts.map((t, i) => i === 0 ? null : t - starts[i - 1]).filter(g => g != null)
  const medGap = q(gaps.filter(g => g > 0), 0.5)
  // the shifted-prior runs, where they exist (arm C)
  const shifted = ['+0.8', '-0.8'].map(s => {
    const n = file.replace('_lrc.json', `_lrc${s}s.json`)
    try { return runFile(n).lines } catch { return null }
  }).filter(Boolean)
  lines.forEach((l, i) => {
    const err = Math.abs((l.startTime - l.prior) - med)
    const label = err > 2 ? 'catastrophe' : err <= 1 ? 'stable' : 'excluded'
    const prev = i === 0 ? null : starts[i - 1]
    const gap = prev == null ? null : l.startTime - prev
    rows.push({
      song: run.song, index: l.index, err, label,
      A: prev != null && l.startTime <= prev,
      B: gap != null && medGap > 0 && (gap > SPACING_FACTOR * medGap || gap < medGap / SPACING_FACTOR),
      C: shifted.length ? shifted.some(ls => { const m = ls.find(x => x.index === l.index); return m && Math.abs(m.startTime - l.startTime) > 0.25 }) : null,
      D: !!l.pinned,
    })
  })
}

const cat = rows.filter(r => r.label === 'catastrophe')
const stab = rows.filter(r => r.label === 'stable')
console.log(`dataset: ${rows.length} lines | catastrophes ${cat.length} | stable ${stab.length} | excluded ${rows.filter(r => r.label === 'excluded').length}\n`)
const arms = {
  'A order': r => r.A, 'B spacing': r => r.B, 'D pinned (baseline)': r => r.D, 'A or B': r => r.A || r.B,
}
console.log('| arm | recall (>=12 of 16) | false alarms (<=28 of 186) | verdict |')
console.log('| --- | --- | --- | --- |')
for (const [name, f] of Object.entries(arms)) {
  const rc = cat.filter(f).length, fa = stab.filter(f).length
  const pass = rc >= 12 && fa <= 28
  console.log(`| ${name} | ${rc} of ${cat.length} | ${fa} of ${stab.length} | ${pass ? '**PASS**' : 'FAIL'} |`)
}
// arm C on its own subset, as pre-registered
const sub = rows.filter(r => r.C != null)
const subCat = sub.filter(r => r.label === 'catastrophe'), subStab = sub.filter(r => r.label === 'stable')
const need = Math.ceil(0.75 * subCat.length), allow = Math.floor(0.15 * subStab.length)
const rc = subCat.filter(r => r.C).length, fa = subStab.filter(r => r.C).length
console.log(`\narm C (window-shift disagreement), its own subset of ${sub.length} lines from the songs with shifted runs:`)
console.log(`| arm | recall (>=${need} of ${subCat.length}) | false alarms (<=${allow} of ${subStab.length}) | verdict |`)
console.log('| --- | --- | --- | --- |')
console.log(`| C disagreement | ${rc} of ${subCat.length} | ${fa} of ${subStab.length} | ${rc >= need && fa <= allow ? '**PASS**' : 'FAIL'} |`)
console.log('\ncatastrophes, per line (index, centred error, which arms fired):')
for (const r of cat) console.log(`  ${r.song} line ${r.index}: ${r.err.toFixed(1)}s -> ${[r.A && 'A', r.B && 'B', r.C && 'C', r.D && 'D'].filter(Boolean).join('') || 'none'}`)
