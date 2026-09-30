/**
 * Per-line signed error profile vs human-synced LRC truth, with a drift fit.
 *
 * WHY THIS EXISTS. `src/ai-pipeline/alignTimestampMode.ts` documents a word-mode
 * failure as "a late ramp from line #31 onward (+24s decaying to +2s), i.e. a
 * transcript time-domain artifact the aligner then follows". That was measured on the
 * isolated vocal stem of the e2e fixture, which is NOT in the repository
 * (`public/e2e/` is gitignored), so the claim could not be checked by anyone else.
 *
 * This instrument is what checks it, and it is the gate the plan's W1.1.1 (transcript
 * ramp repair) depends on: a repair for a drift you cannot demonstrate is a fix with no
 * instrument that could verify it, which is the failure pattern the whole accuracy plan
 * exists to break.
 *
 * FINDING (2026-09-28): the ramp is NOT in any committed fixture. Evidence-backed drift
 * slopes are -0.002 (guitar word), +0.003 (veil), +0.005 (guitar segment) and -0.013
 * (stranger word two-pass, the app path) seconds per line — i.e. no meaningful drift.
 * The largest structural movement, stranger word ja-only lines #31-#50, sits entirely on
 * lines whose matched-span coverage is BELOW the evidence floor: those are interpolated
 * across the alternate-take evidence desert, not a transcript time-domain defect. So
 * W1.1.1 is blocked on committed audio (plan W0.5) and must not be attempted before it.
 *
 * Reading the output: each cell is the signed error in whole seconds (ours minus truth),
 * `.` = no truth for that line, and a parenthesised number marks a line with NO usable
 * transcript evidence (<0.5 matched-span coverage) — those values come from interpolation
 * between anchors, so a drift through them says nothing about the transcript's clock.
 *
 * Run: npx tsx scripts/align-drift-profile.mjs
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
const { parseLrc, matchSheetToLrc, EVIDENCE_MIN_COVERAGE } = await import(
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

/** Minimum evidence-backed lines before a drift is fitted at all. With fewer, a robust
 * slope is still just noise with a number attached. */
const MIN_FIT_LINES = 12
/** Drift is only worth reporting when it accumulates to this across the song: a tenth of
 * a second per line sounds alarming and is inaudible. */
const MIN_TOTAL_DRIFT_S = 1.0

const SONGS = [
  { name: 'guitar word (version-exact)', lyrics: 'guitar-loneliness/lyrics.ja.txt', truth: 'lrc-truth/guitar-loneliness.json', lang: 'ja', t: 'guitar-loneliness/transcript.word.json' },
  { name: 'guitar segment', lyrics: 'guitar-loneliness/lyrics.ja.txt', truth: 'lrc-truth/guitar-loneliness.json', lang: 'ja', t: 'guitar-loneliness/transcript.segment.json' },
  { name: 'stranger word ja-only', lyrics: 'stranger-than-heaven/lyrics.txt', truth: 'lrc-truth/stranger-than-heaven.json', lang: 'ja', t: 'stranger-than-heaven/transcript.word.json' },
  { name: 'stranger word two-pass (app path)', lyrics: 'stranger-than-heaven/lyrics.txt', truth: 'lrc-truth/stranger-than-heaven.json', lang: 'mixed', t: 'stranger-than-heaven/transcript.word.json', en: 'stranger-than-heaven/transcript.segment.forced-en.json' },
  { name: 'stranger segment two-pass', lyrics: 'stranger-than-heaven/lyrics.txt', truth: 'lrc-truth/stranger-than-heaven.json', lang: 'mixed', t: 'stranger-than-heaven/transcript.segment.json', en: 'stranger-than-heaven/transcript.segment.forced-en.json' },
  { name: 'veil word (pure JA)', lyrics: 'veil/lyrics.ja.txt', truth: 'lrc-truth/veil.json', lang: 'ja', t: 'veil/transcript.words.json' },
  { name: 'recollect word two-pass', lyrics: 'recollect/lyrics.txt', truth: 'lrc-truth/recollect.json', lang: 'mixed', t: 'recollect/transcript.word.json', en: 'recollect/transcript.segment.forced-en.json' },
]

