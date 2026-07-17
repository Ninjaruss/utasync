import type { AlignmentLanguage, LineAlignmentQuality, LyricsData, TimedLine } from '../core/types'
import { sanitizeTranscript, type AlignLyricsOptions, type TranscriptWord } from '../ai-pipeline/aligner'
import {
  computeLineMatchedSpans,
  isInterjectionLyricLine,
  normalizeForMatch,
  type LineAnchorSource,
} from '../ai-pipeline/contentAligner'
import {
  refineAlignmentWithPhrases,
  enforceLineMonotonicity,
  syncPhrasesFromValidatedLines,
  type RefinedAlignment,
} from './phraseAlignment'
import { isEvidenceDesertLine } from './labelHonesty'

/**
 * Pure gap-targeted re-alignment core (round 8, G1). No audio, no Whisper.
 *
 * When the aligner leaves a HOLE — a run of un-anchored (`needs_review`) lyric
 * lines between two good anchors — the orchestrator (G2) re-transcribes just
 * that audio window and hands the fresh words back here to re-align and splice
 * in, keeping the result only if it strictly improves. This module owns the
 * pure, corpus-testable half: hole detection, the "worth retrying" filter, and
 * the accept-if-better splice that can NEVER make a song worse.
 */

export interface GapHole {
  /** First `needs_review` line index in the run. */
  from: number
  /** Last `needs_review` line index in the run. */
  to: number
  /** Window start: the anchor-before's endTime (0 at the array head). */
  t0: number
  /** Window end: the anchor-after's startTime (last line end at the array tail). */
  t1: number
}

/**
 * Mirror of RUN_COVERAGE_MIN from redistributeDegenerateRuns.ts (round 7). Not
 * imported because that constant is module-private there and G1 is strictly
 * additive (it must not touch the shared align path). Keep in sync: the same
 * char-LCS run-coverage threshold that decides whether an activity region
 * corroborates a lyric run (region kept vs. rejected as instrumental/hallucination)
 * decides here whether the current transcript already covers a hole — a hole
 * BELOW it is un-corroborated and worth a re-transcription attempt.
 */
const RUN_COVERAGE_MIN = 0.15

/**
 * A hole narrower than this is not worth a re-transcription slice: too little
 * audio to re-hear, and a ≤30s single-window slice's overhead isn't justified.
 * Also filters near-instantaneous anchor gaps that carry no real vocal span.
 */
const HOLE_MIN_WINDOW_S = 4

/**
 * Acceptance guard tolerance (round-8 G1 follow-up). A dropped needs_review
 * count is only a label proxy — it can fall while a line is actually placed FAR
 * from its evidence (e.g. the gap words carry the right text in the wrong ORDER;
 * forced monotonicity then strands a line ~15s off, yet one line anchors so the
 * count still drops). To catch that, acceptance also requires the candidate's
 * PLACEMENT-AWARE run-coverage (each gap line's chars matched by words inside its
 * placed window) to realize the ORDER-FREE coverage the same gap words could
 * achieve over the window — a misplaced line leaves that corroboration on the
 * table. This is the slack allowed before "unrealized" reads as misplacement:
 * boundary words straddling a line edge cost a char or two, so a correct
 * placement may sit a hair below the order-free figure; a reversed/misplaced one
 * falls far below it. Cross-script gaps (JA transcript over EN lyric) score ~0 on
 * BOTH figures, so 0 >= 0 − tol always holds and they are never wrongly blocked.
 */
const COVERAGE_REALIZE_TOL = 0.15

/**
 * Minimum placed-coverage gain for the round-11 no-needs_review-drop acceptance
 * branch: a splice into a mostly-`approximate` hole is kept only when the fresh
 * slice anchors at least this much MORE of the run's lyric text (placement-
 * aware) than the current transcript corroborates at the current placement.
 * Big enough that attribution jitter can't flip an acceptance; small enough
 * that genuinely recovering even a couple of lines in a long run clears it.
 */
