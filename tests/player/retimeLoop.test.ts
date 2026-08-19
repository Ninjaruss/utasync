import { describe, it, expect } from 'vitest'
import {
  retimeLoopFor,
  retimeLoopForEnd,
  needsWrap,
  RETIME_LOOP_LEAD_SEC,
  RETIME_LOOP_TAIL_SEC,
} from '../../src/player/retimeLoop'

/**
 * Plain seek-on-drag was measured insufficient: while playing, the playhead runs
 * ~2.5s past the candidate within 1.5s, so the onset you positioned is gone before
 * you can judge it — you cannot hold still and confirm, which is the whole
 * affordance a drag was supposed to buy over a tap. A short loop around the
 * candidate repeats the entry while the thumb sits still.
 */

describe('retimeLoopFor', () => {
  // The lead-in is the point: you judge an entry by hearing the silence break, so
  // the loop must start BEFORE the candidate, not on it.
  it('opens before the candidate and runs past it', () => {
    const l = retimeLoopFor(30)
    expect(l.startSec).toBeCloseTo(30 - RETIME_LOOP_LEAD_SEC, 5)
    expect(l.endSec).toBeCloseTo(30 + RETIME_LOOP_TAIL_SEC, 5)
    expect(l.candidateSec).toBe(30)
  })

  it('keeps a lead-in even for a candidate near the start of the track', () => {
    const l = retimeLoopFor(0.1)
    expect(l.startSec).toBe(0)
    expect(l.endSec).toBeGreaterThan(l.startSec)
  })

  it('does not run past the end of the track', () => {
    const l = retimeLoopFor(119.8, { durationSec: 120 })
    expect(l.endSec).toBeLessThanOrEqual(120)
    expect(l.startSec).toBeLessThan(l.endSec)
  })

  // A degenerate window would wrap every tick and jam playback solid.
  it('never produces an empty or inverted window', () => {
    for (const t of [0, 0.01, 5, 119.99, 120]) {
      const l = retimeLoopFor(t, { durationSec: 120 })
      expect(l.endSec).toBeGreaterThan(l.startSec)
    }
  })

  it('falls back to a valid window for a nonsense candidate', () => {
    const l = retimeLoopFor(Number.NaN)
    expect(Number.isFinite(l.startSec)).toBe(true)
    expect(l.endSec).toBeGreaterThan(l.startSec)
  })

  // Long enough to recognise the phrase, short enough that the entry comes round
  // again while you are still deciding.
  it('cycles in a couple of seconds, not a musical phrase', () => {
    const l = retimeLoopFor(30)
    const span = l.endSec - l.startSec
    expect(span).toBeGreaterThanOrEqual(1.2)
    expect(span).toBeLessThanOrEqual(3)
  })
})

describe('needsWrap', () => {
  const loop = retimeLoopFor(30)

  it('wraps once the playhead passes the end', () => {
    expect(needsWrap(loop, loop.endSec)).toBe(true)
    expect(needsWrap(loop, loop.endSec + 0.5)).toBe(true)
  })

  it('leaves the playhead alone inside the window', () => {
    expect(needsWrap(loop, loop.startSec)).toBe(false)
    expect(needsWrap(loop, 30)).toBe(false)
    expect(needsWrap(loop, loop.endSec - 0.01)).toBe(false)
  })

  // A seek to before the window is the user going somewhere else, not a wrap. If
  // this returned true the loop would drag them back and fight the navigation.
  it('does not yank a playhead that is behind the window', () => {
    expect(needsWrap(loop, 5)).toBe(false)
  })

  it('is inert with no loop', () => {
    expect(needsWrap(null, 999)).toBe(false)
  })
})

/**
 * A start and an end are judged by opposite evidence. For a start you need the
 * silence BEFORE it, so you can hear the entry break in. For an end you need the
 * tail leading up to it, so you can hear whether the line is being cut off — the
 * silence after tells you nothing you did not already know.
 */
describe('framing an end rather than a start', () => {
  it('puts most of the window before the moment when asked to', () => {
    const l = retimeLoopFor(30, { leadSec: 1.5, tailSec: 0.5 })
    expect(30 - l.startSec).toBeCloseTo(1.5, 5)
    expect(l.endSec - 30).toBeCloseTo(0.5, 5)
  })

  it('still cannot produce an empty window near the track edges', () => {
    for (const t of [0, 0.2, 119.9]) {
      const l = retimeLoopFor(t, { durationSec: 120, leadSec: 1.5, tailSec: 0.5 })
      expect(l.endSec).toBeGreaterThan(l.startSec)
      expect(l.startSec).toBeGreaterThanOrEqual(0)
    }
  })

  it('defaults to start framing when no override is given', () => {
    const l = retimeLoopFor(30)
    expect(l.endSec - 30).toBeGreaterThan(30 - l.startSec)
  })

  it('retimeLoopForEnd frames the tail, the mirror of the start default', () => {
    const end = retimeLoopForEnd(30)
    const start = retimeLoopFor(30)
    expect(30 - end.startSec).toBeGreaterThan(end.endSec - 30)
    expect(start.endSec - 30).toBeGreaterThan(30 - start.startSec)
  })

  it('retimeLoopForEnd respects the track length', () => {
    const l = retimeLoopForEnd(119.9, 120)
    expect(l.endSec).toBeLessThanOrEqual(120)
    expect(l.endSec).toBeGreaterThan(l.startSec)
  })
})
