/**
 * Alignment ablation harness (plan item W0.6).
 *
 * WHY. The project's own history is "eight rounds of tuner work while the largest error
 * term was never measured" (plan direction problem D1). Every knob here already exists in
 * the shipped code, and none of them had a single table showing what each one is worth
 * against human-synced truth. Without that, effort keeps going into whichever knob was
 * touched last.
 *
 * WHAT IT VARIES, all with the same truth frame (`scoreAgainstTruth`):
 *   - `mode`          word / segment / medium timestamps (where a fixture exists)
 *   - `passes`        ja-only single pass vs the mixed two-pass merge (where an EN
 *                     fixture exists) — this is the app's real choice for a mixed sheet
 *   - `prior`         no prior, or a prior perturbed by a constant dt. Simulates the case
 *                     that matters most: lyrics that already carry timings (a fetched
 *                     LRCLIB entry, an imported .lrc) which are a little out. This is the
 *                     measurement plan item W1.2 Layer 3 needs before the policy at
 *                     `alignmentPolicy.ts:42` can be changed — does reconciling against a
 *                     slightly-wrong prior beat aligning from scratch?
 *   - `labelHonesty`  the demotion pass on/off, to separate label changes from timing
 *                     changes (it is label-only, so timing columns should not move)
 *
 * METRICS are reported in the ABSOLUTE frame (offset preserved — see
 * scripts/lib/lrcTruth.mjs) plus the evidence partition, because the partition is what
 * says WHERE the error is: `nNoEvidence` lines the transcript could not reach at all,
 * versus `evP90` on the lines it could. In every config measured so far the first term
 * dominates, which is the single most useful fact this harness produces.
 *
 * Run: npx tsx scripts/align-ablation.mjs [--axis=prior]
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')

const { refineAlignmentWithPhrases } = await import(pathToFileURL(join(root, 'src/lyrics/phraseAlignment.ts')).href)
const { refineMixedLanguageAlignment } = await import(pathToFileURL(join(root, 'src/ai-pipeline/mixedLanguageAlign.ts')).href)
const { sanitizeTranscript } = await import(pathToFileURL(join(root, 'src/ai-pipeline/aligner.ts')).href)
const { computeLineMatchedSpans } = await import(pathToFileURL(join(root, 'src/ai-pipeline/contentAligner.ts')).href)
const { applyLrcPrior } = await import(pathToFileURL(join(root, 'src/lyrics/lrcPrior.ts')).href)
const { parseLrc, matchSheetToLrc, scoreAgainstTruth } = await import(
  pathToFileURL(join(root, 'scripts/lib/lrcTruth.mjs')).href
)

function loadWords(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const arr = Array.isArray(raw)
    ? raw.map((w) => ({ word: (w.word ?? '').trim(), startTime: w.startTime, endTime: w.endTime }))
    : (raw.chunks ?? []).map((c) => ({ word: c.text?.trim(), startTime: c.timestamp?.[0], endTime: c.timestamp?.[1] }))
  return arr.filter((w) => w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime))
}
const readLines = (p) => readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const f = (x, w = 5) => (x == null ? '  n/a' : x.toFixed(2).padStart(w))
const pc = (x) => (x == null ? ' n/a' : `${Math.round(x * 100)}%`.padStart(4))

/** Truth songs, with the transcript fixtures each one has. */
const SONGS = [
  {
    name: 'guitar-loneliness',
    lyrics: 'guitar-loneliness/lyrics.ja.txt',
    truth: 'lrc-truth/guitar-loneliness.json',
    lang: 'ja',
    transcripts: {
      word: 'guitar-loneliness/transcript.word.json',
      segment: 'guitar-loneliness/transcript.segment.json',
    },
  },
  {
    name: 'veil',
    lyrics: 'veil/lyrics.ja.txt',
    truth: 'lrc-truth/veil.json',
    lang: 'ja',
    transcripts: { word: 'veil/transcript.words.json' },
  },
  {
    name: 'stranger-than-heaven',
    lyrics: 'stranger-than-heaven/lyrics.txt',
    truth: 'lrc-truth/stranger-than-heaven.json',
    lang: 'mixed',
    transcripts: {
      word: 'stranger-than-heaven/transcript.word.json',
      segment: 'stranger-than-heaven/transcript.segment.json',
      'segment-medium': 'stranger-than-heaven/transcript.segment.medium.json',
    },
    transcriptEn: 'stranger-than-heaven/transcript.segment.forced-en.json',
  },
  {
    name: 'recollect',
    lyrics: 'recollect/lyrics.txt',
    truth: 'lrc-truth/recollect.json',
    lang: 'mixed',
    transcripts: {
      word: 'recollect/transcript.word.json',
      segment: 'recollect/transcript.segment.json',
    },
    transcriptEn: 'recollect/transcript.segment.forced-en.json',
  },
]

