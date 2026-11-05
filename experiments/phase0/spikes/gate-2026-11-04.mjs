#!/usr/bin/env node
// Evaluates the pre-registered gate in 2026-11-04-prior-following.md. Prints no lyric text.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const run = (song, arm) => {
  const p = resolve(root, '.cache/phase0/runs', `${song}.${arm.replace(/[^a-zA-Z0-9.-]+/g, '_')}.json`)
  if (!existsSync(p)) throw new Error(`missing run ${song} ${arm}`)
  return JSON.parse(readFileSync(p, 'utf8')).lines.map((l) => l.startTime)
}
const SONGS = ['veil', 'guitar-loneliness', 'going-my-way']
const TARGETS = { veil: [0], 'guitar-loneliness': [0], 'going-my-way': [0, 12, 13, 24, 25, 26] }
const TOL = 0.25
const med = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

let fixed = 0, cases = 0, regressionOk = true, driftOk = true
const rows = []
for (const s of SONGS) {
  const b0 = run(s, 'D-whisper-knowntext@lrc'), f0 = run(s, 'D-whisper-knowntext~filler@lrc')
  const stableBase = new Set(b0.map((_, i) => i))
  for (const sh of ['+0.8s', '-0.8s']) {
    const b = run(s, `D-whisper-knowntext@lrc${sh}`), f = run(s, `D-whisper-knowntext~filler@lrc${sh}`)
    const baseRec = b.filter((x, i) => Math.abs(x - b0[i]) <= TOL).length / b.length
    const fillRec = f.filter((x, i) => Math.abs(x - f0[i]) <= TOL).length / f.length
    b.forEach((x, i) => { if (Math.abs(x - b0[i]) > TOL) stableBase.delete(i) })
    for (const i of TARGETS[s]) { cases++; if (Math.abs(f[i] - f0[i]) <= TOL) fixed++ }
    if (fillRec < baseRec - 0.02) regressionOk = false
    rows.push(`| ${s} | ${sh} | ${(100 * baseRec).toFixed(0)}% | ${(100 * fillRec).toFixed(0)}% |`)
  }
  const drift = med([...stableBase].map((i) => Math.abs(f0[i] - b0[i])))
  if (drift > 0.05) driftOk = false
  rows.push(`| ${s} | drift on baseline-stable lines | median ${drift.toFixed(3)} s | |`)
}
console.log('| song | shift | baseline recovered ≤0.25 s | filler recovered ≤0.25 s |\n| --- | --- | --- | --- |')
console.log(rows.join('\n'))
const fixOk = fixed >= 12
console.log(`\n1. Fix: ${fixed}/${cases} target cases recovered (need ≥12) → ${fixOk ? 'PASS' : 'FAIL'}`)
console.log(`2. No regression (≤2 pp per song/shift) → ${regressionOk ? 'PASS' : 'FAIL'}`)
console.log(`3. No silent drift (median ≤0.05 s) → ${driftOk ? 'PASS' : 'FAIL'}`)
console.log(`\nGATE: ${fixOk && regressionOk && driftOk ? 'PASS — adopt --filler' : 'FAIL — keep baseline; flag pinned lines instead'}`)
