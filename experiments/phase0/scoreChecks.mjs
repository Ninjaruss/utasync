import test from 'node:test'
import assert from 'node:assert/strict'
import { assertAnnotationDescribesSheet, lyricLines } from '../../scripts/lib/syncBenchmark.mjs'
import { hashLyricLine, LYRIC_HASH_VERSION } from '../../scripts/lib/lyricHash.mjs'
import { sampledLineIndices, samplingRuleDisagreement } from './sampling.mjs'

const ann = (texts) => ({ lineHashVersion: LYRIC_HASH_VERSION, lines: texts.map((t, i) => ({ textHash: hashLyricLine(t), onset: i + 1 })) })

test('a hashed annotation matching the sheet is accepted', () =>
  assert.doesNotThrow(() => assertAnnotationDescribesSheet(ann(['a', 'b']), ['a', 'b'], 'song')))

test('a re-split sheet is rejected by line count, naming the song', () =>
  assert.throws(() => assertAnnotationDescribesSheet(ann(['a', 'b']), ['a'], 'pjs-medley-01'), /pjs-medley-01/))

test('a changed line is rejected by index, and the message carries no text', () => {
  try { assertAnnotationDescribesSheet(ann(['a', 'b']), ['a', 'CHANGED'], 'song'); assert.fail('should throw') }
  catch (e) { assert.match(e.message, /line 2/); assert.ok(!e.message.includes('CHANGED')) }
})

test('repeated identical lines stay matched by index', () => {
  assert.doesNotThrow(() => assertAnnotationDescribesSheet(ann(['x', 'x']), ['x', 'x'], 'song'))
  assert.throws(() => assertAnnotationDescribesSheet(ann(['x', 'x', 'y']), ['x', 'y', 'x'], 'song'), /line 2/)
})

// ---- wiring: score.mjs must turn a mismatch into a visible skip line, never silence ----
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const scorer = resolve(dirname(fileURLToPath(import.meta.url)), 'score.mjs')
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const GATE = '**The gate cannot be evaluated from this report.**'
const HEADING = 'Skipped, not scored'

