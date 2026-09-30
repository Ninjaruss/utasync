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
const { assessAlignmentTrust } = await import(pathToFileURL(join(root, 'src/ai-pipeline/alignmentTrust.ts')).href)
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

/**
 * MODEL axis. `whisper-medium` is the "High accuracy" opt-in, and this asks whether it should
 * be PROMOTED rather than left behind a toggle the auto-start flow never even shows.
 *
 * The measured case FOR it (ledger L13) is coverage: on stranger-than-heaven ja-only it removes
 * 7 lines' worth of evidence absence and cuts the evidence-backed p90 by 60%. The case AGAINST
 * it sits in the same table and is the reason this is measured before anything is promoted:
 *
 *   segment two-pass   small:  noEv 27  evP90 3.30  absP90 6.50
 *   segment-medium     medium: noEv 21  evP90 3.30  absP90 8.36   <- fewer holes, WORSE tail
 *
 * Fewer unverifiable lines and a worse 90th-percentile line at the same time. So "promote
 * medium" is not self-evidently right, and the only thing that could justify making it
 * automatic is the truth-free verdict ranking MODELS the way it demonstrably ranks timestamp
 * modes (3/3 songs). This axis measures whether it does — and its answer decides whether any
 * promotion gets wired at all.
 */
const MEDIUM_FIXTURES = {
  'stranger-than-heaven': {
    small: {
      word: 'stranger-than-heaven/transcript.word.json',
      segment: 'stranger-than-heaven/transcript.segment.json',
    },
    medium: {
      word: 'stranger-than-heaven/transcript.word.medium.json',
      segment: 'stranger-than-heaven/transcript.segment.medium.json',
    },
    transcriptEn: 'stranger-than-heaven/transcript.segment.forced-en.json',
  },
}

if (argAxis === 'model') {
  console.log('=== Axis 4: whisper-small vs whisper-medium, and does the VERDICT rank them right?\n')
  let agreeCount = 0
  let compared = 0
  for (const [name, cfg] of Object.entries(MEDIUM_FIXTURES)) {
    const song = SONGS.find((s) => s.name === name)
    if (!song) continue
    const lineTexts = readLines(join(FIXTURES, song.lyrics))
    const lrc = JSON.parse(readFileSync(join(FIXTURES, song.truth), 'utf8'))
    const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
    const rows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    const results = []
    for (const size of ['small', 'medium']) {
      for (const mode of ['word', 'segment']) {
        const tPath = cfg[size][mode]
        if (!existsSync(join(FIXTURES, tPath))) continue
        const ja = loadWords(join(FIXTURES, tPath))
        const en = cfg.transcriptEn ? loadWords(join(FIXTURES, cfg.transcriptEn)) : null
        let refined
        let scored = ja
        if (en) {
          const m = refineMixedLanguageAlignment(rows, ja, en)
          refined = m.refined
          scored = m.transcriptWords
        } else {
          refined = refineAlignmentWithPhrases(rows, ja, song.lang)
        }
        const sanitized = sanitizeTranscript(scored)
        const spans = computeLineMatchedSpans(lineTexts, sanitized)
        const m = scoreAgainstTruth(refined.lines, spans, truthTime, { lineTexts })
        const trust = assessAlignmentTrust({
          lines: refined.lines, spans, words: sanitized, quality: refined.lineAlignmentQuality,
        })
        results.push({ size, mode, m, trust })
        console.log(
          `  ${name} ${size.padEnd(6)} ${mode.padEnd(7)} ${en ? '2-pass ' : 'ja-only'}` +
            ` absP50=${f(m.absP50)} absP90=${f(m.absP90)} worst=${f(m.absWorst)} <=250ms=${pc(m.fracWithin250)}` +
            ` | evP90=${f(m.evP90)} noEv=${String(m.nNoEvidence).padStart(2)}` +
            ` | verdict verifiedShare=${(trust.verifiedShare * 100).toFixed(0)}% noEvidenceShare=${(trust.noEvidenceShare * 100).toFixed(0)}%`,
        )
      }
    }
    for (const mode of ['word', 'segment']) {
      const pair = results.filter((r) => r.mode === mode)
      if (pair.length < 2) continue
      const byVerdict = [...pair].sort((a, b) => b.trust.verifiedShare - a.trust.verifiedShare)[0]
      const byTruth = [...pair].sort((a, b) => a.m.absP90 - b.m.absP90)[0]
      const agree = byVerdict.size === byTruth.size
      compared++
      if (agree) agreeCount++
      console.log(
        `  ${name} ${mode}: verdict picks ${byVerdict.size.padEnd(6)} (verifiedShare ${(byVerdict.trust.verifiedShare * 100).toFixed(0)}%)` +
          ` | truth picks ${byTruth.size.padEnd(6)} (absP90 ${f(byTruth.m.absP90)})  ${agree ? 'AGREE' : 'DISAGREE — do not automate this'}`,
      )
    }
    console.log()
  }
  console.log(`  ${agreeCount}/${compared} comparisons agree. A disagreement means the verdict must NOT`)
  console.log('  be used to choose the model, whatever the coverage argument for medium looks like.')
}
