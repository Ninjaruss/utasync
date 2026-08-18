import { describe, it, expect } from 'vitest'
import {
  dragWindowFor,
  timeAtFraction,
  fractionAtTime,
  DRAG_WINDOW_HALF_SEC,
} from '../../src/player/dragTiming'

describe('dragWindowFor', () => {
  it('centres the window on the current start', () => {
    const w = dragWindowFor(30, 2.5)
    expect(w.minSec).toBe(27.5)
    expect(w.maxSec).toBe(32.5)
  })

  // A line near t=0 must not offer negative times to drag to.
  it('clamps the window at the start of the track', () => {
    const w = dragWindowFor(1, 2.5)
    expect(w.minSec).toBe(0)
    expect(w.maxSec).toBe(3.5)
  })

  it('falls back to a valid window for a nonsense start', () => {
    const w = dragWindowFor(Number.NaN, 2.5)
    expect(w.minSec).toBe(0)
    expect(w.maxSec).toBeGreaterThan(0)
  })
})

describe('timeAtFraction / fractionAtTime', () => {
  const w = dragWindowFor(30, 2.5)

  it('maps the ends and the centre', () => {
    expect(timeAtFraction(w, 0)).toBe(27.5)
    expect(timeAtFraction(w, 1)).toBe(32.5)
    expect(timeAtFraction(w, 0.5)).toBe(30)
  })

  it('clamps out-of-range fractions rather than escaping the window', () => {
    expect(timeAtFraction(w, -1)).toBe(27.5)
    expect(timeAtFraction(w, 2)).toBe(32.5)
  })

  it('round-trips', () => {
    for (const t of [27.5, 28.3, 30, 31.9, 32.5]) {
      expect(timeAtFraction(w, fractionAtTime(w, t))).toBeCloseTo(t, 6)
    }
  })

  it('clamps a time outside the window to its edges', () => {
    expect(fractionAtTime(w, 0)).toBe(0)
    expect(fractionAtTime(w, 99)).toBe(1)
  })

  // Degenerate window must not produce NaN — a zero-width window would divide by
  // zero and put NaN into a stored line time.
  it('survives a zero-width window', () => {
    const z = { minSec: 5, maxSec: 5 }
    expect(Number.isFinite(timeAtFraction(z, 0.5))).toBe(true)
    expect(Number.isFinite(fractionAtTime(z, 5))).toBe(true)
  })
})

describe('DRAG_WINDOW_HALF_SEC', () => {
  // Provisional per the spec — a later task measures it. Pinned here so a change
  // is a deliberate edit with a test to update, not a silent drift.
  it('is a small local window, not the popover-sized one', () => {
    expect(DRAG_WINDOW_HALF_SEC).toBeGreaterThan(0)
    expect(DRAG_WINDOW_HALF_SEC).toBeLessThan(6)
  })
})
