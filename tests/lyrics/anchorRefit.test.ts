import { describe, it, expect } from 'vitest'
import type { TimedLine } from '../../src/core/types'
import { refitAroundAnchors, type TimingAnchor } from '../../src/lyrics/anchorRefit'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original, translation: '', startTime, endTime,
})

describe('refitAroundAnchors', () => {
  it('returns a clone unchanged when there are no anchors', () => {
    const lines = [line('a', 1, 2), line('b', 2, 3)]
    const out = refitAroundAnchors(lines, [], 'en')
    expect(out.map((l) => l.startTime)).toEqual([1, 2])
    expect(out).not.toBe(lines)
  })
  it('pins an anchored line exactly to its time', () => {
    const lines = [line('a', 10, 11), line('b', 11, 12), line('c', 12, 13)]
    const out = refitAroundAnchors(lines, [{ lineIndex: 1, time: 30, source: 'user' }], 'en')
    expect(out[1].startTime).toBe(30)
  })
  it('distributes lines between two anchors by singing weight, monotonic', () => {
    const lines = Array.from({ length: 5 }, (_, i) => line('word word', i, i + 1))
    const out = refitAroundAnchors(lines, [
      { lineIndex: 0, time: 0, source: 'user' }, { lineIndex: 4, time: 40, source: 'user' },
    ], 'en')
    const starts = out.map((l) => l.startTime)
    expect(starts[0]).toBe(0); expect(starts[4]).toBe(40)
    expect(starts[1]).toBeCloseTo(10, 1); expect(starts[2]).toBeCloseTo(20, 1); expect(starts[3]).toBeCloseTo(30, 1)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
  it('translates lines outside the anchor span by the nearest anchor delta', () => {
    const lines = [line('a', 5, 6), line('b', 6, 7), line('c', 7, 8)]
    const out = refitAroundAnchors(lines, [{ lineIndex: 1, time: 8, source: 'user' }], 'en')
    expect(out[1].startTime).toBe(8)
    expect(out[0].startTime).toBeCloseTo(7, 5); expect(out[2].startTime).toBeCloseTo(9, 5)
  })
  it('drops a contradictory (backwards-in-time) anchor to keep pins exact', () => {
    const lines = [line('a', 0, 1), line('b', 1, 2), line('c', 2, 3)]
    const out = refitAroundAnchors(lines, [
      { lineIndex: 0, time: 10, source: 'user' }, { lineIndex: 2, time: 5, source: 'user' },
    ], 'en')
    expect(out[0].startTime).toBe(10)
    expect(out.map((l) => l.startTime)).toEqual([...out.map((l) => l.startTime)].sort((a, b) => a - b))
  })
})
