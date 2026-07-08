import { describe, it, expect } from 'vitest'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'

// Two lines sung back to back. Transcript words carry exact times, so the
// span of each line must snap to its own words' onset/offset.
const words = [
  { word: 'こんにちは', startTime: 10, endTime: 12 },
  { word: '世界', startTime: 12.5, endTime: 13.5 },
  { word: 'さようなら', startTime: 20, endTime: 22 },
  { word: '世界', startTime: 22.5, endTime: 23.5 },
]

describe('computeLineMatchedSpans', () => {
  it('maps each line to the span of its reliably matched transcript chars', () => {
    const spans = computeLineMatchedSpans(['こんにちは世界', 'さようなら世界'], words)
    expect(spans[0]).not.toBeNull()
    expect(spans[1]).not.toBeNull()
    expect(spans[0]!.firstTime).toBeCloseTo(10, 5)
    expect(spans[0]!.lastEndTime).toBeCloseTo(13.5, 5)
    expect(spans[1]!.firstTime).toBeCloseTo(20, 5)
    expect(spans[1]!.lastEndTime).toBeCloseTo(23.5, 5)
    expect(spans[0]!.matchedChars).toBe(7)
    expect(spans[0]!.totalChars).toBe(7)
  })

  it('returns null for a line with no reliable match', () => {
    const spans = computeLineMatchedSpans(['こんにちは', '存在しない歌詞行です'], [words[0]])
    expect(spans[0]).not.toBeNull()
    expect(spans[1]).toBeNull()
  })

  it('returns all nulls on empty transcript', () => {
    expect(computeLineMatchedSpans(['こんにちは'], [])).toEqual([null])
  })
})