/** Simulated catalogue offsets, in seconds. 0 = a prior that is already exact; the rest
 * are the "a second or so out" band the policy at alignmentPolicy.ts:42 is about. */
const PRIOR_DELTAS = [0, 0.3, 0.7, 1.4, 2.5]

const argAxis = process.argv.find((a) => a.startsWith('--axis='))?.split('=')[1] ?? null

/**
 * Measure one variant. `priorDelta != null` sets each sheet row's startTime to
 * truth + delta before aligning — a prior as wrong as a real catalogue entry might be —
 * then reconciles with `applyLrcPrior`, exactly as AutoAlignFlow does.
 */
function measure(song, mode, { priorDelta = null, twoPass = false, labelHonesty = true } = {}) {
  const lineTexts = readLines(join(FIXTURES, song.lyrics))
  const lrc = JSON.parse(readFileSync(join(FIXTURES, song.truth), 'utf8'))
  const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))

  const sheetRows = lineTexts.map((original, i) => ({
    original,
    translation: '',
    startTime: priorDelta != null && truthTime[i] != null ? truthTime[i] + priorDelta : 0,
    endTime: 0,
  }))
  const priorTimes = sheetRows.map((r) => r.startTime)

  const jaWords = loadWords(join(FIXTURES, song.transcripts[mode]))
  let refined
  let scoredWords = jaWords
  if (twoPass && song.transcriptEn && existsSync(join(FIXTURES, song.transcriptEn))) {
    const enWords = loadWords(join(FIXTURES, song.transcriptEn))
    const mixed = refineMixedLanguageAlignment(sheetRows, jaWords, enWords)
    refined = mixed.refined
    scoredWords = mixed.transcriptWords
  } else {
    refined = refineAlignmentWithPhrases(sheetRows, jaWords, song.lang, undefined, { skipLabelHonesty: !labelHonesty })
  }

  // Layer 3 of plan W1.2: reconcile the aligned rows against the prior rather than
  // trusting either blindly. `usablePriorTimes` gates it exactly as the app does.
  if (priorTimes.some((t) => t > 0)) {
    const spansForPrior = computeLineMatchedSpans(lineTexts, sanitizeTranscript(scoredWords))
    refined = { ...refined, lines: applyLrcPrior(refined.lines, spansForPrior, priorTimes) }
  }

  const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(scoredWords))
  return { m: scoreAgainstTruth(refined.lines, spans, truthTime, { lineTexts }), mode: refined.mode }
}

const show = (label, r) => {
  const m = r.m
  console.log(
    `  ${label.padEnd(34)} ${r.mode.padEnd(11)} ` +
      `p50=${f(m.absP50)} p90=${f(m.absP90)} worst=${f(m.absWorst)} <=250ms=${pc(m.fracWithin250)} ` +
      `| evP90=${f(m.evP90)} noEv=${String(m.nNoEvidence).padStart(2)}`,
  )
}

