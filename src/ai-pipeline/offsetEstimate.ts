import type { VocalActivitySignal } from './vocalActivity'
import { meanActivity } from './vocalActivity'

/**
 * Global-offset estimation for ALREADY-TIMED lyrics (plan item W1.2, Layer 1).
 *
 * Why this exists: `chooseAutoAlignment` refuses to touch lyrics that already carry
 * timings, so the most common real case — a song whose lyrics came back from LRCLIB
 * already synced — gets no verification at all, and relies on the user to notice a
 * constant lag by ear and tap a manual offset control. That refusal was justified by
 * two measurements which have no source
 * (docs/superpowers/audits/2026-09-28-measurement-ledger.md, L1/L2), and the first
 * would not support the refusal even if it were true: 0.3-0.7s of error is inside the
 * band the app already treats as needing correction.
 *
 * What this is: a CHEAP acoustic screen. It uses only the audio-derived vocal-activity
 * envelope — no Whisper, no model download, no transcription — to decide whether a set
 * of claimed line starts is consistent with where the vocals actually begin. A pure
 * translation cannot damage relative structure, which is what makes it safe to consider
 * applying automatically; the per-line work stays with the existing tuners.
 *
 * WHAT IT REFUSES, AND WHY THAT IS THE DESIGN.
 *
 * The historical objection to Whisper-free offset estimation was that "a densely-sung
 * track has vocal energy nearly everywhere, so the envelope knows THAT someone is
 * singing but never WHICH words". That objection is real, and this module answers it
 * with refusal rather than with confidence. It declines to produce a number whenever:
 *
 *   (a) the envelope carries no onset STRUCTURE at all (a carrier masked in its own
 *       band). Measured on the Tier A fixtures: a clean carrier's onset rise is
 *       0.65-0.87 of the normalized activity range, a masked one's is 0.023 — so the
 *       discrimination is two orders of magnitude, not a close call;
 *   (b) the claimed timings are ALREADY consistent with the audio, in which case
 *       shifting them would be damage for no gain;
 *   (c) the required shift is larger than a small fraction of a line's spacing, because
 *       regularly-spaced onsets make every multiple of that spacing score equally well.
 *       Measured: a true -0.48s shift and a spurious -1.84s shift both scored 0.857 on
 *       `onsets-tidy`. That ambiguity is not resolvable from the envelope, so a large
 *       discrepancy is treated as a VERSION MISMATCH for the caller to escalate, never
 *       as an offset to apply;
 *   (d) there are too few lines to judge.
 *
 * Both refusals are asserted in tests/ai-pipeline/tierA.audio.test.ts, so "it says it
 * cannot tell" is a tested behaviour rather than a comment.
 *
 * Scope: ONE small global shift. Tempo scaling and piecewise drift are out of scope; a
 * different master needs `fitPriorTimeMap` (lyrics/lrcPrior.ts), which fits an affine map
 * against matched transcript evidence instead.
 */

/** Rise window: energy after a claimed start minus energy before it. Long enough to see
 * a syllable's attack, short enough that the line's own sustain does not dominate. */
const RISE_WINDOW_SEC = 0.25
/**
 * Search range, and the reason it is small.
 *
 * Not a cost decision — an identifiability one. Line spacing is ~1.3-1.5s in the corpus,
 * so shifting claimed starts by one spacing lands them on the NEXT onset and scores just
 * as well: measured on `onsets-clean`, the true -0.48s and a spurious -1.84s both scored
 * a 0.857 median rise with a 1.00 onset share. No tie-break can tell those apart from the
 * envelope alone. Keeping the range below half a line's spacing removes the ambiguity
 * entirely, and anything larger is a version mismatch that belongs to the caller as an
 * escalation rather than to this module as a guess.
 */
const MAX_SHIFT_SEC = 0.75
/** Search resolution — five times finer than the 100ms the perceptual contract allows. */
const STEP_SEC = 0.02
/** Below this |shift| the claimed timings are taken as already consistent. */
const ALREADY_CONSISTENT_SEC = 0.08
/**
 * Minimum median onset rise for the envelope to be considered informative at all.
 * Activity is robust-normalized per track, so this is a scale-free comparison. Measured:
 * 0.65-0.87 for carriers that are audible in the band, 0.023 for one masked in it.
 */
