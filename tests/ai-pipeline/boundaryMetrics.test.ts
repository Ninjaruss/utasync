import { describe, it, expect } from 'vitest'
import { computeBoundaryMetrics } from '../../scripts/lib/boundaryMetrics.mjs'

const span = (firstTime: number, lastEndTime: number) => ({
  firstTime,
  lastEndTime,
  matchedChars: 8,
  totalChars: 10,
})
const words = [
  { word: 'あ', startTime: 10, endTime: 10.5 },
  { word: 'い', startTime: 20, endTime: 20.5 },
  { word: 'ロング', startTime: 30, endTime: 33 },
]

describe('computeBoundaryMetrics', () => {
  it('counts an early end when the line ends >0.35s before its last matched char', () => {
    const lines = [{ startTime: 10, endTime: 11, original: 'x', translation: '' }]
    const m = computeBoundaryMetrics(lines, [span(10, 12)], words)
    expect(m.earlyEnd).toBe(1)
    expect(m.measured).toBe(1)
  })

  it('counts a late end when a line runs past the next line’s first matched char', () => {
    const lines = [
      { startTime: 10, endTime: 20.4, original: 'x', translation: '' },
      { startTime: 20.4, endTime: 22, original: 'y', translation: '' },
    ]
    const m = computeBoundaryMetrics(lines, [span(10, 11), span(20, 22)], words)
    expect(m.lateEnd).toBe(1)
  })

  it('counts a mid-word boundary when a line end falls inside a long word', () => {
    const lines = [{ startTime: 29, endTime: 31.5, original: 'x', translation: '' }]
    const m = computeBoundaryMetrics(lines, [span(29, 31.5)], words)
    expect(m.midWord).toBe(1)
  })

  it('skips unmeasurable lines: null span, low coverage, retargeted occurrence', () => {
    const low = { firstTime: 10, lastEndTime: 12, matchedChars: 2, totalChars: 10 }
    const retargeted = span(100, 110) // span no longer overlaps line window
    const lines = [
      { startTime: 10, endTime: 12, original: 'a', translation: '' },
      { startTime: 13, endTime: 14, original: 'b', translation: '' },
      { startTime: 15, endTime: 16, original: 'c', translation: '' },
    ]
    const m = computeBoundaryMetrics(lines, [null, low, retargeted], words)
    expect(m.measured).toBe(0)
    expect(m.earlyEnd).toBe(0)
    expect(m.lateEnd).toBe(0)
  })

  it('classifies unmatched lines past the audio end as beyondAudio', () => {
    const lines = [{ startTime: 40, endTime: 41, original: 'x', translation: '' }]
    const m = computeBoundaryMetrics(lines, [null], words)
    expect(m.beyondAudio).toBe(1)
  })

  it('reports gap percentiles across consecutive measured pairs', () => {
    const lines = [
      { startTime: 10, endTime: 10.5, original: 'a', translation: '' },
      { startTime: 20, endTime: 20.5, original: 'b', translation: '' },
    ]
    const m = computeBoundaryMetrics(lines, [span(10, 10.5), span(20, 20.5)], words)
    expect(m.gapP50).toBeCloseTo(9.5, 2)
  })
})
