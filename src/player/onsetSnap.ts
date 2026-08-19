import { nearestOnset, type VocalActivitySignal } from '../ai-pipeline/vocalActivity'

/**
 * How far back to look. A correction lands late far more often than early — both
 * from residual reaction latency in whatever put the line there, and because a
 * singer's entry is the LEFT edge of a sound the user hears as a whole. The same
 * asymmetry nearestOnset was built for.
 */
const MAX_BEFORE_SEC = 0.6
const SLACK_AFTER_SEC = 0.15
/**
 * Onset strength a peak must clear to count. Below this, ordinary spectral churn
 * would "snap" a correct time to noise.
 */
const MIN_STRENGTH = 0.35

export interface SnapResult {
  timeSec: number
  /** False when nothing qualified — the caller's time is returned untouched. */
  snapped: boolean
}

/**
 * Pull a user-chosen time onto a nearby genuine vocal onset.
 *
 * This is the endgame of a drag, not its substitute. The window sizing in
 * dragTiming.ts solves REACH — getting the thumb to roughly the right second.
 * This solves PRECISION: the strip is 194 CSS px wide on a phone and spans 8.5s,
 * so 44ms rides on every pixel and the best a steady hand can do still leaves
 * tens of milliseconds. Snapping removes that residual, which is why it applies
 * on commit rather than during the drag — mid-drag it would fight the finger.
 *
 * Deliberately conservative: when no peak clears MIN_STRENGTH inside the window,
 * the user's own time wins. A snap that moved everything would be worse than no
 * snap — it would replace the user's judgement with the envelope's.
 */
export function snapToOnset(
  signal: VocalActivitySignal | null | undefined,
  timeSec: number,
  opts?: { maxBefore?: number; slackAfter?: number; minStrength?: number },
): SnapResult {
  if (!signal || !Number.isFinite(timeSec)) return { timeSec, snapped: false }
  const hit = nearestOnset(signal, timeSec, {
    maxBefore: opts?.maxBefore ?? MAX_BEFORE_SEC,
    slackAfter: opts?.slackAfter ?? SLACK_AFTER_SEC,
    minStrength: opts?.minStrength ?? MIN_STRENGTH,
  })
  return hit === null ? { timeSec, snapped: false } : { timeSec: hit, snapped: true }
}
