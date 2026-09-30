import type { AlignmentLanguage, TimedLine } from '../core/types'
import type { TranscriptWord } from './aligner'
import type { RefinedAlignment } from '../lyrics/phraseAlignment'
import { spliceGapAlignment, lineText } from '../lyrics/gapRealign'
import { computeLineMatchedSpans } from './contentAligner'
import { sanitizeTranscript } from './aligner'
import { assessAlignmentTrust, isBetterAlignment, type AlignmentTrust } from './alignmentTrust'
import type { VocalActivitySignal } from './vocalActivity'

/**
 * STATUS — SAFE BUT DEMONSTRABLY NOT WORTH SHIPPING. DO NOT WIRE WITHOUT NEW EVIDENCE.
 *
 * Built for plan item 2 on a measured justification (the verdict reaches 50% of its repair
 * targets OUTSIDE any structural hole — ledger L21), then measured end to end on a real song
 * with real whisper-small and real LRC truth, and it made sync WORSE:
 *
 *   guitar-loneliness, segment transcript    before        after
 *     absolute p50                            0.39s        0.43s
 *     lines within 250ms                        39%          33%
 *     lines with NO evidence                     4            9
 *   accepted = 8, rejected = 0, and of the 4 accepted lines that have truth:
 *     0 better, 3 WORSE, 1 unchanged  (line #0 went 0.17s -> 1.83s off)
 *
 * Two causes, and the second is the serious one:
 *
 *  1. The acceptance gate measures CORROBORATION OF THE LINE'S OWN TEXT, which a prompt echo
 *     maximises. L19's single case (where `placementRealizesCoverage` rejected an echo) is NOT
 *     representative: in this configuration the gate accepted 8 slices and none of them helped.
 *  2. Splicing a single-line window REPLACES the transcript words across that window, which
 *     dissolved the corroboration of ADJACENT lines — no-evidence rose from 4 to 9. A per-line
 *     operation with per-line acceptance can therefore degrade lines it never examined.
 *
 * THE FIX WAS TRIED AND IT WORKS, AND IT REMOVED THE POINT. Acceptance is now additionally gated
 * on the WHOLE-alignment verdict (`isBetterAlignment`), which sees adjacent damage and acoustically
 * unsupported lines that the local gate cannot. Re-measured on both songs: the harm is GONE (no
 * 13.16s catastrophe, no-evidence no longer rises) — and so is any benefit. Eight Whisper calls per
 * song produced two accepted verifications and ZERO measurable movement in p50, p90, worst line,
 * within-250ms share, or no-evidence count (ledger L23).
 *
 * So this pass is not harmful, it is simply not worth its cost. It stays unwired and unused.
 *
 * OPEN LEAD, about a SHIPPED path: `reanalyzeGaps` uses only the LOCAL gate — the same one that
 * accepted globally harmful splices here — and it runs on every fresh align and once per song on
 * open. Whether it is equally permissive there is UNMEASURED, and it should be measured on real
 * audio before anyone changes it.
 *
 * The pass and its specs are kept because the specs document the invariants any replacement must
 * hold, and because the measurement above is the reason to be careful. Nothing calls it.
 */
/**
 * Verdict-driven windowed verification: re-transcribe the audio around ONE weak line and keep
 * the result only if it survives the same acceptance test the gap pass uses.
 *
 * WHY THIS EXISTS. Gap re-transcription only targets structural HOLES — runs of unverified lines
 * between good anchors. Measured on this project's own corpus, that reaches exactly half of what
 * the truth-free verdict distrusts: of 170 repairable lines across five configs, **85 sit outside
 * any hole** and are never re-transcribed at all (ledger L21). This pass targets those, worst
 * evidence first, using the verdict's own ranking rather than a structural pattern.
 *
 * WHY IT IS PROMPT-GUIDED, AND WHY THAT IS SAFE. `transcribeSlice` receives the line's OWN text
 * as `promptText`, which biases Whisper toward the expected words and makes a short window a
 * tractable question ("is this line audible here, and when does it start?") instead of a blind
 * one. The risk is real and measured: a prompt makes Whisper ECHO it verbatim, including on a
 * window it independently labels non-vocal (ledger L18). What stops that reaching a stored timing
 * is `spliceGapAlignment`'s `placementRealizesCoverage` gate, which rejected the echo in the one
 * end-to-end reproduction available (L19). This pass therefore deliberately does NOT invent its
 * own acceptance rule: it calls the same splice and lets the existing gate decide. Replacing that
 * gate with anything that measures coverage of the prompt text would make the echo self-fulfilling.
 *
 * The transcriber is INJECTED so the pass is testable without a model: the caller supplies the
 * real `sliceTranscriber` (which handles slicing, absolute-time offsets and the crash ladder).
 */

export interface VerifyLinesArgs {
  refined: RefinedAlignment
  transcriptWords: TranscriptWord[]
  sheetRows: TimedLine[]
  /**
   * Line indices worth verifying, worst-evidence-first — `AlignmentTrust.repairableLineIndices`.
   * Order is honoured, so a budget spends itself on the least-corroborated lines.
   */
  targets: readonly number[]
  /** Slices `[t0,t1]`, transcribes with optional prompt text, returns ABSOLUTE-time words. */
  transcribeSlice: (
    t0: number,
    t1: number,
    lang: AlignmentLanguage,
    promptText?: string,
  ) => Promise<TranscriptWord[]>
  lang: AlignmentLanguage
  refineOpts?: Parameters<typeof spliceGapAlignment>[0]['refineOpts']
  isCancelled?: () => boolean
  /** How many lines may be re-transcribed. Each one costs a Whisper call. */
  maxLines?: number
  /** Seconds of audio either side of the line's current span. */
  padSec?: number
  /** Audio length, so a window never runs off the end. */
  durationSec?: number
  onProgress?: (done: number, total: number) => void
  /**
   * Audio-derived vocal-activity envelope, when the caller has one. Supplying it lets the
   * whole-alignment check below see acoustically unsupported lines, which is the term that ranks
   * first in `isBetterAlignment`.
   */
  sig?: VocalActivitySignal
}

