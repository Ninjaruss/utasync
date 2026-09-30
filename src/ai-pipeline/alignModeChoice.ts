import type { DeviceTier, LineAlignmentQuality } from '../core/types'
import { placementConfidence } from './qualityScore'

/**
 * Per-song Whisper TIMESTAMP MODE selection.
 *
 * `preferredWhisperTimestampMode` returns a constant ('word' on every
 * transcribing tier), justified by a stem-only measurement recorded in that
 * module's comment: word mean |err| 5.61s vs segment 0.74s on the isolated vocal
 * stem of one song. But the committed mix fixtures say the opposite for the same
 * song — word two-pass absP90 4.13s vs segment two-pass 6.50s — and they agree
 * with the stem measurement on a different song (recollect: segment 6.04s vs
 * word 13.50s). Measured 2026-09-28 with `npx tsx scripts/align-mode-choice.mjs`:
 *
 *   guitar-loneliness  verdict picks word    (0.904 vs 0.755) | truth: word    1.93 vs 2.29
 *   recollect          verdict picks segment (0.736 vs 0.453) | truth: segment 6.04 vs 13.50
 *   stranger-than-h.   verdict ties  (0.729)                  | truth: word    4.13 vs 6.50
 *
 * So the mode is NOT a global property: it depends on the song, on the audio
 * source (stem vs mix), and on the transcript. A constant is provably wrong for
 * at least one song in the corpus. And the app's OWN quality labels rank the two
 * modes exactly the way human-synced truth does, on all three songs — which is
 * what makes the choice safe to make automatically instead of offering it as a
 * button ("Try again with segment timestamps", AutoAlignFlow.tsx).
 *
 * The design is therefore accept-if-better, mirroring `spliceGapAlignment`:
 * prefer the cheaper/current mode, escalate once to the other only when the run's
 * own verdict says it is weak, and keep the escalated run only if it is actually
 * better. A weaker second run can never ship.
 */

/**
 * The app's own 0-1 quality verdict for a run: 'good' = 1, 'approximate' = 0.5,
 * 'needs_review' = 0. Delegates to `placementConfidence` (qualityScore.ts) so mode
 * selection and the mixed-language merge grade runs by one definition — this
 * function is the selector precisely BECAUSE it is the measure the merge already
 * trusts.
 */
export function modeRunVerdict(quality: readonly LineAlignmentQuality[] | undefined): number {
  return placementConfidence(quality ?? [])
}

/** Lines carrying sheet text that the run could not corroborate against audio. */
export function countUnverifiedLines(
  lines: readonly { original?: string; translation?: string }[],
  quality: readonly LineAlignmentQuality[] | undefined,
): number {
  let unverified = 0
  for (let i = 0; i < lines.length; i++) {
    const text = (lines[i].original || lines[i].translation || '').trim()
    if (text && quality?.[i] !== 'good') unverified++
  }
  return unverified
}

export interface EscalationInput {
  /** Mode the finished run used. Only 'word' escalates — segment is the last rung. */
  timestampMode: 'word' | 'segment'
  verdict: number
  unverifiedLines: number
  lineCount: number
  /** How many lines carry a quality label. Zero means this run produced no
   * per-line evidence at all, so there is nothing to judge it by — and nothing for
   * a second pass to be compared against, either. */
  labelledLines: number
  tier: DeviceTier
  /** True once this start() call is already the escalated (second) run. */
  alreadyEscalated: boolean
  /** False when the caller has no audio to transcribe again (cheap guard). */
  canRerun: boolean
}

/**
 * Whether a FINISHED run is weak enough to justify one automatic pass in the
 * other timestamp mode.
 *
 * Two triggers, both already used elsewhere in the flow:
 *  - the run's verdict is poor overall (< MODE_ESCALATION_MAX_VERDICT), or
 *  - enough individual lines stayed unverified (>= MODE_ESCALATION_MIN_UNVERIFIED).
 * The second is what catches the word-mode long-form failure, which can look
 * confident in aggregate while ramping whole sections tens of seconds late: the
 * module comment in alignTimestampMode.ts measures 21 of 59 lines unverified for
 * word against 4 of 59 for segment on the same audio.
 *
 * Deliberately conservative: it costs one extra transcription, so it must fire on
 * runs that are actually doubtful, not on every imperfect song.
 */
export const MODE_ESCALATION_MAX_VERDICT = 0.85
export const MODE_ESCALATION_MIN_UNVERIFIED = 6
/** Minimum unverified SHARE, so a long song is not escalated purely by size.
 * Calibrated on the 2026-09-28 corpus measurements (verdict / unverified of total):
 *   guitar-loneliness word  0.904 / 7 of 47  (15%) → no escalation; word IS the
 *                            better mode here (truth absP90 1.93 vs segment 2.29)
 *   stranger-than-heaven    0.729 / 28 of 59 (47%) → escalate
 *   recollect word          0.453 / 43 of 53 (81%) → escalate, and segment wins
 *                             decisively (verdict 0.736; truth absP90 6.04 vs 13.50)
 * 0.20 sits between the "already fine" case and the doubtful ones, so a good
 * word-mode song does not pay for a second transcription. */
export const MODE_ESCALATION_MIN_UNVERIFIED_SHARE = 0.2

export function shouldEscalateTimestampMode(input: EscalationInput): boolean {
  if (input.alreadyEscalated) return false
  if (input.timestampMode !== 'word') return false
  if (!input.canRerun) return false
  if (input.tier === 'manual') return false
  if (input.lineCount === 0) return false
  // No labels means no evidence: both triggers below are computed from the quality
  // array, so without one they would fire on every run and buy a second
  // transcription that cannot even be compared against the first.
  if (input.labelledLines === 0) return false
  const weakVerdict = input.verdict < MODE_ESCALATION_MAX_VERDICT
  const enoughUnverified =
    input.unverifiedLines >= MODE_ESCALATION_MIN_UNVERIFIED
    && input.unverifiedLines / input.lineCount >= MODE_ESCALATION_MIN_UNVERIFIED_SHARE
  return weakVerdict || enoughUnverified
}

/**
 * Which run to keep. The escalated run wins only on a strict, non-trivial gain —
 * a tie or a marginal improvement keeps the first run, so the extra pass can
 * never make a song worse and rarely changes one that was already fine.
 */
export const MODE_ESCALATION_MIN_GAIN = 0.02

export function acceptEscalatedRun(firstVerdict: number, escalatedVerdict: number): boolean {
  return escalatedVerdict > firstVerdict + MODE_ESCALATION_MIN_GAIN
}
