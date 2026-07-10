import { describe, it, expect } from 'vitest'
import { phoneticSkeletonEn, phoneticSimilarityEn, findPhoneticAnchorEn } from '../../src/ai-pipeline/phoneticEn'

describe('phoneticSkeletonEn', () => {
  it('maps mishearings of the same phrase to nearby skeletons', () => {
    expect(phoneticSimilarityEn('Stranger than heaven', 'Strange in the heaven')).toBeGreaterThanOrEqual(0.7)
    expect(
      phoneticSimilarityEn('took all my pain and made a weapon', 'So call my pain and made a way boy'),
    ).toBeGreaterThanOrEqual(0.6)
  })
  it('keeps unrelated phrases apart', () => {
    expect(phoneticSimilarityEn('Stranger than heaven', 'walking on the edge of the night')).toBeLessThan(0.55)
    expect(phoneticSimilarityEn('I found a place that I can call home', 'nothing stays buried no names')).toBeLessThan(0.55)
  })
  it('returns 0 for non-Latin input', () => {
    expect(phoneticSimilarityEn('ただただ荒れていく時代に', 'stranger')).toBe(0)
  })
  it('does not let digraph rules fire across a word boundary', () => {
    // "dip" + "herald" naively joined would form "...p|h..." and ph->f.
    // Skeletonizing per-word must give the concatenation of each word's skeleton.
    expect(phoneticSkeletonEn('dip herald')).toBe(phoneticSkeletonEn('dip') + phoneticSkeletonEn('herald'))
  })
})

describe('findPhoneticAnchorEn', () => {
  const w = (word: string, startTime: number, endTime: number) => ({ word, startTime, endTime })
  const words = [
    w('St', 157.7, 158.02), w('range', 158.02, 158.18), w('in', 158.18, 158.62),
    w('the', 158.62, 158.82), w('heaven', 158.82, 159.18),
    w('unrelated', 161, 161.5), w('words', 161.5, 162),
  ]
  it('anchors a line to its phonetically-matching span', () => {
    const anchor = findPhoneticAnchorEn('Stranger than heaven', words, 150, 165)
    expect(anchor).not.toBeNull()
    expect(anchor!.startTime).toBeCloseTo(157.7, 1)
    expect(anchor!.endTime).toBeCloseTo(159.18, 1)
  })
  it('returns null when nothing in the window is close', () => {
    expect(findPhoneticAnchorEn('completely different sentence here', words, 150, 165)).toBeNull()
  })
  it('returns null for short lines (under 3 words) — too easy to false-match', () => {
    expect(findPhoneticAnchorEn('oh yeah', words, 150, 165)).toBeNull()
  })
})
