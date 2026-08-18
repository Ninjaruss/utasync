/**
 * Drag→time mapping for inline line re-timing.
 *
 * Pure and DOM-free so the mapping can be tested without a pointer: given a
 * window and a fraction along it, what time does the user mean.
 *
 * The point of dragging rather than tapping: a tap commits the playhead at the
 * moment of the click, so it carries the user's reaction latency (~250-400ms,
 * always late) straight into stored timing. A drag has no such term — the user
 * adjusts until it matches and can overshoot and correct.
 */

/**
 * Half-width of the drag window, in seconds.
 *
 * PROVISIONAL. `TimestampPopover` uses ±6s, but that is a modal with a context
 * strip; an inline control wants a tighter window so small movements are
 * precise. Measured and tuned in a later task of this plan — do not treat this
 * value as evidence-backed until then.
 */
export const DRAG_WINDOW_HALF_SEC = 2.5

export interface DragWindow {
  minSec: number
  maxSec: number
}

/** Window centred on a line's current start, clamped at the start of the track. */
export function dragWindowFor(startSec: number, halfWidthSec = DRAG_WINDOW_HALF_SEC): DragWindow {
  const half = Number.isFinite(halfWidthSec) && halfWidthSec > 0 ? halfWidthSec : DRAG_WINDOW_HALF_SEC
  const centre = Number.isFinite(startSec) && startSec > 0 ? startSec : 0
  const minSec = Math.max(0, centre - half)
  const maxSec = centre + half
  return { minSec, maxSec }
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/** Time at a fraction (0..1) along the window. Out-of-range fractions clamp. */
export function timeAtFraction(window: DragWindow, fraction: number): number {
  return window.minSec + (window.maxSec - window.minSec) * clamp01(fraction)
}

/** Inverse of timeAtFraction. A zero-width window yields 0 rather than NaN. */
export function fractionAtTime(window: DragWindow, timeSec: number): number {
  const span = window.maxSec - window.minSec
  if (!(span > 0)) return 0
  return clamp01((timeSec - window.minSec) / span)
}
