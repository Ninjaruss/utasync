#!/usr/bin/env node
/**
 * Phase 0 scorer. Reads .cache/phase0/runs/*.json and prints a markdown report.
 *
 * Two kinds of evidence, never mixed:
 *  1. ACCURACY — absolute line-start error against BLIND HUMAN onsets
 *     (benchmarks/sync/annotations/<song>.json, kind "human-onsets"). Only these may
 *     decide the Phase 0 gate. Draft marks are reported, but labelled draft.
 *  2. DIAGNOSTICS (no truth needed) — how much arm D moves its prior, whether it lands
 *     in the same place from two independent priors (catalogue LRC vs the app's own run),
 *     and whether it recovers a planted ±0.8 s prior offset. These say whether the method
 *     is anchored to the audio. They cannot say it is anchored to the RIGHT place.
 *
 * Never prints lyric text.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canCertify } from '../../scripts/lib/truthKinds.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runsDir = resolve(root, '.cache/phase0/runs')
const argv = process.argv.slice(2)
const manifestPath = argv.includes('--manifest') ? argv[argv.indexOf('--manifest') + 1] : 'benchmarks/sync/manifest.json'
const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8'))
const runs = existsSync(runsDir)
  ? readdirSync(runsDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(runsDir, f), 'utf8')))
  : []

const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] }
const med = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const f = (x, d = 2) => (x == null ? '—' : x.toFixed(d))
const pct = (k, n) => (n ? `${Math.round((100 * k) / n)}%` : '—')

function pairStats(a, b, keep = () => true) { // |a_i - b_i| over lines present in both
  const d = []
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i]) && keep(i)) d.push(Math.abs(a[i] - b[i]))
  }
  return { n: d.length, p50: med(d), p90: q(d, 0.9), within025: d.filter((x) => x <= 0.25).length, within05: d.filter((x) => x <= 0.5).length }
}
const starts = (run) => run.lines.map((l) => l.startTime)
const priorOf = (run) => run.lines.map((l) => (l.priorKnown ? l.prior : NaN))
// A line the aligner itself marks as unreliable: pinned to its window start, or moved when
// its window was nudged (knownTextAlign.mjs --stability). Absent fields = not flagged.
const PIN_SEC = 0.1
const isPinned = (line) => line?.pinned ?? (Array.isArray(line?.window) && line.startTime - line.window[0] < PIN_SEC)
const flagged = (line) => !!(isPinned(line) || line?.unstable)

const out = []
out.push(`# Phase 0 report\n\nGenerated ${new Date().toISOString()}. Arm D = Whisper-small known-text alignment (cross-attention DTW) in windows around a prior.\n`)

// ---------- 1. accuracy against human onsets ----------
out.push('## 1. Accuracy against blind human onsets\n')
const accRows = []
for (const song of manifest.songs) {
  const annPath = resolve(root, song.reference?.annotationPath ?? '')
  if (!song.reference?.annotationPath || !existsSync(annPath)) continue
  const ann = JSON.parse(readFileSync(annPath, 'utf8'))
  // corpus-onsets (e.g. PJS medleys) are measured, not listened; reported separately by the marks column.
  if (!canCertify(ann.kind) || ann.audioSha256 !== song.audioSha256 || ann.lyricsSha256 !== song.lyricsSha256) continue
  for (const run of runs.filter((r) => r.song === song.id && r.status === 'completed')) {
    if (run.audioSha256 !== song.audioSha256 || run.lyricsSha256 !== song.lyricsSha256) continue
    const cand = [['prior', priorOf(run)], [run.arm, starts(run)]]
    for (const [label, xs] of cand) {
      const errs = []; let missing = 0, nFlagged = 0, falseConfidence = 0
      ann.lines.forEach((l, i) => {
        if (l.onset == null || l.excluded) return
        if (!Number.isFinite(xs[i])) { missing++; return }
        const e = Math.abs(xs[i] - l.onset)
        errs.push(e)
        if (label !== 'prior') {
          if (flagged(run.lines[i])) nFlagged++
          else if (e > 0.5) falseConfidence++
        }
      })
      const n = errs.length + missing
      const flagCols = label === 'prior' ? '— | —' : `${nFlagged} | ${falseConfidence}`
      accRows.push(`| ${song.id} | ${label === 'prior' ? `prior of ${run.arm}` : label} | ${ann.kind === 'corpus-onsets' ? 'corpus' : ann.status}${ann.kind === 'human-onsets' && ann.priorPredictionExposure === 'none' ? ', blind' : ''} | ${n} | ${pct(errs.filter((e) => e <= 0.25).length, n)} | ${pct(errs.filter((e) => e <= 0.5).length, n)} | ${f(med(errs))} | ${f(q(errs, 0.9))} | ${f(errs.length ? Math.max(...errs) : null)} | ${missing} | ${flagCols} |`)
    }
  }
}
if (accRows.length) {
  out.push('| song | arm | marks | lines | ≤0.25 s | ≤0.5 s | p50 s | p90 s | worst s | missing | flagged | unflagged >0.5 s (false confidence) |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  out.push(...accRows)
} else out.push('No song has both blind human onsets and a Phase 0 run yet. **The gate cannot be evaluated from this report.**')

// ---------- 2. diagnostics ----------
out.push('\n## 2. Diagnostics (no truth): is arm D anchored to the audio?\n')
out.push('Movement = |D − prior| per line. Independence = |D from LRC prior − D from app-run prior|. Planted = |D with prior shifted ±0.8 s − D with the true prior|. Small independence and planted numbers mean D lands on the same audio position regardless of where it was told to look.\n')
out.push('| song | lines | median signed shift vs LRC s | movement p50 / p90 s | LRC vs app run p50 / p90 s | independence p50 / p90 s (≤0.25 s) | independence where priors agree within 1.5 s | planted +0.8 p50 / p90 s (≤0.25 s) | planted −0.8 p50 / p90 s (≤0.25 s) | time per line s |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const song of manifest.songs) {
  const by = (arm) => runs.find((r) => r.song === song.id && r.arm === arm && r.status === 'completed')
  const dl = by('D-whisper-knowntext@lrc'); if (!dl) continue
  const dr = by('D-whisper-knowntext@run'), dp = by('D-whisper-knowntext@lrc+0.8s'), dm = by('D-whisper-knowntext@lrc-0.8s')
  const shifts = dl.lines.filter((l) => l.priorKnown).map((l) => l.shift)
  const mv = shifts.map(Math.abs)
  const ind = dr ? pairStats(starts(dl), starts(dr)) : null
  const priorGap = dr ? pairStats(priorOf(dl), priorOf(dr)) : null
  // Lines where both priors put the window over the same singing: a fair convergence test.
  const near = dr ? pairStats(starts(dl), starts(dr), (i) => Math.abs(priorOf(dl)[i] - priorOf(dr)[i]) <= 1.5) : null
  const pp = dp ? pairStats(starts(dl), starts(dp)) : null
  const pm = dm ? pairStats(starts(dl), starts(dm)) : null
  const cell = (s) => (s ? `${f(s.p50)} / ${f(s.p90)} (${pct(s.within025, s.n)})` : '—')
  out.push(`| ${song.id} | ${dl.lines.length} | ${f(med(shifts))} | ${f(med(mv))} / ${f(q(mv, 0.9))} | ${priorGap ? `${f(priorGap.p50)} / ${f(priorGap.p90)}` : '—'} | ${cell(ind)} | ${near ? `${cell(near)}, n=${near.n}` : '—'} | ${cell(pp)} | ${cell(pm)} | ${f(dl.elapsedSeconds / dl.lines.length, 1)} |`)
}
// ---------- 3. do the reliability flags predict planted-offset failures? ----------
out.push('\n## 3. Reliability flags vs planted-offset failures (no truth)\n')
out.push('A planted failure = the line moved more than 0.25 s when the prior was shifted ±0.8 s. A useful flag catches most failures (recall) while flagging few stable lines.\n')
const flagRows = []
for (const song of manifest.songs) {
  for (const base of ['D-whisper-knowntext', 'D-whisper-knowntext~filler']) {
    const by = (arm) => runs.find((r) => r.song === song.id && r.arm === arm && r.status === 'completed')
    const b0 = by(`${base}@lrc`); if (!b0 || !b0.lines.some((l) => Array.isArray(l.window))) continue
    const shifted = [by(`${base}@lrc+0.8s`), by(`${base}@lrc-0.8s`)].filter(Boolean)
    if (!shifted.length) continue
    let tp = 0, fn = 0, fp = 0, tn = 0
    b0.lines.forEach((l, i) => {
      const failed = shifted.some((r) => Math.abs(r.lines[i].startTime - l.startTime) > 0.25)
      const fl = flagged(l)
      if (failed && fl) tp++; else if (failed) fn++; else if (fl) fp++; else tn++
    })
    flagRows.push(`| ${song.id} | ${base} | ${tp + fn} | ${tp} | ${fp} | ${tn} |`)
  }
}
if (flagRows.length) {
  out.push('| song | arm | planted failures | caught by flag | stable lines flagged | stable, unflagged |\n| --- | --- | --- | --- | --- | --- |')
  out.push(...flagRows)
} else out.push('No run carries reliability flags yet.')

out.push('\nRuns found: ' + runs.map((r) => `${r.song}:${r.arm}:${r.status}`).join(', '))
console.log(out.join('\n'))