const PLACED_COVERAGE_IMPROVE_MIN = 0.1

/** A lyric line's alignable text: the original, or its translation when the row
 * has no original. Shared with the G2 orchestrator so hole detection and the
 * splice agree on what text a row carries. */
export function lineText(l: TimedLine): string {
  return l.original || l.translation
}

/** Window bounds for a line range [from..to], identical to the rule
 * enumerateGapHoles uses so splice and detection agree. */
function holeBounds(lines: TimedLine[], from: number, to: number): { t0: number; t1: number } {
  const lastLineEnd = lines.length > 0 ? lines[lines.length - 1].endTime : 0
  const t0 = from > 0 ? lines[from - 1].endTime : 0
  const t1 = to + 1 < lines.length ? lines[to + 1].startTime : lastLineEnd
  return { t0, t1 }
}

/**
 * Maximal runs of UNVERIFIED lines (`needs_review` or `approximate`) bounded by
 * verified `good` anchors, kept only when the run contains real trouble — at
 * least one `needs_review` line or an evidence-desert `approximate` line
 * (isEvidenceDesertLine: no local matched evidence / squashed below the
 * compression floor). Two things this buys over the round-8 needs_review-only
 * runs (2026-07 round 11 audit):
 *  - the needs_review→approximate upgrade passes can no longer DISGUISE a hole
 *    (an interpolated run over a transcript void reads approximate but is
 *    still un-corroborated, so it still surfaces here);
 *  - a wrongly-anchored line inside the trouble region (labeled approximate by
 *    the honesty pass, e.g. a repeated chorus tag on a stolen occurrence) no
 *    longer CAPS the window at its false position — bounds come from the
 *    nearest verified anchors, so the slice can reach the un-heard audio.
 * A run of unverified lines with NO trouble in it (e.g. chunk-demoted segment
 * lines whose audio corroborates them) is not a hole; holeWorthRetrying's
 * run-coverage gate additionally rejects windows the transcript already
 * covers. A run entirely of blank/interjection lines is skipped — no phonetic
 * content a re-transcription could anchor. The orchestrator handles
 * sub-windowing a >30s hole; this just reports [t0,t1] + line indices.
 */
export function enumerateGapHoles(
  refined: RefinedAlignment,
  transcriptWords: readonly TranscriptWord[],
): GapHole[] {
  const quality = refined.lineAlignmentQuality
  const lines = refined.lines
  if (!quality || lines.length === 0) return []
  const clean = sanitizeTranscript([...transcriptWords])
  const isMember = (k: number) =>
    quality[k] === 'needs_review' || quality[k] === 'approximate'
  const holes: GapHole[] = []
  let i = 0
  while (i < lines.length) {
    if (!isMember(i)) {
      i++
      continue
    }
    let j = i
    while (j + 1 < lines.length && isMember(j + 1)) j++
    let hasContent = false
    let hasTrouble = false
    for (let k = i; k <= j; k++) {
      const text = lineText(lines[k])
      if (!hasContent && text.trim() && !isInterjectionLyricLine(text)) hasContent = true
      if (!hasTrouble && isEvidenceDesertLine(lines[k], text, quality[k], clean)) hasTrouble = true
      if (hasContent && hasTrouble) break
    }
    if (hasContent && hasTrouble) {
      const { t0, t1 } = holeBounds(lines, i, j)
      holes.push({ from: i, to: j, t0, t1 })
    }
    i = j + 1
  }
  return holes
}

/**
 * Char-LCS run-coverage of `texts` against `words` inside [t0,t1] — matched
 * chars / total run chars, the same measure the round-7 activity gate uses
 * (computeLineMatchedSpans + normalizeForMatch). Pass sanitized words.
 */
