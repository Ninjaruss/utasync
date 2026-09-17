import { describe, it, expect } from 'vitest'
import {
  dragWindowFor,
  isAtWindowEdge,
  stepRetimeTime,
  RETIME_STEPS,
  RETIME_STEP_COARSE_SEC,
  RETIME_STEP_FINE_SEC,
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

/**
 * The window is deliberately too short to reach a line whose real start lies
 * further out — a song with a long instrumental intro is the common case. These
 * steps are how the strip reaches it without widening the window (and so without
 * costing an ordinary correction its precision).
 */
describe('stepRetimeTime', () => {
  it('adds the step in both directions', () => {
    expect(stepRetimeTime(30, RETIME_STEP_COARSE_SEC)).toBe(40)
    expect(stepRetimeTime(30, -RETIME_STEP_COARSE_SEC)).toBe(20)
    expect(stepRetimeTime(30, RETIME_STEP_FINE_SEC)).toBe(31)
  })

  it('never steps before the start of the track', () => {
    expect(stepRetimeTime(0.4, -RETIME_STEP_FINE_SEC)).toBe(0)
    expect(stepRetimeTime(3, -RETIME_STEP_COARSE_SEC)).toBe(0)
  })

  // Repeated additions must stay on the slider's 0.05s step, or the value drifts
  // fractionally off-grid and the native input snaps it somewhere unexpected.
  it('stays on the slider step after repeated additions', () => {
    let t = 12.35
    for (let i = 0; i < 40; i++) t = stepRetimeTime(t, RETIME_STEP_COARSE_SEC)
    // Checked in centiseconds: a float modulo would report drift that is not there.
    expect(Math.round(t * 100) % 5).toBe(0)
    expect(t).toBeCloseTo(12.35 + 400, 6)
  })

  it('treats a nonsense value as the start of the track', () => {
    expect(stepRetimeTime(Number.NaN, 5)).toBe(0)
  })
})

describe('RETIME_STEPS', () => {
  // A coarse jump alone leaves 1.5s holes: after a +10s jump the window covers
  // [v+7.5, v+16], and the window before it stopped at v+6. The 1s step closes
  // them, so every time in between is reachable.
  it('offers a fine step that closes the gaps between coarse jumps', () => {
    expect(RETIME_STEPS).toContain(RETIME_STEP_FINE_SEC)
    expect(RETIME_STEPS).toContain(-RETIME_STEP_FINE_SEC)
    const gapLeftByCoarseJumps = RETIME_STEP_COARSE_SEC - DRAG_WINDOW_BACK_SEC - DRAG_WINDOW_FORWARD_SEC
    expect(gapLeftByCoarseJumps).toBeGreaterThan(0)
    expect(RETIME_STEP_FINE_SEC).toBeLessThanOrEqual(gapLeftByCoarseJumps)
  })

  it('is ordered back-coarse, back-fine, forward-fine, forward-coarse', () => {
    expect([...RETIME_STEPS]).toEqual([
      -RETIME_STEP_COARSE_SEC, -RETIME_STEP_FINE_SEC, RETIME_STEP_FINE_SEC, RETIME_STEP_COARSE_SEC,
    ])
  })
})
