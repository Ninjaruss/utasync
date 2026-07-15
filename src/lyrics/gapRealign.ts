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

function lineText(l: TimedLine): string {
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
 * Maximal runs of `needs_review` lines bounded by non-`needs_review` anchors.
 * A run entirely of blank/interjection lines is skipped — those carry no
 * phonetic content a re-transcription could anchor (they are upgraded out of
 * needs_review in the main path; guarded here anyway). The orchestrator handles
 * sub-windowing a >30s hole; this just reports [t0,t1] + line indices.
 */
export function enumerateGapHoles(refined: RefinedAlignment): GapHole[] {
  const quality = refined.lineAlignmentQuality
  const lines = refined.lines
  if (!quality || lines.length === 0) return []
  const holes: GapHole[] = []
  let i = 0
  while (i < lines.length) {
    if (quality[i] !== 'needs_review') {
      i++
      continue
    }
    let j = i
    while (j + 1 < lines.length && quality[j + 1] === 'needs_review') j++
    let hasContent = false
    for (let k = i; k <= j; k++) {
      const text = lineText(lines[k])
      if (text.trim() && !isInterjectionLyricLine(text)) {
        hasContent = true
        break
      }
    }
    if (hasContent) {
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
 * True when a hole is worth re-transcribing: the sheet expects lyrics over the
 * window but the current transcript doesn't corroborate them (run-coverage <
 * RUN_COVERAGE_MIN), and the window is wide enough to bother (≥ HOLE_MIN_WINDOW_S).
 * The low coverage is also the BEFORE baseline for accept-if-better. A window
 * the transcript already covers, or one too short/empty, is skipped.
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
  return runCoverage(texts, clean, hole.t0, hole.t1) < RUN_COVERAGE_MIN
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

  // Deep-copy every array we touch so the input `refined` is never mutated (the
  // reject path must return it byte-identical).
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

  const accepted =
    countNeedsReview(candidateQuality, from, to) < countNeedsReview(currentQuality, from, to)
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

  // Region-splice the transcript: drop the old words inside [t0,t1], add the
  // fresh gap words, re-sort by time (mirrors mergeMixedTranscripts).
  const nextTranscript = [
    ...transcriptWords.filter((w) => w.endTime <= t0 || w.startTime >= t1),
    ...sanitizeTranscript(gapWords),
  ].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)

  return { refined: candidate, transcriptWords: nextTranscript, accepted: true }
}
