import { describe, it, expect } from 'vitest'
import { anchorLineByPartialMatch, distinctiveSubstrings } from '../../src/ai-pipeline/partialMatchAnchor'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

describe('distinctiveSubstrings', () => {
  it('includes suffix and token parts for Japanese lines', () => {
    const parts = distinctiveSubstrings('あなたを救えないのだろう')
    expect(parts.some((p) => p.includes('救え'))).toBe(true)
    expect(parts.some((p) => p.includes('だろう'))).toBe(true)
  })
})

describe('anchorLineByPartialMatch', () => {
  const words: TranscriptWord[] = [
    { word: 'ずっと', startTime: 58.3, endTime: 59.1 },
    { word: '決まった', startTime: 59.5, endTime: 60.3 },
    { word: '心', startTime: 60.3, endTime: 61.1 },
    { word: 'だを', startTime: 62.7, endTime: 63.1 },
    { word: '救え', startTime: 63.1, endTime: 63.4 },
    { word: 'たのなら', startTime: 63.4, endTime: 64.2 },
  ]

  it('anchors via shared substring when Whisper mis-hears the chorus', () => {
    const hit = anchorLineByPartialMatch(
      'あなたを救えないのだろう',
      words,
      58,
      65,
    )
    expect(hit).not.toBeNull()
    expect(hit!.startTime).toBeGreaterThanOrEqual(63)
    expect(hit!.endTime).toBeGreaterThan(hit!.startTime)
  })

  it('finds rolling token in a sparse window', () => {
    const rolling: TranscriptWord[] = [
      { word: 'わからない', startTime: 296, endTime: 298 },
      { word: 'ローリング', startTime: 311.8, endTime: 313 },
    ]
    const hit = anchorLineByPartialMatch('ローリング ローリング', rolling, 310, 315)
    expect(hit?.needle).toContain('ローリング')
  })
})
