import { describe, it, expect } from 'vitest'
import { anchorLeadingEdge } from '../../src/lyrics/leadingEdgeAnchor'
import type { TimedLine } from '../../src/core/types'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})

describe('anchorLeadingEdge', () => {
  it('re-spreads a crammed opening forward to the vocal onset', () => {
    const lines = [
      line('a', 0, 1),
      line('b', 1, 2),
      line('c', 2, 3),
      line('d', 3, 4),
      line('e', 20, 21),
      line('f', 22, 23),
    ]
    const out = anchorLeadingEdge(lines, 15, 'en')
    expect(out[0].startTime).toBeGreaterThanOrEqual(14.9)
    expect(out[0].startTime).toBeLessThanOrEqual(15.1)
    expect(out[4].startTime).toBe(20)
    expect(out[5].startTime).toBe(22)
    expect(out[3].startTime).toBeLessThan(20)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    }
  })

  it('is a no-op when the opening is not crammed before the onset', () => {
    const lines = [line('a', 16, 17), line('b', 18, 19), line('c', 20, 21)]
    const out = anchorLeadingEdge(lines, 15, 'en')
    expect(out[0].startTime).toBe(16)
  })

  it('is a no-op when no line is placed at/after the onset', () => {
    const lines = [line('a', 0, 1), line('b', 1, 2), line('c', 2, 3)]
    const out = anchorLeadingEdge(lines, 15, 'en')
    expect(out[0].startTime).toBe(0)
  })

  const span = (matchedChars: number, totalChars: number, firstTime: number, lastEndTime: number) => ({
    matchedChars,
    totalChars,
    firstTime,
    lastEndTime,
  })

  it('re-spreads a late-shifted opening back to the vocal onset (bidirectional)', () => {
    // First 4 lines are interpolated 12s late (no content match); line 4 is the
    // first content-anchored line at 25s. Onset detected at 2.2s.
    const lines = [
      line('tag', 14.8, 15.8),
      line('verse1', 16, 17),
      line('verse2', 18, 19),
      line('verse3', 20, 21),
      line('chorus', 25, 27),
      line('chorus2', 28, 30),
    ]
    const spans = [
      span(0, 3, 0, 0),
      span(0, 6, 0, 0),
      span(0, 6, 0, 0),
      span(0, 6, 0, 0),
      span(6, 6, 25, 27),
      span(6, 6, 28, 30),
    ]
    const out = anchorLeadingEdge(lines, 2.2, 'en', { spans })
    expect(out[0].startTime).toBeGreaterThanOrEqual(2.1)
    expect(out[0].startTime).toBeLessThanOrEqual(2.4)
    expect(out[4].startTime).toBe(25) // trusted line untouched
    expect(out[3].startTime).toBeGreaterThan(2.2)
    expect(out[3].startTime).toBeLessThan(25)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    }
  })

  it('does not pull back a genuinely-late first line that has a content match', () => {
    const lines = [line('real', 14.8, 16), line('b', 18, 19)]
    const spans = [span(4, 4, 14.8, 16), span(1, 1, 18, 19)]
    const out = anchorLeadingEdge(lines, 2.2, 'en', { spans })
    expect(out[0].startTime).toBe(14.8)
  })

  it('late-shift case is a no-op without spans (cannot tell displaced from genuinely late)', () => {
    const lines = [line('a', 14.8, 16), line('b', 18, 19), line('c', 25, 27)]
    const out = anchorLeadingEdge(lines, 2.2, 'en')
    expect(out[0].startTime).toBe(14.8)
  })
})
