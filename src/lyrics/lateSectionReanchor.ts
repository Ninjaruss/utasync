import type { AlignmentLanguage, Language, TimedLine } from '../core/types'
import { backfillLateStartsToMatchedSpan, type RefinedAlignment } from './phraseAlignment'
import { sanitizeTranscript } from '../ai-pipeline/aligner'
import { computeLineMatchedSpans } from '../ai-pipeline/contentAligner'
import { detectInstrumentalGaps, type VocalActivitySignal } from '../ai-pipeline/vocalActivity'
import { detectSheetLanguage } from '../ai-pipeline/whisperLanguage'
import { lineText } from './gapRealign'
import { MAX_SLICE_S, type TranscribeSlice } from '../ai-pipeline/gapReanalyze'

/**
 * Late section-entry re-anchor (stem-only). Fixes the failure the gap re-pass
 * can't: a section whose lines CONTENT-MATCH (so they're not `needs_review` holes)
 * yet sit several seconds LATE because Whisper's one full-song pass mis-timed the
 * segment boundary coming out of an instrumental break. The aligner faithfully
 * followed that late transcript, so nothing downstream flags it.
 *
 * Mechanism: for each instrumental gap the vocal-activity envelope reports, open a
 * focused ≤30s re-transcription window that STARTS inside the gap (so Whisper locks
 * onto the vocals cleanly, without the long-form timestamp drift a full pass
 * accumulates) and re-time the section's lines to the fresh word spans via the
 * existing backfillLateStartsToMatchedSpan primitive. That primitive only ever
 * pulls a start EARLIER, to a real word edge, with coverage + container + previous-
 * line-ownership guards — so this can only fix lateness, never introduce it. Spans
 * are masked to lines currently placed inside the window, so a repeated line
 * (same text elsewhere) can't be dragged across the song by an echo match.
 *
 * Stem-only (needs the vocal-activity signal); a no-op without a stem, so
 * non-isolated runs and the mix corpus are byte-identical. Audio/Whisper-free by
 * injection: `transcribeSlice` is the same closure the gap re-pass uses.
 */

const LEAD_S = 3.0 // open the window this far before the gap's onset (inside the break)
const WINDOW_PAD_S = 2.0 // slack for deciding a line is "in" the window
export const MAX_LATE_SECTIONS = 5 // bound the extra Whisper cost per song

export interface ReanalyzeLateSectionsArgs {
  refined: RefinedAlignment
  sheetRows: TimedLine[]
  alignmentLanguage: AlignmentLanguage
  /** Fallback language for a mixed-song section whose text carries no script. */
  sourceLanguage?: Language
  /** Stem vocal-activity envelope (source must be 'stem'; otherwise a no-op). */
  vocalSig: VocalActivitySignal
  transcribeSlice: TranscribeSlice
  isCancelled?: () => boolean
  /** Fired once with the number of gap sections about to be re-transcribed. */
  onProgress?: (sections: number) => void
}

export interface ReanalyzeLateSectionsResult {
  refined: RefinedAlignment
  /** Number of line starts pulled earlier. */
  changedCount: number
}

export async function reanalyzeLateSections(
  args: ReanalyzeLateSectionsArgs,
): Promise<ReanalyzeLateSectionsResult> {
  const { refined, sheetRows, alignmentLanguage, sourceLanguage, vocalSig, transcribeSlice, isCancelled } = args
  if (vocalSig.source !== 'stem') return { refined, changedCount: 0 }

  const sheetTexts = sheetRows.map(lineText)
  const gaps = detectInstrumentalGaps(vocalSig).slice(0, MAX_LATE_SECTIONS)
  if (gaps.length === 0) return { refined, changedCount: 0 }

  let lines = refined.lines
  const inWindow = (start: number, wStart: number, wEnd: number) =>
    start >= wStart - WINDOW_PAD_S && start <= wEnd + WINDOW_PAD_S

  let toRun = 0
  for (const gap of gaps) {
    const wStart = Math.max(0, gap.end - LEAD_S)
    const wEnd = wStart + MAX_SLICE_S
    if (lines.some((l) => inWindow(l.startTime, wStart, wEnd))) toRun++
  }
  args.onProgress?.(toRun)

  let changed = 0
  for (const gap of gaps) {
    if (isCancelled?.()) break
    const wStart = Math.max(0, gap.end - LEAD_S)
    const wEnd = wStart + MAX_SLICE_S
    const windowIdx = lines
      .map((l, i) => (inWindow(l.startTime, wStart, wEnd) ? i : -1))
      .filter((i) => i >= 0)
    if (windowIdx.length === 0) continue

    const lang =
      alignmentLanguage === 'mixed'
        ? detectSheetLanguage(windowIdx.map((i) => sheetTexts[i]), sourceLanguage)
        : alignmentLanguage
    const promptText = windowIdx.map((i) => sheetTexts[i]).join(' ')
    const focusedWords = await transcribeSlice(wStart, wEnd, lang, promptText)
    if (focusedWords.length === 0) continue

    const clean = sanitizeTranscript(focusedWords)
    const spans = computeLineMatchedSpans(sheetTexts, clean)
    // Mask to lines currently placed inside the window: a repeated line living
    // elsewhere must not be pulled here by an echo match in this section's audio.
    for (let i = 0; i < spans.length; i++) {
      if (!inWindow(lines[i].startTime, wStart, wEnd)) spans[i] = null
    }
    const before = lines
    lines = backfillLateStartsToMatchedSpan(lines, clean, spans)
    for (let i = 0; i < lines.length; i++) if (lines[i].startTime !== before[i].startTime) changed++
  }

  return { refined: changed > 0 ? { ...refined, lines } : refined, changedCount: changed }
}
