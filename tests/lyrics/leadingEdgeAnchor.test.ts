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
})