if (!argAxis || argAxis === 'mode') {
  console.log('=== Axis 1: timestamp mode and pass structure (the app\'s own choices)\n')
  for (const song of SONGS) {
    console.log(`${song.name}`)
    for (const mode of Object.keys(song.transcripts)) {
      show(`${mode} ja-only`, measure(song, mode, { twoPass: false }))
      if (song.transcriptEn) show(`${mode} two-pass`, measure(song, mode, { twoPass: true }))
    }
    console.log()
  }
}

if (!argAxis || argAxis === 'prior') {
  console.log('=== Axis 2: reconciling against an already-timed prior (plan W1.2 Layer 3)')
  console.log('  Does starting from a prior that is "a second or so out" beat aligning from')
  console.log('  scratch? This is the measurement the policy at alignmentPolicy.ts:42 needs.\n')
  const summarise = []
  for (const song of SONGS) {
    console.log(`${song.name}`)
    for (const mode of Object.keys(song.transcripts)) {
      const scratch = measure(song, mode, { priorDelta: null, twoPass: !!song.transcriptEn })
      show(`${mode}: no prior (scratch)`, scratch)
      for (const dt of PRIOR_DELTAS) {
        const r = measure(song, mode, { priorDelta: dt, twoPass: !!song.transcriptEn })
        summarise.push({ song: song.name, mode, dt, p90: r.m.absP90, scratchP90: scratch.m.absP90, p50: r.m.absP50, scratchP50: scratch.m.absP50 })
        const verdict = r.m.absP90 < scratch.m.absP90 - 0.2 ? 'better' : r.m.absP90 > scratch.m.absP90 + 0.2 ? 'WORSE' : 'tie'
        show(`  prior +${dt.toFixed(1)}s → ${verdict}`, r)
      }
    }
    console.log()
  }
  // Aggregate: mean absP90 by prior delta, across song/mode pairs.
  const byDelta = new Map()
  for (const s of summarise) {
    if (!byDelta.has(s.dt)) byDelta.set(s.dt, { better: 0, tie: 0, worse: 0, p90: [] })
    const b = byDelta.get(s.dt)
    b.p90.push(s.p90)
    if (s.p90 < s.scratchP90 - 0.2) b.better++
    else if (s.p90 > s.scratchP90 + 0.2) b.worse++
    else b.tie++
  }
  console.log('=== Summary: outcome vs aligning from scratch, by prior error size')
  console.log('  prior err   mean absP90   better  tie  worse')
  for (const dt of PRIOR_DELTAS) {
    const b = byDelta.get(dt)
    if (!b) continue
    const mean = b.p90.reduce((x, y) => x + y, 0) / b.p90.length
    console.log(`  +${dt.toFixed(1)}s       ${f(mean)}       ${String(b.better).padStart(3)} ${String(b.tie).padStart(4)} ${String(b.worse).padStart(5)}`)
  }
  console.log('\n  A prior that is BETTER than scratch at every error size means verification and')
  console.log('  reconciliation of already-timed lyrics is worth doing; WORSE at small errors')
  console.log('  means a reconciliation pass can damage timings that were nearly right.')
}

if (!argAxis || argAxis === 'labels') {
  console.log('\n=== Axis 3: the label-honesty pass (label-only, so timing must not move)\n')
  for (const song of SONGS) {
    for (const mode of Object.keys(song.transcripts)) {
      const on = measure(song, mode, { labelHonesty: true, twoPass: !!song.transcriptEn })
      const off = measure(song, mode, { labelHonesty: false, twoPass: !!song.transcriptEn })
      const same =
        on.m.absP50 === off.m.absP50 && on.m.absP90 === off.m.absP90 && on.m.absWorst === off.m.absWorst
      console.log(
        `  ${`${song.name} ${mode}`.padEnd(34)} timing ${same ? 'unchanged (correct: label-only)' : '*** MOVED — it is not label-only ***'}` +
          ` noEv ${off.m.nNoEvidence}→${on.m.nNoEvidence}`,
      )
    }
  }
}
