import type { AlignmentLanguage, Language, TimedLine } from '../core/types'
import type { RefinedAlignment } from '../lyrics/phraseAlignment'
import type { TranscriptWord } from './aligner'
import { detectSheetLanguage } from './whisperLanguage'
import {
  enumerateGapHoles,
  holeWorthRetrying,
  lineText,
  spliceGapAlignment,
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

    const holes = enumerateGapHoles(refined)
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
      // Clamp a >30s hole to its first 30s to stay on Whisper's single-window path.
      const sliceEnd = Math.min(hole.t1, hole.t0 + MAX_SLICE_S)
      // Bias the re-transcription toward the hole's KNOWN sheet lyrics (R9-3). The
      // transcriber forces segment mode for a prompted slice; a hallucinated echo
      // is still caught by accept-if-better below.
      const promptText = holeTexts.join(' ')
      const gapWords = await transcribeSlice(hole.t0, sliceEnd, lang, promptText)

      const res = spliceGapAlignment({
        refined,
        transcriptWords,
        sheetRows,
        from: hole.from,
        to: hole.to,
        gapWords,
        lang,
        refineOpts,
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