function report(songs) { // songs: [{ id, sheet|null, annotation, audioSha?, lyricsPath? }]
  const dir = mkdtempSync(join(tmpdir(), 'phase0-score-'))
  const entries = songs.map((s) => {
    const annPath = join(dir, `${s.id}.json`)
    writeFileSync(annPath, JSON.stringify({ kind: 'human-onsets', audioSha256: s.annAudio ?? 'A', lyricsSha256: 'L', ...s.annotation }))
    const lyrics = join(dir, `${s.id}.txt`)
    if (s.sheet != null) writeFileSync(lyrics, s.sheet)
    const e = { id: s.id, audioSha256: 'A', lyricsSha256: 'L', reference: { annotationPath: annPath } }
    if (!s.noLyricsPath) e.lyrics = lyrics
    return e
  })
  const manifest = join(dir, 'manifest.json')
  writeFileSync(manifest, JSON.stringify({ songs: entries }))
  const r = spawnSync('node', [scorer, '--manifest', manifest], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}
const hashedAnn = (texts) => ({ lineHashVersion: LYRIC_HASH_VERSION, lines: texts.map((t, i) => ({ textHash: hashLyricLine(t), onset: i + 1 })) })
const textAnn = (texts) => ({ lines: texts.map((t, i) => ({ text: t, onset: i + 1 })) })

test('score.mjs: a re-split sheet is a visible skip naming song and line, with no sheet text', () => {
  const out = report([{ id: 'resplit', sheet: 'zqxalpha\nzqxCHANGED\n', annotation: hashedAnn(['zqxalpha', 'zqxbeta']) }])
  assert.ok(out.includes(HEADING))
  assert.match(out, /- resplit: .*line 2/)
  assert.ok(!out.includes('zqx'))
  assert.ok(!out.includes('Error:') && !out.includes('resplit: resplit'))
})

test('score.mjs: a plain-text annotation mismatch never prints either side text', () => {
  const out = report([{ id: 'plain', sheet: 'zqxone\nzqxSHEET\n', annotation: textAnn(['zqxone', 'zqxANN']) }])
  assert.match(out, /- plain: .*line 2/)
  assert.ok(!out.includes('zqx'))
})

test('score.mjs: a missing lyrics file is a visible skip, path withheld', () => {
  const out = report([{ id: 'nosheet', sheet: null, annotation: hashedAnn(['a']) }])
  assert.match(out, /- nosheet: ENOENT/)
  assert.ok(!out.includes(tmpdir()))
})

test('score.mjs: a manifest entry without a lyrics path says so', () => {
  const out = report([{ id: 'nopath', noLyricsPath: true, annotation: hashedAnn(['a']) }])
  assert.match(out, /- nopath: manifest has no lyrics path/)
})

test('score.mjs: a differing audioSha256 is a visible skip naming the hash', () => {
  const out = report([{ id: 'rebuilt', sheet: 'a\n', annAudio: 'OTHER', annotation: hashedAnn(['a']) }])
  assert.match(out, /- rebuilt: annotation audioSha256 differs/)
})

test('score.mjs: when everything is skipped the gate sentence is still printed beside the list', () => {
  const out = report([{ id: 'one', sheet: 'a\nb\n', annotation: hashedAnn(['a']) }])
  assert.ok(out.includes(GATE))
  assert.ok(out.includes(HEADING))
})

test('score.mjs: a matching annotation is not in the skip list', () => {
  const out = report([{ id: 'healthy', sheet: 'a\nb\n', annotation: hashedAnn(['a', 'b']) }])
  assert.ok(!out.includes(HEADING))
  // Scoped to section 1 (the skip list) since the gate section was added: a song whose
  // annotation describes its inputs but is not blind/adjudicated is named there instead,
  // which the next assertion pins. Nothing about section 1 was loosened.
  assert.ok(!out.slice(out.indexOf('## 1.'), out.indexOf('## 2.')).includes('healthy'))
  assert.match(out, /- healthy: status is null, not "adjudicated".*no named reviewer/)
})

// ---- wiring: the gate section must state its terms and its verdict, and never pass on a shortfall ----
const blind = (texts, over = {}) => ({
  status: 'adjudicated', predictionsShown: false, priorPredictionExposure: 'none', reviewer: 'R',
  lineHashVersion: LYRIC_HASH_VERSION,
  lines: texts.map((t, i) => ({ textHash: hashLyricLine(t), onset: i + 1, uncertainty: 0.1 })), ...over,
})

test('score.mjs: the gate section states its numeric terms', () => {
  const out = report([{ id: 'eligible-one', sheet: 'a\nb\n', annotation: blind(['a', 'b']) }])
  assert.ok(out.includes('## 2. The gate'))
  for (const term of ['0.25 s', '85%', '1.0 s', '| certifying songs (eligible) | ≥ 2 |', '| scored lines, pooled | ≥ 50 |', '| scored lines per song | ≥ 20 |'])
    assert.ok(out.includes(term), `missing ${term}`)
})

test('score.mjs: one eligible song is a shortfall, NOT MET, and never a pass', () => {
  const out = report([{ id: 'eligible-one', sheet: 'a\nb\n', annotation: blind(['a', 'b']) }])
  assert.ok(out.includes('human-onsets (real accompanied songs) — **NOT MET**'))
  assert.match(out, /\*\*Shortfall:\*\*.*1 more certifying song\(s\)/)
  assert.match(out, /\*\*Shortfall:\*\*.*50 more scored line\(s\)/)
  assert.ok(out.includes('**Verdict: NOT MET.**'))
  assert.ok(out.includes('the gate cannot be evaluated from this report'))
  assert.ok(!out.includes('Verdict: MET'))
})

test('score.mjs: with no certifying song at all the gate is still stated and NOT MET', () => {
  const out = report([])
  assert.ok(out.includes('## 2. The gate'))
  assert.ok(out.includes('corpus-onsets (PJS medleys) — **NOT MET**'))
  assert.match(out, /\*\*Shortfall:\*\*.*10 more certifying song\(s\)/)
  assert.ok(out.includes('**Verdict: NOT MET.**'))
  assert.ok(!out.includes('Verdict: MET'))
})

test('score.mjs: a draft human-onsets annotation is reported as not gate-eligible, with the reason', () => {
  const out = report([{ id: 'draft-marks', sheet: 'a\n', annotation: blind(['a'], { status: 'draft' }) }])
  assert.ok(out.includes('Certifying truth present but not gate-eligible'))
  assert.match(out, /- draft-marks: status is "draft", not "adjudicated"/)
  assert.match(out, /\| certifying songs \(eligible\) \| ≥ 2 \| 0 \|/)
})

test('score.mjs: a mark coarser than the threshold cannot adjudicate it', () => {
  const ann = blind(['a']); ann.lines[0].uncertainty = 0.3
  const out = report([{ id: 'coarse-mark', sheet: 'a\n', annotation: ann }])
  assert.match(out, /- coarse-mark: a scored line's uncertainty exceeds 0.25 s/)
})

test('score.mjs: an unrun arm comparison is "not evaluated", never a tick', () => {
  const out = report([{ id: 'eligible-one', sheet: 'a\nb\n', annotation: blind(['a', 'b']) }])
  assert.match(out, /\| D p90 below arm A, per song \| every song \| not evaluated/)
  assert.match(out, /\| D p90 below arm B, per song with an arm B prior \| every such song \| not evaluated/)
})

// ---- the MET path and the clause arithmetic, on planted runs (--runs) ----
// Covers the direction the shortfall tests cannot: that a report CAN say MET, and that each
// clause flips it back when the numbers miss. Hashes: 'A'/'L', as report() writes them.
// One `groups` entry becomes one manifest, as in real use: benchmarks/sync holds the real songs
// and .cache/pjs/manifest.json the medleys, and one report must be able to cover both.
function gateReport({ songs, runs, kind = 'human-onsets', groups = [{ kind, songs }] }) {
  const dir = mkdtempSync(join(tmpdir(), 'phase0-gate-'))
  const runsDir = join(dir, 'runs')
  mkdirSync(runsDir)
  const args = []
  groups.forEach((group, gi) => {
    const entries = group.songs.map((s) => {
      const annPath = join(dir, `${s.id}.json`)
      writeFileSync(annPath, JSON.stringify({ kind: group.kind, audioSha256: 'A', lyricsSha256: 'L', ...s.annotation }))
      const lyrics = join(dir, `${s.id}.txt`)
      writeFileSync(lyrics, s.sheet)
      return { id: s.id, audioSha256: 'A', lyricsSha256: 'L', lyrics, reference: { annotationPath: annPath } }
    })
    const manifest = join(dir, `manifest-${gi}.json`)
    writeFileSync(manifest, JSON.stringify({ songs: entries }))
    args.push('--manifest', manifest)
  })
  for (const r of runs) writeFileSync(join(runsDir, `${r.song}.${r.arm.replace(/\W+/g, '_')}.json`), JSON.stringify({ status: 'completed', audioSha256: 'A', lyricsSha256: 'L', ...r }))
  const out = spawnSync('node', [scorer, ...args, '--runs', runsDir], { encoding: 'utf8' })
  assert.equal(out.status, 0, out.stderr)
  return out.stdout
}
// n lines, arm D off by `err` seconds, its prior (= arm A's output) off by `priorErr`.
const passing = (n, { err = 0.05, priorErr = 0.9, dErr } = {}) => {
  const texts = Array.from({ length: n }, (_, i) => `l${i}`)
  const mk = (id) => ({
    sheet: texts.join('\n') + '\n',
    annotation: { status: 'adjudicated', predictionsShown: false, priorPredictionExposure: 'none', reviewer: 'R', lineHashVersion: LYRIC_HASH_VERSION, lines: texts.map((t, i) => ({ textHash: hashLyricLine(t), onset: 10 + i, uncertainty: 0.1 })) },
    id,
  })
  const run = (song) => ({
    song, arm: 'D-whisper-knowntext@run',
    lines: texts.map((t, i) => ({ startTime: 10 + i + (dErr?.(i) ?? err), prior: 10 + i + priorErr, priorKnown: true, pinned: false })),
  })
  return { songs: [mk('song-a'), mk('song-b')], runs: [run('song-a'), run('song-b')] }
}

test('score.mjs: two blind songs of 20 lines pass every clause but the pooled line count', () => {
  const out = gateReport(passing(20))
  assert.match(out, /\| certifying songs \(eligible\) \| ≥ 2 \| 2 \|/)
  assert.match(out, /\| D p90 below arm A, per song \| every song \| 2 of 2 song\(s\) \|/)
  assert.match(out, /arm B.*not applicable \(no gate song has a catalogue LRC/)
  assert.match(out, /\*\*Shortfall:\*\* 10 more scored line\(s\)\./) // the only one left
  assert.ok(out.includes('human-onsets (real accompanied songs) — **NOT MET**'))
})

test('score.mjs: 25 lines a song clears the pooled line count, and the kind reads MET', () => {
  const out = gateReport(passing(25))
  assert.match(out, /\| scored lines, pooled \| ≥ 50 \| 50 \|/)
  assert.match(out, /\| arm D starts within 0.25 s \| ≥ 85% \| 100% \|/)
  assert.ok(out.includes('human-onsets (real accompanied songs) — **MET**'))
  assert.ok(out.includes('**Verdict: NOT MET.**')) // corpus-onsets still has nothing
})

test('score.mjs: 19 sampled lines a song misses the per-song minimum', () => {
  const out = gateReport(passing(19))
  assert.match(out, /\*\*Shortfall:\*\*.*song-a: 19 scored lines, needs 20/)
  assert.ok(out.includes('human-onsets (real accompanied songs) — **NOT MET**'))
})

test('score.mjs: one unflagged line over 1 s fails the kind, however good the rest', () => {
  const out = gateReport(passing(25, { dErr: (i) => (i === 0 ? 1.4 : 0.05) }))
  assert.match(out, /\| unflagged lines over 1.0 s \| 0 \| 2 \|/)
  assert.match(out, /\*\*Shortfall:\*\*.*2 unflagged line\(s\) over 1.0 s/)
  assert.ok(!out.includes('(real accompanied songs) — **MET**'))
})

test('score.mjs: D no better than arm A on p90 fails the comparison clause', () => {
  const out = gateReport(passing(25, { priorErr: 0.05 }))
  assert.match(out, /\| D p90 below arm A, per song \| every song \| 0 of 2 song\(s\) \|/)
  assert.ok(!out.includes('(real accompanied songs) — **MET**'))
})

test('score.mjs: a kind below 85% within the threshold fails it', () => {
  const out = gateReport(passing(25, { dErr: (i) => (i % 2 ? 0.05 : 0.4) }))
  assert.match(out, /\| arm D starts within 0.25 s \| ≥ 85% \| 48% \|/)
  assert.match(out, /\*\*Shortfall:\*\*.*within 0.25 s is 48%, needs 85%/)
})

// ---- the overall MET verdict: the branch that proves the gate can be passed at all ----
// Both kinds satisfied from one report over two manifests, as the owner would run it.
const lines = (n, id, onset0 = 10) => {
  const texts = Array.from({ length: n }, (_, i) => `${id}-l${i}`)
  return { texts, onsets: texts.map((_, i) => onset0 + i) }
}
function bothKindsPassing() {
  const songs = { corpus: [], human: [] }, runs = []
  const ann = (texts, onsets, unc) => ({ status: 'adjudicated', predictionsShown: false, priorPredictionExposure: 'none', reviewer: 'R', lineHashVersion: LYRIC_HASH_VERSION, lines: texts.map((t, i) => ({ textHash: hashLyricLine(t), onset: onsets[i], uncertainty: unc })) })
  // 10 PJS medleys at the builder's default 6 lines = 60 lines; 3 carry a backing track (-bed).
  for (let i = 1; i <= 10; i++) {
    const id = `pjs-medley-${String(i).padStart(2, '0')}${i <= 3 ? '-bed' : ''}`
    const { texts, onsets } = lines(6, id)
    songs.corpus.push({ id, sheet: texts.join('\n') + '\n', annotation: ann(texts, onsets, 0.02) })
    // D from the synthetic LRC prior (so arm B exists), and arm A as its own run.
    runs.push({ song: id, arm: 'D-whisper-knowntext@lrc', lines: texts.map((t, j) => ({ startTime: onsets[j] + 0.06, prior: onsets[j] + 0.7, priorKnown: true, pinned: false })) })
    runs.push({ song: id, arm: 'A-pipeline-live', lines: texts.map((t, j) => ({ startTime: onsets[j] + 0.5 })) })
  }
  // 2 real songs, 25 sampled lines each = 50; no catalogue LRC, so D runs from the app-run prior
  // and that prior IS arm A's output. Arm B does not exist for them.
  for (const id of ['real-song-a', 'real-song-b']) {
    const { texts, onsets } = lines(25, id)
    songs.human.push({ id, sheet: texts.join('\n') + '\n', annotation: ann(texts, onsets, 0.1) })
    runs.push({ song: id, arm: 'D-whisper-knowntext@run', lines: texts.map((t, j) => ({ startTime: onsets[j] + 0.08, prior: onsets[j] + 0.9, priorKnown: true, pinned: false })) })
  }
  return { groups: [{ kind: 'corpus-onsets', songs: songs.corpus }, { kind: 'human-onsets', songs: songs.human }], runs }
}

test('score.mjs: both kinds satisfied over two manifests prints Verdict: MET', () => {
  const out = gateReport(bothKindsPassing())
  const gate = out.slice(out.indexOf('## 2.'), out.indexOf('## 3.'))
  assert.ok(out.includes('**Verdict: MET**'), gate)
  assert.ok(!out.includes('Verdict: NOT MET'))
  assert.ok(gate.includes('corpus-onsets (PJS medleys) — **MET**'))
  assert.ok(gate.includes('human-onsets (real accompanied songs) — **MET**'))
  assert.match(gate, /\| certifying songs \(eligible\) \| ≥ 10 \| 10 \|/)
  assert.match(gate, /\| of those, accompanied \| ≥ 3 \| 3 \|/)
  assert.match(gate, /\| scored lines, pooled \| ≥ 60 \| 60 \|/)
  assert.match(gate, /\| scored lines, pooled \| ≥ 50 \| 50 \|/)
  assert.match(gate, /\| D p90 below arm A, per song \| every song \| 10 of 10 song\(s\) \|/)
  assert.match(gate, /\| D p90 below arm B, per song with an arm B prior \| every such song \| 10 of 10 song\(s\) \|/)
  assert.match(gate, /\*\*Shortfall:\*\* none\./)
})

test('score.mjs: one medley short of 10 takes the MET verdict away again', () => {
  const both = bothKindsPassing()
  const dropped = both.groups[0].songs.pop().id
  const out = gateReport({ ...both, runs: both.runs.filter((r) => r.song !== dropped) })
  assert.ok(out.includes('corpus-onsets (PJS medleys) — **NOT MET**'))
  assert.ok(out.includes('**Verdict: NOT MET.**'))
  assert.ok(!out.includes('**Verdict: MET**'))
})

test('score.mjs: a future arm named like an A is not read as arm A', () => {
  const both = bothKindsPassing()
  const runs = both.runs.map((r) => (r.arm === 'A-pipeline-live' ? { ...r, arm: 'Aligner-v2' } : r))
  const out = gateReport({ ...both, runs })
  assert.match(out, /\| D p90 below arm A, per song \| every song \| not evaluated \(no arm A run on any of 10 scored song\(s\)\) \|/)
  assert.ok(out.includes('corpus-onsets (PJS medleys) — **NOT MET**'))
})

test('score.mjs: a duplicate song id across manifests is reported, not double-counted', () => {
  const both = bothKindsPassing()
  const dup = both.groups[1].songs[0]
  const out = gateReport({ ...both, groups: [...both.groups, { kind: 'human-onsets', songs: [dup] }] })
  assert.match(out, new RegExp(`- ${dup.id}: duplicate song id in `))
  assert.match(out, /\| scored lines, pooled \| ≥ 50 \| 50 \|/)
  assert.ok(out.includes('**Verdict: MET**'))
})

test('score.mjs: the accompanied clause is printed for real songs too, marked not machine-checked', () => {
  const out = gateReport(bothKindsPassing())
  assert.match(out, /\| of those, accompanied \| all of them \| 0 detected by id; not machine-checked, the owner's to honour \|/)
})

// ---- the defect this report must not hide: lines arbitrarily wrong, but flagged ----
// The reviewer's own fixture. Clause 2 exempts a flagged line entirely and the 85%-within-0.25 s
// clause tolerates the rest, so both kinds still read MET — that is the gate's design, recorded in
// ADR-0003. What is NOT optional is that the exemption's size and the worst error PRINT, which is
// exactly what the verdict section used to drop on the floor (nFlagged computed, then discarded).
// These rows are reported, not clauses, so these assertions pin the numbers, never a verdict.
function flaggedButWildlyWrong({ wrong = 5, nWrong = 2 } = {}) {
  const songs = { corpus: [], human: [] }, runs = []
  const ann = (texts, onsets, unc) => ({ status: 'adjudicated', predictionsShown: false, priorPredictionExposure: 'none', reviewer: 'R', lineHashVersion: LYRIC_HASH_VERSION, lines: texts.map((t, i) => ({ textHash: hashLyricLine(t), onset: onsets[i], uncertainty: unc })) })
  const err = (j) => (j < nWrong ? wrong : 0.05) // the first nWrong lines of every song are hopeless
  for (let i = 1; i <= 10; i++) {
    const id = `pjs-medley-${String(i).padStart(2, '0')}${i <= 3 ? '-bed' : ''}`
    const { texts, onsets } = lines(20, id)
    songs.corpus.push({ id, sheet: texts.join('\n') + '\n', annotation: ann(texts, onsets, 0.02) })
    runs.push({ song: id, arm: 'D-whisper-knowntext@lrc', lines: texts.map((t, j) => ({ startTime: onsets[j] + err(j), prior: onsets[j] + 0.7, priorKnown: true, pinned: j < nWrong })) })
    runs.push({ song: id, arm: 'A-pipeline-live', lines: texts.map((t, j) => ({ startTime: onsets[j] + 0.5 })) })
  }
  for (const id of ['real-song-a', 'real-song-b']) {
    const { texts, onsets } = lines(25, id)
    songs.human.push({ id, sheet: texts.join('\n') + '\n', annotation: ann(texts, onsets, 0.1) })
    runs.push({ song: id, arm: 'D-whisper-knowntext@run', lines: texts.map((t, j) => ({ startTime: onsets[j] + err(j), prior: onsets[j] + 0.9, priorKnown: true, pinned: j < nWrong })) })
  }
  return { groups: [{ kind: 'corpus-onsets', songs: songs.corpus }, { kind: 'human-onsets', songs: songs.human }], runs }
}

test('score.mjs: flagged lines 5 s wrong are counted and printed, per kind, with the worst error', () => {
  const out = gateReport(flaggedButWildlyWrong())
  const gate = out.slice(out.indexOf('## 2.'), out.indexOf('## 3.'))
  const kind = (title) => gate.slice(gate.indexOf(`### ${title}`), gate.indexOf('**Shortfall:**', gate.indexOf(`### ${title}`)))
  const corpus = kind('corpus-onsets (PJS medleys)'), human = kind('human-onsets (real accompanied songs)')
  // 10 medleys x 20 lines, 2 flagged each; 2 real songs x 25 lines, 2 flagged each.
  assert.match(corpus, /\| flagged lines \(exempt from the clause above\) \| reported \| 20 of 200 \|/)
  assert.match(human, /\| flagged lines \(exempt from the clause above\) \| reported \| 4 of 50 \|/)
  assert.match(corpus, /\| worst scored line \| reported \| 5\.00 s \|/)
  assert.match(human, /\| worst scored line \| reported \| 5\.00 s \|/)
  assert.match(corpus, /\| missing predictions \(counted in "scored lines" above\) \| reported \| 0 \|/)
  // The mechanics that let this through, pinned so a reader of the report can see them.
  assert.match(corpus, /\| unflagged lines over 1\.0 s \| 0 \| 0 \|/)
  assert.match(corpus, /\| arm D starts within 0\.25 s \| ≥ 85% \| 90% \|/)
  assert.match(human, /\| arm D starts within 0\.25 s \| ≥ 85% \| 92% \|/)
  assert.ok(gate.includes('reported, not clauses'))
  assert.ok(gate.includes('wrong by any amount as long as the aligner flagged them'))
})

test('score.mjs: a clean report prints zero flagged and its real worst error', () => {
  const out = gateReport(bothKindsPassing())
  const gate = out.slice(out.indexOf('## 2.'), out.indexOf('## 3.'))
  assert.match(gate, /\| flagged lines \(exempt from the clause above\) \| reported \| 0 of 60 \|/)
  assert.match(gate, /\| worst scored line \| reported \| 0\.06 s \|/) // corpus-onsets: every line 0.06 s out
  assert.match(gate, /\| worst scored line \| reported \| 0\.08 s \|/) // human-onsets
})

test('score.mjs: missing predictions are counted in "scored lines" and printed as their own row', () => {
  const both = bothKindsPassing()
  // Drop the last prediction of one medley run: the line stays in the 85% denominator and fails
  // that clause, and the count of what the aligner never predicted now prints.
  const run = both.runs.find((r) => r.arm === 'D-whisper-knowntext@lrc')
  run.lines[run.lines.length - 1] = { startTime: null, prior: null, priorKnown: false }
  const out = gateReport(both)
  const gate = out.slice(out.indexOf('## 2.'), out.indexOf('## 3.'))
  assert.match(gate, /\| missing predictions \(counted in "scored lines" above\) \| reported \| 1 \|/)
  assert.match(gate, /\| scored lines, pooled \| ≥ 60 \| 60 \|/)
  assert.match(gate, /\| arm D starts within 0\.25 s \| ≥ 85% \| 98% \|/)
})

// ---- a run that does not match the manifest inputs is a reported skip, not a silent drop ----
test('score.mjs: a run whose input hashes differ from the manifest is reported, and not scored', () => {
  const both = bothKindsPassing()
  const runs = both.runs.map((r) => (r.song === 'real-song-a' ? { ...r, audioSha256: 'OTHER' } : r))
  const out = gateReport({ ...both, runs })
  assert.match(out, /- real-song-a D-whisper-knowntext@run: run audioSha256 differs from the manifest/)
  assert.match(out, /\*\*Shortfall:\*\*.*1 certifying song\(s\) with no arm D run/)
  assert.ok(!out.includes('**Verdict: MET**'))
})

// ---- ADR-0003's sampling rule is recomputed from the sheet, blank lines and all ----
test('sampledLineIndices: blocks are delimited by blank lines, and edges are always marked', () => {
  // Two blocks of 4 invented lines. Block-first and block-last of each, plus interior position 1.
  const sheet = 'a1\na2\na3\na4\n\nb1\nb2\nb3\nb4\n'
  const { total, blocks, marked } = sampledLineIndices(sheet, 4)
  assert.equal(total, 8)
  assert.equal(blocks, 2)
  assert.deepEqual([...marked], [0, 1, 3, 4, 5, 7])
})

test('sampledLineIndices: reading the sheet through lyricLines would lose the block structure', () => {
  const sheet = 'a1\na2\na3\na4\n\nb1\nb2\nb3\nb4\n'
  const asOneBlock = sampledLineIndices(lyricLines(sheet).join('\n'), 4)
  assert.notDeepEqual([...asOneBlock.marked], [0, 1, 3, 4, 5, 7]) // 4 and 7 are block edges only in the raw sheet
  assert.deepEqual([...asOneBlock.marked], [0, 1, 4, 7])
})

test('sampledLineIndices: step 5 tops up in sheet order, and a short sheet marks every line', () => {
  const nine = sampledLineIndices(Array.from({ length: 9 }, (_, i) => `l${i}`).join('\n'), 20)
  assert.equal(nine.marked.size, 9) // fewer lines than the minimum: all of them
  const thirty = sampledLineIndices(Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n'), 20)
  assert.equal(thirty.marked.size, 20)
  for (const i of [0, 29, 1, 4]) assert.ok(thirty.marked.has(i)) // edges and the rule's own interior picks
})

test('samplingRuleDisagreement: a whole-song marking agrees; a sample off the rule does not', () => {
  const sheet = 'a1\na2\na3\na4\n\nb1\nb2\nb3\nb4\n'
  const all = { lines: Array.from({ length: 8 }, (_, i) => ({ onset: i })) }
  assert.equal(samplingRuleDisagreement(sheet, all), null)
  // Exactly the rule's set at minimum 4: 0,1,3,4,5,7.
  const byRule = { lines: Array.from({ length: 8 }, (_, i) => ([0, 1, 3, 4, 5, 7].includes(i) ? { onset: i } : { onset: null, excluded: true })) }
  assert.equal(samplingRuleDisagreement(sheet, byRule, 4), null)
  // A block-last line dropped (the melisma case the rule exists to over-weight).
  const dropped = { lines: byRule.lines.map((l, i) => (i === 7 ? { onset: null, excluded: true } : l)) }
  assert.match(samplingRuleDisagreement(sheet, dropped, 4), /not scored \(line 8\)/)
  // A line scored that the rule does not select, with another excluded so it is a sample.
  const extra = { lines: byRule.lines.map((l, i) => (i === 2 ? { onset: 2 } : i === 1 ? { onset: null, excluded: true } : l)) }
  assert.match(samplingRuleDisagreement(sheet, extra, 4), /the rule does not select \(line 3\)/)
  // A hard line hidden by a null onset rather than `excluded` is caught too.
  const nulled = { lines: byRule.lines.map((l, i) => (i === 0 ? { onset: null } : l)) }
  assert.match(samplingRuleDisagreement(sheet, nulled, 4), /not scored \(line 1\)/)
})

test('score.mjs: a human-onsets song marked off the sampling rule is gate-ineligible, with the reason', () => {
  const texts = Array.from({ length: 30 }, (_, i) => `l${i}`)
  const annotation = {
    status: 'adjudicated', predictionsShown: false, priorPredictionExposure: 'none', reviewer: 'R',
    lineHashVersion: LYRIC_HASH_VERSION,
    // 20 lines marked, but the easy first 20 rather than the rule's block-edge sample.
    lines: texts.map((t, i) => ({ textHash: hashLyricLine(t), uncertainty: 0.1, ...(i < 20 ? { onset: 10 + i } : { onset: null, excluded: true }) })),
  }
  const out = report([{ id: 'off-rule', sheet: texts.join('\n') + '\n', annotation }])
  assert.match(out, /- off-rule: scored lines disagree with ADR-0003's sampling rule/)
  assert.match(out, /\| certifying songs \(eligible\) \| ≥ 2 \| 0 \|/)
})

test("score.mjs: the project's own marked song agrees with the rule as recomputed", () => {
  const ann = JSON.parse(readFileSync(resolve(repoRoot, 'benchmarks/sync/annotations/will-death-poetry.json'), 'utf8'))
  const sheet = readFileSync(resolve(repoRoot, 'benchmarks/sync/will-death-lyrics.txt'), 'utf8')
  assert.equal(samplingRuleDisagreement(sheet, ann), null)
  // 18 lines is below the gate's own per-song minimum, which is why ADR-0003 now states it.
  assert.ok(sampledLineIndices(sheet).total < 20)
})