function runCoverage(
  texts: string[],
  words: TranscriptWord[],
  t0: number,
  t1: number,
): number {
  const totalRunChars = texts.reduce((a, t) => a + normalizeForMatch(t).length, 0)
  if (totalRunChars === 0) return 1
  const windowWords = words.filter((w) => w.endTime > t0 && w.startTime < t1)
  const spans = computeLineMatchedSpans(texts, windowWords)
  const matched = spans.reduce((a, s) => a + (s ? s.matchedChars : 0), 0)
  return matched / totalRunChars
}

/**
 * Placement-aware run-coverage: each line's chars matched ONLY by the words
 * inside its own placed window [line.startTime, line.endTime], summed over
 * [from..to] and divided by the run's total chars. Unlike the order-free
 * runCoverage (char-LCS across the whole window, blind to which line a word sits
 * under), this credits a line only when it actually sits on the words that
 * corroborate it — so a line placed away from its own evidence scores low here
 * even though the words exist somewhere in the window. Returns 1 when the run has
 * no matchable chars (nothing to realize → never blocks, e.g. cross-script gaps).
 */
function placedRunCoverage(
  lines: TimedLine[],
  from: number,
  to: number,
  words: TranscriptWord[],
): number {
  let matched = 0
  let total = 0
  for (let k = from; k <= to; k++) {
    const text = lineText(lines[k])
    total += normalizeForMatch(text).length
    const windowWords = words.filter(
      (w) => w.endTime > lines[k].startTime && w.startTime < lines[k].endTime,
    )
    const spans = computeLineMatchedSpans([text], windowWords)
    matched += spans[0] ? spans[0].matchedChars : 0
  }
  return total === 0 ? 1 : matched / total
}

/**
 * An audio span this long inside a hole window with ZERO transcript words is
 * strong independent evidence Whisper never heard that stretch (a skipped
 * chorus/bridge), regardless of how well OTHER parts of the window corroborate
 * their lines. Instrumental breaks also qualify; a wasted slice there is
 * bounded by the orchestrator's per-pass cap and rejected by accept-if-better.
 */
export const UNTRANSCRIBED_SPAN_MIN_S = 8

/** Largest sub-span of [t0, t1] containing no transcript words at all. */
export function largestUntranscribedSpan(
  transcriptWords: readonly TranscriptWord[],
  t0: number,
  t1: number,
): { start: number; length: number } {
  const covering = transcriptWords
    .filter((w) => w.endTime > t0 && w.startTime < t1)
    .sort((a, b) => a.startTime - b.startTime)
  let cursor = t0
  let start = t0
  let length = 0
  for (const w of covering) {
    if (w.startTime - cursor > length) {
      length = w.startTime - cursor
      start = cursor
    }
    cursor = Math.max(cursor, w.endTime)
  }
  if (t1 - cursor > length) {
    length = t1 - cursor
    start = cursor
  }
  return { start, length }
}

/**
 * True when a hole is worth re-transcribing: the window is wide enough to
 * bother (≥ HOLE_MIN_WINDOW_S) and EITHER the sheet expects lyrics the current
 * transcript doesn't corroborate (run-coverage < RUN_COVERAGE_MIN — also the
 * BEFORE baseline for accept-if-better), OR the window contains a large span
 * with no transcript words at all (round 11): a wide unverified run whose
 * EDGES partially corroborate can hide a never-transcribed chorus in the
 * middle, and the partial matches alone push run-coverage past the floor.
 */
export function holeWorthRetrying(
  hole: GapHole,
  transcriptWords: TranscriptWord[],
  sheetTexts: string[],
): boolean {
  if (hole.t1 - hole.t0 < HOLE_MIN_WINDOW_S) return false
  const texts = sheetTexts.slice(hole.from, hole.to + 1)
  const totalRunChars = texts.reduce((a, t) => a + normalizeForMatch(t).length, 0)
  if (totalRunChars === 0) return false
  const clean = sanitizeTranscript(transcriptWords)
  if (runCoverage(texts, clean, hole.t0, hole.t1) < RUN_COVERAGE_MIN) return true
  return largestUntranscribedSpan(clean, hole.t0, hole.t1).length >= UNTRANSCRIBED_SPAN_MIN_S
}

