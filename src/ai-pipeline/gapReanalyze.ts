import type { AlignmentLanguage, Language, TimedLine } from '../core/types'
import type { RefinedAlignment } from '../lyrics/phraseAlignment'
import { sanitizeTranscript, type TranscriptWord } from './aligner'
import { computeLineMatchedSpans } from './contentAligner'
import { detectSheetLanguage } from './whisperLanguage'
import {
  enumerateGapHoles,
  holeWorthRetrying,
  largestUntranscribedSpan,
  lineText,
  spliceGapAlignment,
  UNTRANSCRIBED_SPAN_MIN_S,
  type GapRefineOptions,
} from '../lyrics/gapRealign'

/**
 * Gap re-transcription orchestrator (round 8, G2). Audio/Whisper-free by design:
 * the slice re-transcription is INJECTED as `transcribeSlice`, so the loop is
 * deterministically unit-testable with a mock. AutoAlignFlow supplies the real
 * closure (audioData.subarray → transcribeAudio → offset words).
 *
 * When the aligner leaves a HOLE (a run of un-anchored `needs_review` lyric lines
 * between two good anchors) even though vocals are audible, this re-transcribes
 * just that audio window and re-aligns the gap via the pure G1 accept-if-better
 * splice — keeping the result only if it strictly improves. The pass can NEVER
 * make a song worse (spliceGapAlignment returns the input byte-identical on
 * reject), so no floor from rounds 6/7 is lost.
 */

/**
 * At most two sweeps over the song. A second pass exists only to pick up holes a
 * first pass couldn't attempt (over the MAX_HOLES_PER_PASS cap) once earlier
 * accepts have re-shaped the alignment; more than two invites churn for little
 * gain, since a range is retried at most once regardless.
 */
export const MAX_GAP_PASSES = 2

/**
 * Cap on slices per pass. Bounds Whisper cost (each slice is a full generate) and
 * prevents a pathologically garbled alignment (dozens of holes) from launching a
 * long chain of re-transcriptions. Overflow holes carry to the next pass.
 */
export const MAX_HOLES_PER_PASS = 4

/**
 * Longest audio window handed to a single slice. A ≤30s single-window Whisper
 * slice takes the single-`generate` path — NO stride stitching, NO per-chunk
 * auto-language truncation (both documented long-form bugs avoided). A wider hole
 * is sub-windowed to its FIRST 30s: the window opens right after a good anchor, so
 * its early lines are the ones most re-anchorable, and clamping the end keeps us on
 * the safe single-window path. Remaining lines stay at their round-6/7 spread.
 */
export const MAX_SLICE_S = 30

/** Injected slice transcriber: returns words already offset to ABSOLUTE song time
 * (AutoAlignFlow adds the window's t0 back before returning). `promptText` (round
 * 9, R9-3) is the hole's KNOWN sheet lyrics, biasing the re-transcription toward
 * the expected words; the transcriber forces segment mode for a prompted slice. */
export type TranscribeSlice = (
  t0: number,
  t1: number,
  lang: AlignmentLanguage,
  promptText?: string,
) => Promise<TranscriptWord[]>

/** Minimum un-transcribed span worth AIMING a slice at (see gapRealign's
 * UNTRANSCRIBED_SPAN_MIN_S — same threshold that makes such a hole worth
 * retrying, re-exported so callers/tests read one name). */
export const UNTRANSCRIBED_AIM_MIN_S = UNTRANSCRIBED_SPAN_MIN_S

/** Attributed-coverage floor for a hole line to be a splice-range endpoint
 * (mirrors LINE_QUALITY_MIN_COVERAGE — the same bar a line needs to score
 * 'good'). */
export const PROBE_STRONG_COVERAGE = 0.55

/**
 * Audio window for a hole's re-transcription slice. Default: the hole's first
 * MAX_SLICE_S (its early lines sit right after a verified anchor and are the
 * most re-anchorable). Round 11: when the hole window contains a large span
 * with no transcript words at all that the default slice would NOT fully
 * cover, aim the slice at that span instead — that un-heard audio is where the
 * hole's missing lines actually live (measured: stranger-than-heaven's last
 * chorus, a 35s transcript void the first-30s rule never reached).
 */
