#!/usr/bin/env node
/**
 * Phase 0 scorer. Reads .cache/phase0/runs/*.json and prints a markdown report.
 *
 * Two kinds of evidence, never mixed:
 *  1. ACCURACY — absolute line-start error against BLIND HUMAN onsets
 *     (benchmarks/sync/annotations/<song>.json, kind "human-onsets"). Only these may
 *     decide the Phase 0 gate. Draft marks are reported, but labelled draft.
 *     Section 2 states the gate's terms in numbers and its current verdict. A kind with
 *     fewer songs or lines than the gate requires prints a shortfall and NOT MET: a
 *     shortfall is a failure to evaluate, never a pass and never silence (ADR-0006).
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
import { lyricLines, assertAnnotationDescribesSheet } from '../../scripts/lib/syncBenchmark.mjs'
import { safeSkipReason } from '../../scripts/lib/corpusCoverage.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const argv = process.argv.slice(2)
const runsDir = resolve(root, argv.includes('--runs') ? argv[argv.indexOf('--runs') + 1] : '.cache/phase0/runs')
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

// ---------- the gate (ADR-0003, evidence terms restated 2026-11-06; every number: ledger L41) ----------
// Judgements, not measurements. L41 says what each rests on and what it is bracketed against.
const GATE = Object.freeze({
  withinSeconds: 0.25,
  fractionWithin: 0.85,
  maxUnflaggedSeconds: 1.0,
  perKind: Object.freeze({
    'corpus-onsets': Object.freeze({ title: 'corpus-onsets (PJS medleys)', songs: 10, accompanied: 3, lines: 60, linesPerSong: 0 }),
    'human-onsets': Object.freeze({ title: 'human-onsets (real accompanied songs)', songs: 2, accompanied: 0, lines: 50, linesPerSong: 20 }),
  }),
})
// Why a song's certifying truth may still not adjudicate the gate. Reported, never silent.
function gateIneligibility(ann) {
  const r = []
  if (ann.kind === 'human-onsets') { // blind and adjudicated, or it is a draft and certifies nothing
    if (ann.status !== 'adjudicated') r.push(`status is ${JSON.stringify(ann.status ?? null)}, not "adjudicated"`)
    if (ann.predictionsShown !== false) r.push('predictionsShown is not false')
    if (ann.priorPredictionExposure !== 'none') r.push('priorPredictionExposure is not "none"')
    if (!ann.reviewer?.trim()) r.push('no named reviewer')
  }
  const scored = (ann.lines ?? []).filter((l) => l.onset != null && !l.excluded)
  if (!scored.length) r.push('no scored lines')
  if (scored.some((l) => !(Number.isFinite(l.uncertainty) && l.uncertainty <= GATE.withinSeconds)))
    r.push(`a scored line's uncertainty exceeds ${GATE.withinSeconds} s, so the mark cannot adjudicate the threshold`)
  return r
}
// A PJS medley built with --bed carries a backing track; buildCorpus.mjs names it that way.
const accompanied = (song) => song.accompanied === true || /-bed$/.test(song.id)
const gateSongs = [] // one per certifying song that described its inputs; carries its arms' stats

const out = []
out.push(`# Phase 0 report\n\nGenerated ${new Date().toISOString()}. Arm D = Whisper-small known-text alignment (cross-attention DTW) in windows around a prior.\n`)

// ---------- 1. accuracy against human onsets ----------
out.push('## 1. Accuracy against blind human onsets\n')
const accRows = []
const skippedSongs = [] // annotations that do not describe their inputs: reported, never scored, never silent
annotated: for (const song of manifest.songs) {
  const annPath = resolve(root, song.reference?.annotationPath ?? '')
  if (!song.reference?.annotationPath || !existsSync(annPath)) continue
  const ann = JSON.parse(readFileSync(annPath, 'utf8'))
  // corpus-onsets (e.g. PJS medleys) are measured, not listened; reported separately by the marks column.
  if (!canCertify(ann.kind)) continue
  const skip = (reason) => skippedSongs.push({ id: song.id, reason })
  for (const k of ['audioSha256', 'lyricsSha256']) {
    if (ann[k] !== song[k]) { skip(`annotation ${k} differs from the manifest (rebuilt after annotating)`); continue annotated }
  }
  if (!song.lyrics) { skip('manifest has no lyrics path for this song'); continue }
  try {
    assertAnnotationDescribesSheet(ann, lyricLines(readFileSync(resolve(root, song.lyrics), 'utf8')), song.id)
  } catch (e) {
    // The wrapper prefixes the song id and safeSkipReason prefixes the error name; the list line already names the song.
    skip(safeSkipReason(e).replace(/^Error: /, '').replace(`${song.id}: `, ''))
    continue
  }
  const gate = { id: song.id, kind: ann.kind, accompanied: accompanied(song), ineligible: gateIneligibility(ann), arms: {} }
  gateSongs.push(gate)
  for (const run of runs.filter((r) => r.song === song.id && r.status === 'completed')) {
    if (run.audioSha256 !== song.audioSha256 || run.lyricsSha256 !== song.lyricsSha256) continue
    const cand = [['prior', priorOf(run)], [run.arm, starts(run)]]
    for (const [label, xs] of cand) {
      const errs = []; let missing = 0, nFlagged = 0, falseConfidence = 0, unflaggedOverMax = 0
      ann.lines.forEach((l, i) => {
        if (l.onset == null || l.excluded) return
        if (!Number.isFinite(xs[i])) { missing++; return }
        const e = Math.abs(xs[i] - l.onset)
        errs.push(e)
        if (label !== 'prior') {
          if (flagged(run.lines[i])) nFlagged++
          else {
            if (e > 0.5) falseConfidence++
            if (e > GATE.maxUnflaggedSeconds) unflaggedOverMax++
          }
        }
      })
      const n = errs.length + missing
      // Keyed by arm, so the gate section can pair D against A and B on these same lines.
      gate.arms[label === 'prior' ? `prior:${run.arm}` : run.arm] =
        { n, scored: errs.length, missing, within: errs.filter((e) => e <= GATE.withinSeconds).length, p90: q(errs, 0.9), unflaggedOverMax }
      const flagCols = label === 'prior' ? '— | —' : `${nFlagged} | ${falseConfidence}`
      accRows.push(`| ${song.id} | ${label === 'prior' ? `prior of ${run.arm}` : label} | ${ann.kind === 'corpus-onsets' ? 'corpus' : ann.status}${ann.kind === 'human-onsets' && ann.priorPredictionExposure === 'none' ? ', blind' : ''} | ${n} | ${pct(errs.filter((e) => e <= 0.25).length, n)} | ${pct(errs.filter((e) => e <= 0.5).length, n)} | ${f(med(errs))} | ${f(q(errs, 0.9))} | ${f(errs.length ? Math.max(...errs) : null)} | ${missing} | ${flagCols} |`)
    }
  }
}
if (accRows.length) {
  out.push('| song | arm | marks | lines | ≤0.25 s | ≤0.5 s | p50 s | p90 s | worst s | missing | flagged | unflagged >0.5 s (false confidence) |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  out.push(...accRows)
} else out.push('No song has both blind human onsets and a Phase 0 run yet. **The gate cannot be evaluated from this report.**')
if (skippedSongs.length) {
  out.push('\n**Skipped, not scored (annotation does not match its inputs):**\n')
  out.push(...skippedSongs.map((s) => `- ${s.id}: ${s.reason}`))
}

// ---------- 2. the gate ----------
// Every clause is checked per certifying kind and never pooled across kinds: PJS medleys are
// cheap and easy, real accompanied songs are the claim. A kind short of songs or lines is a
// shortfall and NOT MET -- never a pass, and never silence (ADR-0006 rule 3).
out.push('\n## 2. The gate (ADR-0003, evidence terms restated 2026-11-06)\n')
out.push(`Only \`human-onsets\` (blind: \`predictionsShown: false\`, \`priorPredictionExposure: "none"\`; adjudicated, reviewer named) and \`corpus-onsets\` certify (ADR-0006). Each kind must meet every clause on its own. Arm D = the primary run (\`@lrc\` where a catalogue LRC exists, else \`@run\`); arm B = that run's LRC prior; arm A = the current pipeline's own output, read from the prior of the \`@run\` run or from a run whose arm starts with \`A\`. Thresholds ${GATE.withinSeconds} s / ${Math.round(100 * GATE.fractionWithin)}% / ${f(GATE.maxUnflaggedSeconds, 1)} s are judgements, not measurements: ledger L41.\n`)

const primaryD = (g) => g.arms['D-whisper-knowntext@lrc'] ? 'D-whisper-knowntext@lrc' : g.arms['D-whisper-knowntext@run'] ? 'D-whisper-knowntext@run' : null
const armA = (g) => g.arms['prior:D-whisper-knowntext@run'] ?? g.arms[Object.keys(g.arms).find((k) => k.startsWith('A')) ?? '']
const armB = (g) => g.arms['prior:D-whisper-knowntext@lrc']
const unmet = [], shortOfEvidence = []
for (const [kind, need] of Object.entries(GATE.perKind)) {
  const all = gateSongs.filter((g) => g.kind === kind)
  const ok = all.filter((g) => !g.ineligible.length)
  const miss = [] // this kind's shortfalls, in the reader's words
  const scored = ok.filter((g) => primaryD(g))
  const nAcc = ok.filter((g) => g.accompanied).length
  const lines = scored.reduce((t, g) => t + g.arms[primaryD(g)].n, 0)
  const within = scored.reduce((t, g) => t + g.arms[primaryD(g)].within, 0)
  const overMax = scored.reduce((t, g) => t + g.arms[primaryD(g)].unflaggedOverMax, 0)
  const thin = scored.filter((g) => g.arms[primaryD(g)].n < need.linesPerSong)
  // Clause 3, paired on the same song and the same line indices. `applies` is the set of songs
  // the clause is about; a song in it with no comparison run is NOT EVALUATED, which is a
  // failure, never a tick. Where no song has a catalogue LRC the arm B clause is vacuous: ADR-0003.
  const cmp = (pick, label, applies) => {
    if (!scored.length) return { cell: 'not evaluated (no song has an arm D run)', bad: true, vacuous: true }
    if (!applies.length) return { cell: `not applicable (no gate song has a catalogue LRC, so arm ${label} does not exist)`, bad: false }
    const have = applies.filter((g) => pick(g))
    const beat = have.filter((g) => { const d = g.arms[primaryD(g)].p90, o = pick(g).p90; return d != null && o != null && d < o })
    const absent = applies.length - have.length
    if (!have.length) return { cell: `not evaluated (no arm ${label} run on any of ${applies.length} scored song(s))`, bad: true }
    return { cell: `${beat.length} of ${applies.length} song(s)${absent ? `, ${absent} with no arm ${label} run` : ''}`, bad: beat.length < applies.length }
  }
  const a = cmp(armA, 'A', scored), b = cmp(armB, 'B', scored.filter((g) => g.arms['D-whisper-knowntext@lrc']))
  if (ok.length < need.songs) miss.push(`${need.songs - ok.length} more certifying song(s)`)
  if (nAcc < need.accompanied) miss.push(`${need.accompanied - nAcc} more accompanied song(s)`)
  if (lines < need.lines) miss.push(`${need.lines - lines} more scored line(s)`)
  if (scored.length < ok.length) miss.push(`${ok.length - scored.length} certifying song(s) with no arm D run`)
  for (const g of thin) miss.push(`${g.id}: ${g.arms[primaryD(g)].n} scored lines, needs ${need.linesPerSong}`)
  const frac = lines ? within / lines : null
  if (frac == null) miss.push('no scored lines, so the accuracy clauses cannot be evaluated')
  else if (frac < GATE.fractionWithin) miss.push(`within ${GATE.withinSeconds} s is ${pct(within, lines)}, needs ${Math.round(100 * GATE.fractionWithin)}%`)
  if (overMax > 0) miss.push(`${overMax} unflagged line(s) over ${f(GATE.maxUnflaggedSeconds, 1)} s, needs 0`)
  if (a.bad && !a.vacuous) miss.push(`arm A comparison: ${a.cell}`)
  if (b.bad && !b.vacuous) miss.push(`arm B comparison: ${b.cell}`)
  // Evidence that does not exist yet, as opposed to evidence that exists and falls short.
  const evidenceShort = ok.length < need.songs || nAcc < need.accompanied || lines < need.lines || thin.length > 0 || scored.length < ok.length
  if (evidenceShort) shortOfEvidence.push(need.title)
  out.push(`### ${need.title} — **${miss.length ? 'NOT MET' : 'MET'}**\n`)
  out.push('| clause | required | observed |\n| --- | --- | --- |')
  out.push(`| certifying songs (eligible) | ≥ ${need.songs} | ${ok.length} |`)
  if (need.accompanied) out.push(`| of those, accompanied | ≥ ${need.accompanied} | ${nAcc} |`)
  out.push(`| scored lines, pooled | ≥ ${need.lines} | ${lines} |`)
  if (need.linesPerSong) out.push(`| scored lines per song | ≥ ${need.linesPerSong} | ${scored.length ? scored.map((g) => g.arms[primaryD(g)].n).join(', ') : '—'} |`)
  out.push(`| arm D starts within ${GATE.withinSeconds} s | ≥ ${Math.round(100 * GATE.fractionWithin)}% | ${pct(within, lines)} |`)
  out.push(`| unflagged lines over ${f(GATE.maxUnflaggedSeconds, 1)} s | 0 | ${scored.length ? overMax : '—'} |`)
  out.push(`| D p90 below arm A, per song | every song | ${a.cell} |`)
  out.push(`| D p90 below arm B, per song with an LRC | every such song | ${b.cell} |`)
  if (all.length > ok.length) {
    out.push('\n**Certifying truth present but not gate-eligible:**\n')
    out.push(...all.filter((g) => g.ineligible.length).map((g) => `- ${g.id}: ${g.ineligible.join('; ')}`))
  }
  out.push(`\n**Shortfall:** ${miss.length ? miss.join('; ') : 'none'}.\n`)
  if (miss.length) unmet.push(need.title)
}
out.push(unmet.length
  ? `**Verdict: NOT MET.** ${unmet.join(' and ')} ${unmet.length > 1 ? 'do' : 'does'} not meet the gate, so no branch of the pre-registered decision rule is triggered.${shortOfEvidence.length ? ` The shortfall in ${shortOfEvidence.join(' and ')} is evidence that does not exist yet: **the gate cannot be evaluated from this report.** A shortfall is a failure, never a pass (ADR-0006 rule 3).` : ''}`
  : '**Verdict: MET** on both certifying kinds. The pre-registered decision rule in ADR-0003 applies: D becomes the Android engine.')

// ---------- 3. diagnostics ----------
out.push('\n## 3. Diagnostics (no truth): is arm D anchored to the audio?\n')
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
// ---------- 4. do the reliability flags predict planted-offset failures? ----------
out.push('\n## 4. Reliability flags vs planted-offset failures (no truth)\n')
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