const MIN_MEDIAN_RISE = 0.15
/** Share of lines that must show a rising edge at the winning shift. */
const MIN_ONSET_SHARE = 0.6
/** Scores within this of the best are treated as tied, and the smallest |shift| wins. */
const TIE_EPSILON = 0.02

export interface OffsetEstimateInput {
  /** Claimed line start times (seconds) — from the prior the song already carries. */
  claimedStarts: readonly number[]
  sig: VocalActivitySignal
  /** Song duration, to keep the shifted line starts inside the audio. */
  durationSec?: number
  opts?: {
    maxShiftSec?: number
    stepSec?: number
    riseWindowSec?: number
    minOnsetShare?: number
    minMedianRise?: number
  }
}

export interface OffsetEstimate {
  /** Best-scoring constant shift, seconds. Positive = the lyrics should move LATER. */
  shiftSec: number
  /** Share of lines whose local window has a rising edge at the winning shift, 0-1. */
  onsetShare: number
  /** Median onset rise at the winning shift, in normalized activity units. */
  medianRise: number
  /** Lines that contributed a usable local window at the winning shift. */
  nLines: number
}

/**
 * Decide whether the claimed line starts are consistent with the audio, and if not, by
 * how much they should move. Returns `null` for every refusal case listed in the header.
 */
export function estimateGlobalOffset(input: OffsetEstimateInput): OffsetEstimate | null {
  const { claimedStarts, sig } = input
  const maxShift = input.opts?.maxShiftSec ?? MAX_SHIFT_SEC
  const step = input.opts?.stepSec ?? STEP_SEC
  const w = input.opts?.riseWindowSec ?? RISE_WINDOW_SEC
  const minOnsetShare = input.opts?.minOnsetShare ?? MIN_ONSET_SHARE
  const minMedianRise = input.opts?.minMedianRise ?? MIN_MEDIAN_RISE

  // (d) too few lines to judge: three is the minimum for a median to mean anything.
  if (!sig.activity.length || claimedStarts.length < 3) return null
  const durSec = input.durationSec ?? sig.activity.length * sig.hopSec

  interface Candidate { shift: number; median: number; onsetShare: number; n: number }
  const candidates: Candidate[] = []
  for (let raw = -maxShift; raw <= maxShift + 1e-9; raw += step) {
    const shift = +raw.toFixed(3)
    const rises: number[] = []
    for (const t of claimedStarts) {
      const at = t + shift
      if (at - w < 0 || at + w > durSec) continue
      rises.push(meanActivity(sig, at, at + w) - meanActivity(sig, at - w, at))
    }
    if (rises.length < 3) continue
    const sorted = [...rises].sort((a, b) => a - b)
    candidates.push({
      shift,
      median: sorted[Math.floor(sorted.length / 2)],
      onsetShare: rises.filter((r) => r > 0).length / rises.length,
      n: rises.length,
    })
  }
  if (!candidates.length) return null

  const eligible = candidates.filter((c) => c.onsetShare >= minOnsetShare)
  if (!eligible.length) return null

  // Tie-break toward the smallest |shift|: with onsets spaced ~1.4s apart, several
  // shifts can score alike, and the least-movement explanation is the one to prefer.
  const best = eligible.reduce((a, b) => {
    if (b.median > a.median + TIE_EPSILON) return b
    if (a.median > b.median + TIE_EPSILON) return a
    return Math.abs(b.shift) < Math.abs(a.shift) ? b : a
  })

  // (a) no onset structure in the envelope: refuse rather than invent a shift.
  if (best.median < minMedianRise) return null
  // (b) already consistent: nothing to fix, and shifting would be damage.
  if (Math.abs(best.shift) < ALREADY_CONSISTENT_SEC) return null

  return {
    shiftSec: best.shift,
    onsetShare: best.onsetShare,
    medianRise: best.median,
    nLines: best.n,
  }
}
