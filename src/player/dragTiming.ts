/**
 * The drag window for inline line re-timing.
 *
 * Pure and DOM-free so the window logic can be tested without a pointer.
 *
 * Pointer geometry and edge panning live in TimingDragInput.
 *
 * The point of dragging rather than tapping: a tap commits the playhead at the
 * moment of the click, so it carries the user's reaction latency (~250-400ms,
 * always late) straight into stored timing. A drag has no such term — the user
 * adjusts until it matches and can overshoot and correct.
 */

/**
 * How far the window reaches back and forward from a line's stored start.
 *
 * MEASURED, not guessed. `scripts/audit-drag-window.mjs` runs the real aligner
 * over the four corpus songs that have human-synced LRC truth, takes exactly
 * the lines `selectAnchorTargets` offers the strip, and asks how far each one
 * would have to travel to reach truth. Over those 22 lines:
 *
 *   - 19 of 22 sit EARLIER than truth: the user nearly always drags LATER.
 *     Median distance 3.06s, so a symmetric ±2.5s window (the first guess here)
 *     failed to reach the MEDIAN line it was offered for — 41% coverage.
 *   - Spending the budget where the errors are gives the same reach for a much
 *     tighter window: back 2.5 / forward 6 covers 16/22 (73%) in an 8.5s span,
 *     matching symmetric ±6s (also 73%) while spanning 29% less time. Measured
 *     as shipped, the strip is 194 CSS px wide on a 375px phone: 44ms per pixel
 *     here, against 62ms for the symmetric ±6s window that reaches no further.
 *
 * The 6 lines still out of reach are 7.9–16.4s out: an intro crammed at t=0 and
 * the known mixed-merge collapse. A slider wide enough for those would cost
 * every ordinary correction its precision — so the window stays tight and the
 * STRIP's step buttons carry the line out to them instead (see RETIME_STEPS):
 * jump near the target, then drag to settle on it. Widening the drag window was
 * the wrong lever; a control that can be walked is the right one.
 */
export const DRAG_WINDOW_BACK_SEC = 2.5
export const DRAG_WINDOW_FORWARD_SEC = 6

/**
 * Coarse steps for the strip's "move the line" buttons.
 *
 * The window above only reaches ±2.5/+6s around where the line currently sits,
 * which is the right size for an ordinary correction and far too small for the
 * common case where a line's real start is simply outside it — classically a
 * first line whose song has an instrumental intro much longer than the timings
 * expect. Dragging to the edge used to be a dead end there (the offset screen
 * escalated to a full transcription instead of aligning).
 *
 * A coarse jump plus a fine one covers any gap: a 10s jump alone would leave
 * unreachable 1.5s holes between where one window ends and the next begins, and
 * the 1s step closes them.
 */
export const RETIME_STEP_COARSE_SEC = 10
export const RETIME_STEP_FINE_SEC = 1

/** Button order: back-coarse, back-fine, forward-fine, forward-coarse. */
export const RETIME_STEPS: readonly number[] = [
  -RETIME_STEP_COARSE_SEC,
  -RETIME_STEP_FINE_SEC,
  RETIME_STEP_FINE_SEC,
  RETIME_STEP_COARSE_SEC,
]

/**
 * Move a draft time by `delta` seconds, never before the start of the track.
 *
 * Rounded to 2dp so the result stays on the slider's 0.05s step after repeated
 * additions (float drift would otherwise put it fractionally off-step).
 */
export function stepRetimeTime(value: number, delta: number): number {
  const next = value + delta
  if (!Number.isFinite(next) || next <= 0) return 0
  return Math.round(next * 100) / 100
}

export interface DragWindow {
  minSec: number
  maxSec: number
}

/** Window around a line's current start, clamped at the start of the track. */
export function dragWindowFor(
  startSec: number,
  backSec = DRAG_WINDOW_BACK_SEC,
  forwardSec = DRAG_WINDOW_FORWARD_SEC,
): DragWindow {
  const back = Number.isFinite(backSec) && backSec > 0 ? backSec : DRAG_WINDOW_BACK_SEC
  const forward = Number.isFinite(forwardSec) && forwardSec > 0 ? forwardSec : DRAG_WINDOW_FORWARD_SEC
  const centre = Number.isFinite(startSec) && startSec > 0 ? startSec : 0
  const minSec = Math.max(0, centre - back)
  const maxSec = centre + forward
  return { minSec, maxSec }
}

/**
 * True when a chosen time sits on a window edge.
 *
 * The user who lands here ran out of slider — they did not find the spot. That
 * distinction matters at commit time: recording a clamped value as a confident
 * correction is how a knowingly-wrong time gets labelled truth and stops being
 * offered, which is the failure this whole control exists to remove.
 *
 * The tolerance is one slider step, so the last reachable position counts as
 * the edge it is.
 */
export function isAtWindowEdge(window: DragWindow, timeSec: number, tolSec = 0.051): boolean {
  return timeSec <= window.minSec + tolSec || timeSec >= window.maxSec - tolSec
}
