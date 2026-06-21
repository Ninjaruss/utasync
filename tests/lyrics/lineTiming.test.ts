import { describe, it, expect } from 'vitest'
import { lineIndexAtPlayhead, lineOverlapsABLoop, linePlaybackStart, VOCAL_ONSET_LEAD_S } from '../../src/lyrics/lineTiming'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 0, endTime: 2, original: 'a', translation: '' },
  { startTime: 2, endTime: 5, original: 'b', translation: '' },
  { startTime: 5, endTime: 8, original: 'c', translation: '' },
]

describe('lineTiming', () => {
  it('finds the row containing the playhead', () => {
    expect(lineIndexAtPlayhead(lines, 1)).toBe(0)
    expect(lineIndexAtPlayhead(lines, 2)).toBe(1)
    expect(lineIndexAtPlayhead(lines, 4.5)).toBe(1)
    expect(lineIndexAtPlayhead(lines, 9)).toBe(-1)
  })

  it('detects lines overlapping an A-B window', () => {
    expect(lineOverlapsABLoop(lines[0], 0, lines, 0, 2)).toBe(true)
    expect(lineOverlapsABLoop(lines[1], 1, lines, 1, 6)).toBe(true)
    expect(lineOverlapsABLoop(lines[2], 2, lines, 0, 2)).toBe(false)
  })

  it('highlights a line slightly before its stored start', () => {
    const timed: TimedLine[] = [{ startTime: 10, endTime: 15, original: 'a', translation: '' }]
    expect(lineIndexAtPlayhead(timed, 10 - VOCAL_ONSET_LEAD_S + 0.01)).toBe(0)
    expect(lineIndexAtPlayhead(timed, 10 - VOCAL_ONSET_LEAD_S - 0.01)).toBe(-1)
  })

  it('seeks slightly before the stored line start', () => {
    expect(linePlaybackStart({ startTime: 10, endTime: 15, original: 'a', translation: '' }))
      .toBeCloseTo(10 - VOCAL_ONSET_LEAD_S)
  })
})