/** Pass-through re-align options mirroring refineAlignmentWithPhrases's 4th/5th
 * args (the main call passes `song.lyrics`; the mixed path passes an options
 * object). Both default undefined. */
export interface GapRefineOptions {
  lyricsBase?: Pick<LyricsData, 'translationLanguage' | 'alignmentMode'>
  options?: AlignLyricsOptions
}

export interface SpliceGapArgs {
  refined: RefinedAlignment
  transcriptWords: TranscriptWord[]
  sheetRows: TimedLine[]
  from: number
  to: number
  gapWords: TranscriptWord[]
  lang: AlignmentLanguage
  refineOpts?: GapRefineOptions
  /** The audio window the slice actually re-transcribed (round 11 aimed
   * slices). Only THIS window's old words are dropped from the stored
   * transcript on accept — a wide hole keeps its partially-corroborating words
   * outside the slice. Defaults to the hole's anchor bounds (round-8 behavior,
   * where slice === window). */
  sliceT0?: number
  sliceT1?: number
}

export interface SpliceGapResult {
  refined: RefinedAlignment
  transcriptWords: TranscriptWord[]
  accepted: boolean
}

function countNeedsReview(quality: LineAlignmentQuality[], from: number, to: number): number {
  let n = 0
  for (let k = from; k <= to; k++) if (quality[k] === 'needs_review') n++
  return n
}

/**
 * Re-align the hole rows against a fresh gap transcript and splice the result in
 * ONLY if it strictly reduces the needs_review count over [from..to]. On reject,
 * `refined` and `transcriptWords` are returned unchanged (same references —
 * byte-identical). This is the safety invariant: the pass can never make a song
 * worse. Surrounding anchors (from-1, to+1 and beyond) are never mutated.
 */