export function chooseSliceWindow(
  hole: { t0: number; t1: number },
  transcriptWords: readonly TranscriptWord[],
): { sliceStart: number; sliceEnd: number; aimed: boolean } {
  const defaultEnd = Math.min(hole.t1, hole.t0 + MAX_SLICE_S)
  const { start: gapStart, length: gapLen } = largestUntranscribedSpan(
    transcriptWords,
    hole.t0,
    hole.t1,
  )
  const coveredByDefault = gapStart >= hole.t0 && gapStart + gapLen <= defaultEnd
  // Only aim when the void starts meaningfully AFTER the hole front — a void at
  // the front is already what the default slice transcribes first, and the
  // round-9 placement-prefix prompt rule stays correct there.
  if (gapLen >= UNTRANSCRIBED_AIM_MIN_S && !coveredByDefault && gapStart > hole.t0 + 0.5) {
    // Open slightly before the void so a line whose head Whisper clipped can
    // still anchor its first words.
    const sliceStart = Math.max(hole.t0, gapStart - 2)
    return { sliceStart, sliceEnd: Math.min(hole.t1, sliceStart + MAX_SLICE_S), aimed: true }
  }
  return { sliceStart: hole.t0, sliceEnd: defaultEnd, aimed: false }
}

export interface ReanalyzeGapsArgs {
  refined: RefinedAlignment
  transcriptWords: TranscriptWord[]
  /** Alignment sheet rows, 1:1 with `refined.lines` (the same rows the main pass
   * refined). Their text drives the per-hole re-align. */
  sheetRows: TimedLine[]
  /** The song-level alignment language chosen by the main pass. */
  alignmentLanguage: AlignmentLanguage
  /** The song's stored source language — the fallback when a mixed-song hole's
   * text carries no detectable script (numerals/emoji/third script), so it
   * resolves to the song's actual language rather than detectSheetLanguage's
   * arbitrary 'ja' default. Unused for single-language songs. */
  sourceLanguage?: Language
  transcribeSlice: TranscribeSlice
  /** Checked before each slice; return true to abort the sweep immediately. */
  isCancelled?: () => boolean
  /** Forwarded to spliceGapAlignment's sub-refine (mirrors the main refine call). */
  refineOpts?: GapRefineOptions
  /** Fired at the start of each pass with the number of holes about to be
   * attempted (0 when none). Cosmetic — feeds a "recovering N sections" status. */
  onProgress?: (holesToRecover: number) => void
}

export interface ReanalyzeGapsResult {
  refined: RefinedAlignment
  transcriptWords: TranscriptWord[]
  /** Number of holes for which a re-transcription splice was ACCEPTED. */
  filledCount: number
}

/**
 * Forced Whisper language for a hole's slice. A single-language song forces its
 * one language for every hole. A mixed (code-switching) song detects the hole's
 * own script — a hole is almost always a contiguous single-script run, so forcing
 * that script sidesteps the per-chunk auto-language flapping that garbled the full
 * mixed pass. A genuinely bilingual hole falls back to 'mixed' (Whisper
 * auto-detects the single ≤30s window, still avoiding multi-chunk flapping).
 */
function forcedLangForHole(
  alignmentLanguage: AlignmentLanguage,
  holeTexts: string[],
  storedLanguage?: Language,
): AlignmentLanguage {
  if (alignmentLanguage !== 'mixed') return alignmentLanguage
  return detectSheetLanguage(holeTexts, storedLanguage)
}

