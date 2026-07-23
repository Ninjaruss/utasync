import { describe, it, expect } from 'vitest'
import { refitAroundAnchors, type TimingAnchor } from '../../src/lyrics/anchorRefit'
import type { TimedLine } from '../../src/core/types'

const line = (original: string, startTime: number, endTime = startTime + 2): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})
const anc = (lineIndex: number, time: number): TimingAnchor => ({ lineIndex, time, source: 'user' })

describe('refitAroundAnchors', () => {
  it('no anchors → input cloned unchanged', () => {
    const lines = [line('a', 1), line('b', 3)]
    const out = refitAroundAnchors(lines, undefined, 'ja')
    expect(out.map((l) => l.startTime)).toEqual([1, 3])
    expect(out).not.toBe(lines)
  })

  it('pins an isolated late line WITHOUT moving its correct neighbours', () => {
    // C is 3s late (true 5s). Pinning it must fix ONLY C — the parked engine would
    // translate A/B by C's delta and wreck them.
    const lines = [line('A', 1), line('B', 2), line('C', 8), line('D', 9)]
    const out = refitAroundAnchors(lines, [anc(2, 5)], 'ja')
    expect(out.map((l) => l.startTime)).toEqual([1, 2, 5, 9])
  })

  it('never translates lines outside the anchored span', () => {
    const lines = [line('A', 1), line('B', 2), line('C', 10), line('D', 20), line('E', 30)]
    const out = refitAroundAnchors(lines, [anc(2, 7)], 'ja') // anchor a middle line
    expect(out[0].startTime).toBe(1) // before — untouched
    expect(out[1].startTime).toBe(2)
    expect(out[2].startTime).toBe(7) // pinned
    expect(out[3].startTime).toBe(20) // after — untouched
    expect(out[4].startTime).toBe(30)
  })

  it('leaves confident lines between two anchors alone', () => {
    const lines = [line('A', 1), line('B', 5), line('C', 9)]
    const q = ['good', 'good', 'good'] as const
    const out = refitAroundAnchors(lines, [anc(0, 2), anc(2, 10)], 'ja', { quality: [...q] })
    expect(out[1].startTime).toBe(5) // confident interior line kept, not re-spread
    expect(out[0].startTime).toBe(2)
    expect(out[2].startTime).toBe(10)
  })

  it('reflows a genuinely un-timed span between two anchors, preserving relative position', () => {
    // B/C are needs_review holes between anchors at A(2s) and D(20s). They should be
    // warped into the span, keeping their relative spacing.
    const lines = [line('A', 1), line('B', 3), line('C', 7), line('D', 9)]
    const out = refitAroundAnchors(lines, [anc(0, 2), anc(3, 20)], 'ja', {
      quality: ['good', 'needs_review', 'needs_review', 'good'],
    })
    expect(out[0].startTime).toBe(2)
    expect(out[3].startTime).toBe(20)
    // B was 25% of the way from A(1) to D(9) → 2 + 0.25*18 = 6.5; C was 75% → 15.5
    expect(out[1].startTime).toBeCloseTo(6.5, 1)
    expect(out[2].startTime).toBeCloseTo(15.5, 1)
    for (let i = 1; i < out.length; i++) expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
  })

  it('enforces monotonicity when a pin conflicts with a confident neighbour', () => {
    const lines = [line('A', 1), line('B', 2), line('C', 3)]
    const out = refitAroundAnchors(lines, [anc(1, 5)], 'ja') // pin B past C
    for (let i = 1; i < out.length; i++) expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    expect(out[1].startTime).toBe(5)
  })

  it('a user anchor overrides an auto anchor on the same line', () => {
    const lines = [line('A', 1), line('B', 8)]
    const anchors: TimingAnchor[] = [
      { lineIndex: 1, time: 6, source: 'auto-end' },
      { lineIndex: 1, time: 5, source: 'user' },
    ]
    const out = refitAroundAnchors(lines, anchors, 'ja')
    expect(out[1].startTime).toBe(5)
  })
})
