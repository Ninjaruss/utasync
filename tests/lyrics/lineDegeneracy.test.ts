import { describe, it, expect } from 'vitest'
import {
  expectedLineDuration,
  minLineDuration,
  findActivityRegions,
} from '../../src/lyrics/lineDegeneracy'

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
