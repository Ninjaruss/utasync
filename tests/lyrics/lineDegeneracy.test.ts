import { describe, it, expect } from 'vitest'
import {
  expectedLineDuration,
  minLineDuration,
  findActivityRegions,
  offTimingLineCount,
  likelyLyricsMismatch,
  COMPRESSION_FRACTION,
} from '../../src/lyrics/lineDegeneracy'
import type { LineAlignmentQuality, TimedLine } from '../../src/core/types'

describe('expectedLineDuration', () => {
  it('scales JA lines by character count', () => {
    // 12 JA chars * 0.25s = 3.0s
    expect(expectedLineDuration('ただただ荒れていく時代に', 'ja')).toBeCloseTo(3.0, 1)
  })
  it('scales EN lines by word count', () => {
    // 8 words * 0.4s = 3.2s
    expect(expectedLineDuration('I found a place where I am not', 'ja')).toBeCloseTo(3.2, 1)
  })
  it('clamps to [0.8, 12]', () => {
    expect(expectedLineDuration('あ', 'ja')).toBe(0.8)
    expect(expectedLineDuration('あ'.repeat(200), 'ja')).toBe(12)
  })
})

describe('minLineDuration', () => {
  it('mirrors the minSungSpan floor (0.14s per normalized glyph, clamped)', () => {
    expect(minLineDuration('ただただ荒れていく時代に')).toBeCloseTo(12 * 0.14, 2)
    expect(minLineDuration('あ')).toBe(0.8)
  })
})

describe('findActivityRegions', () => {
  const w = (word: string, startTime: number, endTime: number) => ({ word, startTime, endTime })
  it('merges words separated by small gaps into one region', () => {
    const regions = findActivityRegions([w('a', 10, 11), w('b', 12, 13), w('c', 14.5, 15)], 9, 20)
    expect(regions).toEqual([{ start: 10, end: 15 }])
  })
  it('splits at gaps longer than maxGapS (instrumental)', () => {
    const regions = findActivityRegions([w('a', 10, 11), w('b', 20, 21)], 9, 25)
    expect(regions).toEqual([
      { start: 10, end: 11 },
      { start: 20, end: 21 },
    ])
  })
  it('clips regions to the window and ignores words outside it', () => {
    const regions = findActivityRegions([w('a', 5, 8), w('b', 9, 11), w('c', 30, 31)], 10, 20)
    expect(regions).toEqual([{ start: 10, end: 11 }])
  })
  it('returns [] when the window has no words', () => {
    expect(findActivityRegions([w('a', 5, 6)], 10, 20)).toEqual([])
  })
})

// Round-6 honest banner (diagnosis H4): the "N line(s) off-timing" banner used
// to count needs_review only, so approximate-labelled slivers never surfaced.
describe('offTimingLineCount', () => {
  const tl = (original: string, startTime: number, endTime: number): TimedLine => ({
    original,
    translation: '',
    startTime,
    endTime,
  })
  // ~50 normalized glyphs -> the 4.5s minLineDuration cap.
  const longText = 'a very long lyric line that can not possibly be sung in a blink'
  const floor = minLineDuration(longText) * COMPRESSION_FRACTION

  it('counts needs_review lines regardless of duration', () => {
    const lines = [tl('one', 0, 3), tl('two', 3, 6), tl('three', 6, 9)]
    expect(offTimingLineCount(lines, ['needs_review', 'good', 'needs_review'])).toBe(2)
  })

  it('adds approximate lines squashed below the compression threshold of their floor', () => {
    const lines = [tl('a good line', 0, 3), tl(longText, 3, 3.2), tl('x', 3.2, 3.2)]
    // 0.2s << 0.55 x 4.5s, and the third row is a zero-duration approximate.
    expect(offTimingLineCount(lines, ['good', 'approximate', 'approximate'])).toBe(2)
  })

  it('does not count approximate lines at or above the acceptance floor (>= with epsilon)', () => {
    const lines = [
      tl(longText, 0, floor), // exactly at the floor
      tl(longText, 10, 10 + floor - 5e-7), // inside the epsilon band
      tl(longText, 20, 20 + floor - 1e-3), // measurably below it
    ]
    expect(offTimingLineCount(lines, ['approximate', 'approximate', 'approximate'])).toBe(1)
  })

  it('ignores good lines and blank rows however short', () => {
    const lines = [tl(longText, 0, 0.1), tl('', 1, 1), tl('   ', 2, 2)]
    expect(offTimingLineCount(lines, ['good', 'approximate', 'approximate'])).toBe(0)
  })
})

describe('likelyLyricsMismatch', () => {
  const line = (original: string, startTime = 1, endTime = 4): TimedLine => ({
    original, translation: '', startTime, endTime,
  })
  const mk = (n: number) => Array.from({ length: n }, (_, i) => line(`line ${i}`))

  it('flags mismatch when confidence fell below the content threshold (proportional fallback)', () => {
    const lines = mk(10)
    const good: LineAlignmentQuality[] = lines.map(() => 'good')
    expect(likelyLyricsMismatch(lines, good, 0.3)).toBe(true)
  })

  it('does not flag a well-matched song (high confidence, all good)', () => {
    const lines = mk(10)
    const good: LineAlignmentQuality[] = lines.map(() => 'good')
    expect(likelyLyricsMismatch(lines, good, 0.85)).toBe(false)
  })

  it('flags mismatch when a large share of lines never anchored', () => {
    const lines = mk(10)
    // 5/10 = 50% needs_review, no confidence signal.
    const q: LineAlignmentQuality[] = lines.map((_, i) => (i < 5 ? 'needs_review' : 'good'))
    expect(likelyLyricsMismatch(lines, q, undefined)).toBe(true)
  })

  it('does not flag a few stray off-timing rows in an otherwise good song', () => {
    const lines = mk(20)
    // 2/20 = 10% needs_review — below the 40% systemic-mismatch share.
    const q: LineAlignmentQuality[] = lines.map((_, i) => (i < 2 ? 'needs_review' : 'good'))
    expect(likelyLyricsMismatch(lines, q, 0.7)).toBe(false)
  })

  it('needs at least a few off lines before the share matters (tiny songs)', () => {
    const lines = mk(4)
    // 2/4 = 50% share but only 2 off lines — below the 4-line floor.
    const q: LineAlignmentQuality[] = lines.map((_, i) => (i < 2 ? 'needs_review' : 'good'))
    expect(likelyLyricsMismatch(lines, q, undefined)).toBe(false)
  })

  it('is quiet when there is no quality data yet', () => {
    expect(likelyLyricsMismatch(mk(5), undefined, undefined)).toBe(false)
  })
})