console.log('Signed error per line (ours - truth), whole seconds; parenthesised = no usable')
console.log('transcript evidence, so the value is interpolated and says nothing about the')
console.log('transcript clock. A drift fit is reported on evidence-backed lines only.\n')

for (const s of SONGS) {
  const lineTexts = readLines(join(FIXTURES, s.lyrics))
  const lrc = JSON.parse(readFileSync(join(FIXTURES, s.truth), 'utf8'))
  const truthTime = matchSheetToLrc(lineTexts, parseLrc(lrc.syncedLyrics))
  const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
  const ja = loadWords(join(FIXTURES, s.t))
  let refined
  let scored = ja
  if (s.en && existsSync(join(FIXTURES, s.en))) {
    const m = refineMixedLanguageAlignment(sheetRows, ja, loadWords(join(FIXTURES, s.en)))
    refined = m.refined
    scored = m.transcriptWords
  } else {
    refined = refineAlignmentWithPhrases(sheetRows, ja, s.lang)
  }
  const spans = computeLineMatchedSpans(lineTexts, sanitizeTranscript(scored))

  const signed = []
  const cov = []
  for (let i = 0; i < refined.lines.length; i++) {
    const t = truthTime[i]
    signed.push(t == null ? null : refined.lines[i].startTime - t)
    const sp = spans[i]
    cov.push(sp && sp.firstTime != null ? sp.matchedChars / Math.max(1, sp.totalChars) : 0)
  }
  const nTruth = signed.filter((v) => v != null).length
  console.log(`=== ${s.name}  (${refined.lines.length} lines, ${nTruth} with truth)`)

  const cells = signed.map((v, i) => {
    if (v == null) return '  .'
    const rounded = String(Math.round(v)).padStart(3)
    return cov[i] >= EVIDENCE_MIN_COVERAGE ? rounded : `(${rounded.slice(-2)})`
  })
  for (let i = 0; i < cells.length; i += 10) {
    console.log(`  #${String(i).padStart(2)} ${cells.slice(i, i + 10).join(' ')}`)
  }

  const evIdx = signed.map((v, i) => (v != null && cov[i] >= EVIDENCE_MIN_COVERAGE ? i : null)).filter((v) => v != null)
  console.log(`  evidence-backed lines: ${evIdx.length}`)
  if (evIdx.length < MIN_FIT_LINES) {
    console.log(`  drift: NOT FITTED — ${MIN_FIT_LINES}+ evidence-backed lines needed, ${evIdx.length} available`)
  } else {
    // Theil-Sen: the median of all pairwise slopes. Least squares was the first version
    // of this and it was wrong twice over — a single 36.8s outlier in an evidence desert
    // manufactured a -0.209 s/line "drift" on stranger word ja-only, and a 10-point fit
    // manufactured another on recollect. A robust estimator plus an adequate-n floor is
    // the difference between an instrument and a rumour.
    const slopes = []
    for (let a = 0; a < evIdx.length; a++) {
      for (let b = a + 1; b < evIdx.length; b++) {
        const di = evIdx[b] - evIdx[a]
        if (di === 0) continue
        slopes.push((signed[evIdx[b]] - signed[evIdx[a]]) / di)
      }
    }
    slopes.sort((x, y) => x - y)
    const slope = slopes[Math.floor(slopes.length / 2)]
    const span = evIdx[evIdx.length - 1] - evIdx[0]
    const totalDrift = slope * span
    console.log(
      `  drift (Theil-Sen): ${slope.toFixed(3)} s/line → ${totalDrift.toFixed(2)}s across ${span} lines`,
    )
    if (Math.abs(totalDrift) >= MIN_TOTAL_DRIFT_S) {
      console.log(`  ⚠ drift >= ${MIN_TOTAL_DRIFT_S}s across the song — investigate before blaming the aligner`)
    } else {
      console.log(`  no meaningful drift (below ${MIN_TOTAL_DRIFT_S}s across the song)`)
    }
  }
  console.log()
}
