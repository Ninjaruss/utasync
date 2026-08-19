import { describe, it, expect } from 'vitest'
import {
  dragWindowFor,
  isAtWindowEdge,
  DRAG_WINDOW_BACK_SEC,
  DRAG_WINDOW_FORWARD_SEC,
} from '../../src/player/dragTiming'

describe('dragWindowFor', () => {
  it('opens the window around the current start', () => {
    const w = dragWindowFor(30, 2.5, 6)
    expect(w.minSec).toBe(27.5)
    expect(w.maxSec).toBe(36)
  })

  // A line near t=0 must not offer negative times to drag to.
  it('clamps the window at the start of the track', () => {
    const w = dragWindowFor(1, 2.5, 6)
    expect(w.minSec).toBe(0)
    expect(w.maxSec).toBe(7)
  })

  it('falls back to a valid window for a nonsense start', () => {
    const w = dragWindowFor(Number.NaN, 2.5, 6)
    expect(w.minSec).toBe(0)
    expect(w.maxSec).toBeGreaterThan(0)
  })
})

describe('the measured window', () => {
  // scripts/audit-drag-window.mjs: over the 22 lines the strip is actually
  // offered for across the 4 LRC-truth corpus songs, 19 sit EARLIER than truth.
  // The forward reach must therefore exceed the backward reach, or the window
  // spends its precision budget on the direction corrections rarely travel.
  it('reaches further forward than back, because flagged lines run early', () => {
    expect(DRAG_WINDOW_FORWARD_SEC).toBeGreaterThan(DRAG_WINDOW_BACK_SEC)
  })

  // Same audit: a +/-2.5s window reached only 41% of those lines (it missed the
  // median one), 2.5/6 reaches 73%. Wider buys little and costs ms-per-pixel.
  it('spans enough to reach the measured median error, without going slack', () => {
    const span = DRAG_WINDOW_BACK_SEC + DRAG_WINDOW_FORWARD_SEC
    expect(DRAG_WINDOW_FORWARD_SEC).toBeGreaterThanOrEqual(3.06)
    expect(span).toBeGreaterThanOrEqual(8)
    expect(span).toBeLessThanOrEqual(10.5)
  })
})

describe('isAtWindowEdge', () => {
  const w = dragWindowFor(30, 2.5, 6)

  // Landing on an edge means the slider ran out, not that the spot was found.
  // The caller uses this to avoid labelling a knowingly-wrong time as truth.
  it('reports both edges', () => {
    expect(isAtWindowEdge(w, w.minSec)).toBe(true)
    expect(isAtWindowEdge(w, w.maxSec)).toBe(true)
  })

  it('does not report a time the user actually settled on', () => {
    expect(isAtWindowEdge(w, 30)).toBe(false)
    expect(isAtWindowEdge(w, 28)).toBe(false)
    expect(isAtWindowEdge(w, 34)).toBe(false)
  })

  // The last reachable slider position IS the edge — at a 0.05s step, nothing
  // sits closer, so requiring an exact hit would never fire.
  it('counts the final step as the edge', () => {
    expect(isAtWindowEdge(w, w.maxSec - 0.05)).toBe(true)
    expect(isAtWindowEdge(w, w.minSec + 0.05)).toBe(true)
    expect(isAtWindowEdge(w, w.maxSec - 0.2)).toBe(false)
  })

  it('treats a degenerate window as entirely edge', () => {
    expect(isAtWindowEdge({ minSec: 5, maxSec: 5 }, 5)).toBe(true)
  })
})
