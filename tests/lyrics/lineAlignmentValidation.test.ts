import { describe, it, expect } from 'vitest'
import type { TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'
import { scoreLineAlignment, LINE_QUALITY_MIN_COVERAGE } from '../../src/ai-pipeline/contentAligner'
import { validateAndRetryLineTimings } from '../../src/lyrics/phraseAlignment'

const aoWords: TranscriptWord[] = [
  { word: 'あ', startTime: 1, endTime: 1.4 },
  { word: 'お', startTime: 1.4, endTime: 1.8 },
  { word: 'ぞ', startTime: 1.8, endTime: 2.2 },
  { word: 'ら', startTime: 2.2, endTime: 2.6 },
]

const yukiWords: TranscriptWord[] = [
  { word: 'ゆ', startTime: 10, endTime: 10.4 },
  { word: 'き', startTime: 10.4, endTime: 10.8 },
  { word: 'が', startTime: 10.8, endTime: 11.2 },
  { word: 'ふ', startTime: 11.2, endTime: 11.6 },
  { word: 'る', startTime: 11.6, endTime: 12 },
]

describe('scoreLineAlignment', () => {
  it('marks a line good when its text matches the local transcript window', () => {
    const score = scoreLineAlignment('あおぞら', aoWords, 'ja')
    expect(score.anchorSource).toBe('lcs')
    expect(score.coverage).toBeGreaterThanOrEqual(LINE_QUALITY_MIN_COVERAGE)
    expect(score.quality).toBe('good')
  })

  it('marks a line needs_review when the window has no matching content', () => {
    const score = scoreLineAlignment('あおぞら', yukiWords, 'ja')
    expect(score.quality).toBe('needs_review')
  })
})

describe('validateAndRetryLineTimings', () => {
  it('retries a mis-timed line and moves it to the matching vocal', () => {
    const words = [...aoWords, ...yukiWords]
    const lines: TimedLine[] = [
      { startTime: 10, endTime: 12, original: 'あおぞら', translation: '' },
      { startTime: 10, endTime: 12, original: 'ゆきがふる', translation: '' },
    ]
    const { lines: out, lineAlignmentQuality, retryCount } = validateAndRetryLineTimings(
      lines,
      words,
      'ja',
      ['interpolated', 'lcs'],
    )
    expect(retryCount).toBeGreaterThan(0)
    expect(out[0].startTime).toBeLessThan(3)
    expect(lineAlignmentQuality[0]).toBe('good')
    expect(out[1].startTime).toBeGreaterThanOrEqual(10)
  })

  it('preserves good lines without retrying', () => {
    const words = [...aoWords, ...yukiWords]
    const lines: TimedLine[] = [
      { startTime: 1, endTime: 2.6, original: 'あおぞら', translation: '' },
      { startTime: 10, endTime: 12, original: 'ゆきがふる', translation: '' },
    ]
    const { lines: out, retryCount, lineAlignmentQuality } = validateAndRetryLineTimings(
      lines,
      words,
      'ja',
    )
    expect(retryCount).toBe(0)
    expect(out[0].startTime).toBeCloseTo(1, 0)
    expect(lineAlignmentQuality[0]).toBe('good')
    expect(lineAlignmentQuality[1]).toBe('good')
  })
})