export function spliceGapAlignment(args: SpliceGapArgs): SpliceGapResult {
  const { refined, transcriptWords, sheetRows, from, to, gapWords, lang, refineOpts } = args

  const sub = refineAlignmentWithPhrases(
    sheetRows.slice(from, to + 1),
    gapWords,
    lang,
    refineOpts?.lyricsBase,
    refineOpts?.options,
  )
  const { t0, t1 } = holeBounds(refined.lines, from, to)
  const sliceT0 = args.sliceT0 ?? t0
  const sliceT1 = args.sliceT1 ?? t1

  // Shallow-copy the arrays and each line object we touch so the input `refined`
  // is never mutated (the reject path must return it byte-identical). We only
  // ever reassign top-level TimedLine fields (start/endTime, quality), never the
  // nested token/annotation arrays, so a per-line spread is sufficient — if this
  // module ever mutates TimedLine.tokens/grammarAnnotations, deep-copy those too.
  const candidateLines = refined.lines.map((l) => ({ ...l }))
  const currentQuality = refined.lineAlignmentQuality ?? []
  const candidateQuality: LineAlignmentQuality[] = [...currentQuality]
  const candidateAnchors: LineAnchorSource[] | undefined = refined.anchorSources
    ? [...refined.anchorSources]
    : undefined
  const subQuality = sub.lineAlignmentQuality ?? []
  const subAnchors = sub.anchorSources ?? []
  for (let k = 0; k <= to - from; k++) {
    candidateLines[from + k] = { ...sub.lines[k] }
    if (subQuality[k] !== undefined) candidateQuality[from + k] = subQuality[k]
    if (candidateAnchors && subAnchors[k] !== undefined) candidateAnchors[from + k] = subAnchors[k]
  }

  // Clamp the spliced region strictly inside the anchors, THEN re-flatten
  // monotonic. The clamps guarantee enforceLineMonotonicity never reaches back
  // into an anchor: lines[from-1].endTime <= lines[from].startTime and
  // lines[to].endTime <= lines[to+1].startTime, so the boundary fixups are no-ops
  // and the anchors stay byte-identical.
  if (from > 0) candidateLines[from].startTime = Math.max(candidateLines[from].startTime, t0)
  if (to + 1 < candidateLines.length) {
    candidateLines[to].endTime = Math.min(candidateLines[to].endTime, t1)
  }
  enforceLineMonotonicity(candidateLines)

  // Accept-if-better, gated on BOTH a label improvement AND a placement check.
  // (a) label improvement: strictly fewer needs_review over the spliced range,
  //     OR (round 11 — mostly-approximate holes have no needs_review to drop)
  //     needs_review not worse AND the candidate's placement-aware coverage
  //     strictly exceeds what the CURRENT transcript corroborates at the
  //     current placement by a real margin — the fresh slice demonstrably
  //     anchors lyric text the old alignment left unmatched.
  // (b) the new placement realizes the gap transcript's corroboration: the
  //     candidate's placement-aware run-coverage (each gap line vs the words in
  //     its placed window) is no worse than the order-free run-coverage the same
  //     gap words could achieve over [t0,t1]. Without (b), a label drop alone can
  //     accept a WORSE placement — gap words with the right text in the wrong
  //     ORDER strand a line far from its evidence (placed-coverage collapses)
  //     while one line still anchors and the count falls. Cross-script gaps score
  //     ~0 on both figures, so (b) never blocks a legitimate low-coverage gap.
  //     (b) is also the prompt-echo hallucination backstop (see whisperPrompt):
  //     echoed text carries degenerate timing, which collapses placed coverage.
  const cleanGap = sanitizeTranscript(gapWords)
  const gapTexts = candidateLines.slice(from, to + 1).map(lineText)
  const achievableCoverage = runCoverage(gapTexts, cleanGap, t0, t1)
  const placedCoverage = placedRunCoverage(candidateLines, from, to, cleanGap)
  const currentNeedsReview = countNeedsReview(currentQuality, from, to)
  const candidateNeedsReview = countNeedsReview(candidateQuality, from, to)
  const fewerNeedsReview = candidateNeedsReview < currentNeedsReview
  // Region-splice the transcript: drop the old words inside the RE-HEARD slice
  // window only, add the fresh gap words, re-sort by time (mirrors
  // mergeMixedTranscripts). Built before acceptance so the improvement branch
  // can score the candidate against its own merged transcript.
  const cleanCurrent = sanitizeTranscript(transcriptWords)
  const nextTranscript = [
    ...transcriptWords.filter((w) => w.endTime <= sliceT0 || w.startTime >= sliceT1),
    ...cleanGap,
  ].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)
  // Round-11 improvement branch: needs_review not worse AND the candidate's
  // placement corroborates strictly more of the run's text against its merged
  // transcript than the current placement does against the current transcript.
  const beforePlacedCoverage = placedRunCoverage(refined.lines, from, to, cleanCurrent)
  const candidatePlacedFull = placedRunCoverage(
    candidateLines,
    from,
    to,
    sanitizeTranscript(nextTranscript),
  )
  const placementImproves =
    candidateNeedsReview <= currentNeedsReview
    && candidatePlacedFull >= beforePlacedCoverage + PLACED_COVERAGE_IMPROVE_MIN
  const placementRealizesCoverage = placedCoverage >= achievableCoverage - COVERAGE_REALIZE_TOL
  const accepted = (fewerNeedsReview || placementImproves) && placementRealizesCoverage
  if (!accepted) {
    return { refined, transcriptWords, accepted: false }
  }

  const candidate: RefinedAlignment = {
    ...refined,
    lines: candidateLines,
    phrases: syncPhrasesFromValidatedLines(refined.phrases, candidateLines),
    lineAlignmentQuality: candidateQuality,
    anchorSources: candidateAnchors ?? refined.anchorSources,
  }

  return { refined: candidate, transcriptWords: nextTranscript, accepted: true }
}
