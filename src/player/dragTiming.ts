/**
 * The drag window for inline line re-timing.
 *
 * Pure and DOM-free so the window logic can be tested without a pointer.
 *
 * There is deliberately no position->time mapping here: the strip uses a native
 * `<input type="range">` with these bounds as min/max, so the browser owns that
 * arithmetic. A hand-rolled timeAtFraction/fractionAtTime pair lived here for a
 * while, fully tested and never called by anything but its own tests.
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
 * every ordinary correction its precision; they need the alignment fix, not a
 * bigger control.
 */
export const DRAG_WINDOW_BACK_SEC = 2.5
export const DRAG_WINDOW_FORWARD_SEC = 6

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