export async function reanalyzeGaps(args: ReanalyzeGapsArgs): Promise<ReanalyzeGapsResult> {
  const {
    sheetRows,
    alignmentLanguage,
    sourceLanguage,
    transcribeSlice,
    isCancelled,
    refineOpts,
    onProgress,
  } = args
  let refined = args.refined
  let transcriptWords = args.transcriptWords
  const sheetTexts = sheetRows.map(lineText)
  // A given line range is re-transcribed at most once across the whole run, so a
  // rejected hole is never retried and the sweep can't churn on the same window.
  const retried = new Set<string>()
  let filledCount = 0

  for (let pass = 0; pass < MAX_GAP_PASSES; pass++) {
    if (isCancelled?.()) break

    const holes = enumerateGapHoles(refined, transcriptWords)
      .filter((h) => holeWorthRetrying(h, transcriptWords, sheetTexts))
      .filter((h) => !retried.has(`${h.from}:${h.to}`))
      .slice(0, MAX_HOLES_PER_PASS)
    onProgress?.(holes.length)
    if (holes.length === 0) break

    let acceptedThisPass = 0
    for (const hole of holes) {
      if (isCancelled?.()) break
      retried.add(`${hole.from}:${hole.to}`)

      const holeTexts = sheetTexts.slice(hole.from, hole.to + 1)
      const lang = forcedLangForHole(alignmentLanguage, holeTexts, sourceLanguage)
      // ≤30s single-window slice; aimed at a large un-transcribed span when the
      // hole contains one the default front-clamp wouldn't reach (round 11).
      const { sliceStart, sliceEnd, aimed } = chooseSliceWindow(hole, transcriptWords)
      // Bias the re-transcription toward the hole's KNOWN sheet lyrics (R9-3), but
      // ONLY the lines whose placed time falls inside the audio window — prompting
      // the decoder with lyrics whose audio was cut off would bias toward words
      // that aren't in the clip. Hole lines are spread monotonically within
      // [t0,t1] by round-6/7, so this is the in-window prefix; for a ≤30s hole
      // (sliceEnd===t1) it is every line, unchanged. For an AIMED slice the
      // placements are known-wrong (the lines' audio was never transcribed), so
      // placement filtering is meaningless — prompt with the hole lines the
      // CURRENT transcript does not corroborate instead (those are the
      // candidates for the un-heard span). A hallucinated echo is still caught
      // by accept-if-better below.
      const promptText = aimed
        ? holeTexts
            .filter((_, k) => {
              const l = refined.lines[hole.from + k]
              const windowWords = transcriptWords.filter(
                (w) => w.endTime > l.startTime - 3 && w.startTime < l.endTime + 6,
              )
              const span = windowWords.length
                ? computeLineMatchedSpans([holeTexts[k]], windowWords)[0]
                : null
              const cov = span ? span.matchedChars / Math.max(1, span.totalChars) : 0
              return cov < 0.35
            })
            .join(' ')
        : sheetTexts
            .slice(hole.from, hole.to + 1)
            .filter((_, k) => refined.lines[hole.from + k].startTime < sliceEnd)
            .join(' ')
      const gapWords = await transcribeSlice(sliceStart, sliceEnd, lang, promptText)

      // Focus the splice on the lines the fresh slice actually evidences. A
      // wide round-11 hole (e.g. 20+ unverified lines around a 30s void)
      // re-aligned WHOLESALE against one slice would honestly mark every
      // un-sliced line needs_review — more than the current (upgrade-softened)
      // labels — and the not-worse guard would reject the genuinely recovered
      // middle. The range ENDPOINTS need STRONG attributed coverage in the
      // fresh words (timing-independent char-LCS attribution across the whole
      // hole, >= PROBE_STRONG_COVERAGE of the line's chars): weaker echo
      // matches at the edges drag lines that were already correctly placed off
      // their true position (measured: stranger #52/#53 pulled 5–9s off).
      // Interior lines between two strong endpoints ride along; everything
      // outside keeps its current timing for a later pass/slice.
      let spliceFrom = hole.from
      let spliceTo = hole.to
      if (gapWords.length > 0) {
        const probeSpans = computeLineMatchedSpans(holeTexts, sanitizeTranscript(gapWords))
        const strong = probeSpans
          .map((s, k) =>
            s && s.matchedChars / Math.max(1, s.totalChars) >= PROBE_STRONG_COVERAGE ? k : -1,
          )
          .filter((k) => k >= 0)
        if (strong.length === 0) continue // nothing anchors — skip the doomed splice
        spliceFrom = hole.from + strong[0]
        spliceTo = hole.from + strong[strong.length - 1]
      }

      const res = spliceGapAlignment({
        refined,
        transcriptWords,
        sheetRows,
        from: spliceFrom,
        to: spliceTo,
        gapWords,
        lang,
        refineOpts,
        sliceT0: sliceStart,
        sliceT1: sliceEnd,
      })
      refined = res.refined
      transcriptWords = res.transcriptWords
      if (res.accepted) {
        acceptedThisPass++
        filledCount++
      }
    }

    // A pass that accepts nothing (⟺ needs_review didn't drop, since acceptance
    // requires a strict drop) means further sweeps can't help — stop.
    if (acceptedThisPass === 0) break
  }

  return { refined, transcriptWords, filledCount }
}
