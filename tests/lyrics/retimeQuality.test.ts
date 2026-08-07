import { describe, it, expect } from 'vitest'
import { retimeQuality } from '../../src/lyrics/retimeQuality'
import type { TimedLine, LineAlignmentQuality } from '../../src/core/types'

const lines = (starts: number[]): TimedLine[] =>
  starts.map((s, i) => ({ startTime: s, endTime: s + 2, original: `line ${i}`, translation: '' }))

const Q: LineAlignmentQuality[] = ['needs_review', 'good', 'needs_review', 'approximate']

describe('retimeQuality', () => {
  it('marks only the edited line as fixed, leaving the rest flagged', () => {
    const before = lines([0, 5, 10, 15])
    const after = lines([0, 5, 12, 15]) // line 2 nudged
    expect(retimeQuality(Q, before, after)).toEqual(['needs_review', 'good', 'good', 'approximate'])
  })

  // Regression: one nudge dropped the whole array, so every off-timing chip, the
  // "N lines may be off" banner and the tap-anchor prompt vanished at once and
  // the user had no idea which lines still needed attention.
  it('keeps flags for lines the user never touched', () => {
    const before = lines([0, 5, 10, 15])
    const after = lines([0, 5, 12, 15])
    const result = retimeQuality(Q, before, after)
    expect(result).toBeDefined()
    expect(result!.filter((q) => q === 'needs_review')).toHaveLength(1)
  })

  it('clears every line the user actually retimed', () => {
    const before = lines([0, 5, 10, 15])
    const after = lines([1, 5, 12, 15])
    expect(retimeQuality(Q, before, after)).toEqual(['good', 'good', 'good', 'approximate'])
  })

  it('notices an end-time-only edit', () => {
    const before = lines([0, 5, 10, 15])
    const after = before.map((l, i) => (i === 3 ? { ...l, endTime: l.endTime + 3 } : l))
    expect(retimeQuality(Q, before, after)?.[3]).toBe('good')
  })

  it('leaves everything alone when no timing changed', () => {
    const before = lines([0, 5, 10, 15])
    const after = before.map((l) => ({ ...l, original: `${l.original} edited` }))
    expect(retimeQuality(Q, before, after)).toEqual(Q)
  })

  it('drops the array when lines were added or removed, since indices no longer line up', () => {
    const before = lines([0, 5, 10, 15])
    expect(retimeQuality(Q, before, lines([0, 5, 10]))).toBeUndefined()
    expect(retimeQuality(Q, before, lines([0, 5, 10, 15, 20]))).toBeUndefined()
  })

  it('drops a stale array whose length never matched the lines', () => {
    expect(retimeQuality(['good'], lines([0, 5]), lines([1, 5]))).toBeUndefined()
  })

  it('returns undefined when there was no quality data to begin with', () => {
    expect(retimeQuality(undefined, lines([0]), lines([1]))).toBeUndefined()
  })
})