export interface VerifyLinesResult {
  refined: RefinedAlignment
  transcriptWords: TranscriptWord[]
  /** Lines whose verification was accepted. */
  accepted: number[]
  /** Lines re-transcribed whose result did not beat the current alignment. */
  rejected: number[]
  /** Lines skipped without spending a transcription (no text, out of range, cancelled). */
  skipped: number[]
  /** Total Whisper calls made. */
  attempts: number
}

/** Default budget. Each attempt is a real transcription, so this stays small and is spent on
 * the worst-evidenced lines first. */
const DEFAULT_MAX_LINES = 6
/** ±2s around the line's span: enough to catch a line placed seconds late, short enough that
 * the window still contains mostly this line. */
const DEFAULT_PAD_SEC = 2

export async function verifyWeakLines(args: VerifyLinesArgs): Promise<VerifyLinesResult> {
  const {
    sheetRows, targets, transcribeSlice, lang, refineOpts, isCancelled, onProgress,
  } = args
  const maxLines = args.maxLines ?? DEFAULT_MAX_LINES
  const pad = args.padSec ?? DEFAULT_PAD_SEC

  let refined = args.refined
  let transcriptWords = args.transcriptWords

  /** The truth-free verdict over the WHOLE alignment, which is the layer the harm was at. */
  const trustOf = (r: RefinedAlignment, words: TranscriptWord[]): AlignmentTrust => {
    const texts = r.lines.map((l) => l.original || l.translation)
    const clean = sanitizeTranscript([...words])
    return assessAlignmentTrust({
      lines: r.lines,
      spans: computeLineMatchedSpans(texts, clean),
      words: clean,
      quality: r.lineAlignmentQuality,
      sig: args.sig,
      durationSec: args.durationSec,
    })
  }
  const accepted: number[] = []
  const rejected: number[] = []
  const skipped: number[] = []
  let attempts = 0

  // A stable, de-duplicated work list in the caller's priority order.
  const work: number[] = []
  const seen = new Set<number>()
  for (const i of targets) {
    if (seen.has(i)) continue
    seen.add(i)
    if (i < 0 || i >= refined.lines.length) { skipped.push(i); continue }
    if (!lineText(refined.lines[i]).trim()) { skipped.push(i); continue }
    work.push(i)
    if (work.length >= maxLines) break
  }

  for (let k = 0; k < work.length; k++) {
    if (isCancelled?.()) { skipped.push(...work.slice(k)); break }
    const i = work[k]
    const line = refined.lines[i]
    // The window is anchored on where the line CURRENTLY sits. That is the whole point of a
    // prompt: it makes the search local instead of whole-song.
    const t0 = Math.max(0, line.startTime - pad)
    const t1 = args.durationSec != null
      ? Math.min(args.durationSec, Math.max(line.endTime, line.startTime + 1) + pad)
      : Math.max(line.endTime, line.startTime + 1) + pad
    if (t1 - t0 <= 0.5) { skipped.push(i); continue }

    let gapWords: TranscriptWord[]
    try {
      attempts++
      gapWords = await transcribeSlice(t0, t1, lang, lineText(line))
    } catch {
      // A slice that fails to transcribe leaves the line exactly as it was. Verification is
      // best-effort and must never fail the align.
      skipped.push(i)
      continue
    }
    // Cancellation is checked at the TOP of the next iteration, deliberately: checking here
    // too would record only this line as skipped and silently drop the remaining work list.
    if (!gapWords.length) { rejected.push(i); onProgress?.(k + 1, work.length); continue }

    // THE ACCEPTANCE TEST IS THE EXISTING ONE, deliberately. `spliceGapAlignment` already
    // rejects a prompt echo via `placementRealizesCoverage` (ledger L19), and returns the input
    // byte-identical on reject, so a losing verification cannot make a song worse.
    const spliced = spliceGapAlignment({
      refined,
      transcriptWords,
      sheetRows,
      from: i,
      to: i,
      gapWords,
      lang,
      refineOpts,
      sliceT0: t0,
      sliceT1: t1,
    })
    if (spliced.accepted) {
      // THE WHOLE-ALIGNMENT CHECK, and it is the fix for this pass's measured harm (L22).
      //
      // The splice gate is LOCAL: it asks whether this line's text is now better corroborated.
      // Measured on real audio, that let 15 of 16 slices through while making sync worse, because
      // splicing a single-line window REPLACES the transcript words across that window and
      // dissolved ADJACENT lines' corroboration (no-evidence 4 -> 9), and because coverage of the
      // line's own text is exactly what a prompt echo maximises.
      //
      // So a verification is kept only if the verdict for the WHOLE alignment improves —
      // `isBetterAlignment` ranks acoustically unsupported lines first, then no-evidence lines,
      // then the verified share, so it sees precisely the damage the local gate cannot.
      const before = trustOf(refined, transcriptWords)
      const after = trustOf(spliced.refined, spliced.transcriptWords)
      if (isBetterAlignment(after, before)) {
        refined = spliced.refined
        transcriptWords = spliced.transcriptWords
        accepted.push(i)
      } else {
        rejected.push(i)
      }
    } else {
      rejected.push(i)
    }
    onProgress?.(k + 1, work.length)
  }

  return { refined, transcriptWords, accepted, rejected, skipped, attempts }
}
