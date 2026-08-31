import { describe, it, expect } from 'vitest'
import { groupRanges } from '../../src/lyrics/translationGroups'
import type { TimedLine } from '../../src/core/types'

const L = (original: string, translation: string, translationGroup?: number): TimedLine =>
  ({ startTime: 0, endTime: 1, original, translation, translationGroup }) as TimedLine

describe('groupRanges', () => {
  it('treats rows without a group id as singletons', () => {
    const r = groupRanges([L('a', 'x'), L('b', 'y')])
    expect(r).toEqual([
      { start: 0, end: 0, text: 'x' },
      { start: 1, end: 1, text: 'y' },
    ])
  })

  it('collapses contiguous rows sharing an id', () => {
    const r = groupRanges([L('a', 'shared', 7), L('b', 'shared', 7), L('c', 'z', 8)])
    expect(r).toEqual([
      { start: 0, end: 1, text: 'shared' },
      { start: 2, end: 2, text: 'z' },
    ])
  })

  it('does not merge non-contiguous rows that reuse an id', () => {
    const r = groupRanges([L('a', 'p', 1), L('b', 'q', 2), L('c', 'p', 1)])
    expect(r.map((x) => [x.start, x.end])).toEqual([[0, 0], [1, 1], [2, 2]])
  })
})
