import { describe, it, expect } from 'vitest'
import { fitPriorTimeMap } from '../../src/lyrics/lrcPrior'
import { applyLrcPrior } from '../../src/lyrics/lrcPrior'
import type { TimedLine } from '../../src/core/types'
import type { LineMatchedSpan } from '../../src/ai-pipeline/contentAligner'

const line = (original: string, startTime: number): TimedLine => ({
  original, translation: '', startTime, endTime: startTime + 2,
})
const span = (coverage: number, firstTime = 0): LineMatchedSpan => ({
  firstTime, lastEndTime: firstTime + 1, matchedChars: Math.round(coverage * 100), totalChars: 100,
})

describe('fitPriorTimeMap', () => {
  const allCovered = (n: number) => Array<number>(n).fill(1)

  it('recovers identity for same-tempo pairs', () => {
    const prior = [2, 5, 9, 14, 20]
    const actual = [2.1, 4.9, 9.1, 13.8, 20.2]
    const { a, b } = fitPriorTimeMap(prior, actual, allCovered(5))
    expect(a).toBeCloseTo(1, 1)
    expect(Math.abs(b)).toBeLessThan(0.5)
  })

  it('recovers a tempo scale + offset', () => {
    const prior = [10, 20, 30, 40, 50]
    const actual = prior.map((p) => 1.3 * p + 4)
    const { a, b } = fitPriorTimeMap(prior, actual, allCovered(5))
    expect(a).toBeCloseTo(1.3, 1)
    expect(b).toBeCloseTo(4, 0)
  })

  it('is robust when 40% of confident pairs are late outliers', () => {
    const prior = [5, 10, 15, 40, 60, 80, 20, 25, 30, 35]
    const actual = [5, 10, 15, 40, 60, 80, 32, 37, 42, 47]
    const { a, b } = fitPriorTimeMap(prior, actual, allCovered(10))
    expect(a).toBeCloseTo(1, 1)
    expect(Math.abs(b)).toBeLessThan(1)
  })

  it('ignores low-coverage pairs', () => {
    const prior = [5, 10, 15, 20]
    const actual = [5, 10, 999, 20]
    const cov = [1, 1, 0.1, 1]
    const { a, b } = fitPriorTimeMap(prior, actual, cov)
    expect(a).toBeCloseTo(1, 1)
    expect(Math.abs(b)).toBeLessThan(0.5)
  })

  it('returns identity with no confident pairs', () => {
    expect(fitPriorTimeMap([5, 10], [5, 10], [0, 0])).toEqual({ a: 1, b: 0 })
  })

  it('returns a pure offset with a single confident pair', () => {
    expect(fitPriorTimeMap([10], [13], [1])).toEqual({ a: 1, b: 3 })
  })

  it('does not lock onto a shallow line threading a bulge+tail (identity regime)', () => {
    // Correct opening + a late bulge whose drift + the tail coincidentally line
    // up on a shallow slope; the fit must stay ~unit slope, not the spurious one.
    const prior =  [4, 8, 12, 27, 30, 33, 36, 40, 53, 57, 60, 74, 76, 93]
    const actual = [4, 8, 12, 38, 41, 44, 47, 50, 54, 55, 59, 76, 78, 96]
    const { a } = fitPriorTimeMap(prior, actual, Array<number>(prior.length).fill(1))
    expect(a).toBeCloseTo(1, 1)
  })
})

describe('applyLrcPrior', () => {
  it('keeps a confident placement that agrees with the prior', () => {
    const lines = [line('a', 2.1), line('b', 5.2), line('c', 9.0)]
    const spans = [span(1), span(1), span(1)]
    const prior = [2, 5, 9]
    const out = applyLrcPrior(lines, spans, prior)
    expect(out.map((l) => l.startTime)).toEqual([2.1, 5.2, 9.0])
  })

  it('rejects a confident placement 12s away and snaps it to the prior', () => {
    const lines = [line('a', 2), line('b', 5), line('c', 21), line('d', 14)]
    const spans = [span(1), span(1), span(1, 21), span(1)]
    const prior = [2, 5, 9, 14]
    const out = applyLrcPrior(lines, spans, prior)
    expect(out[2].startTime).toBeCloseTo(9, 0)
    expect(out[2].startTime).toBeLessThan(14)
  })

  it('uses the prior for a low-coverage line regardless of its placement', () => {
    const lines = [line('a', 2), line('b', 40), line('c', 12)]
    const spans = [span(1), span(0.1, 40), span(1)]
    const prior = [2, 7, 12]
    const out = applyLrcPrior(lines, spans, prior)
    expect(out[1].startTime).toBeCloseTo(7, 0)
  })

  it('is a no-op-shaped pass when there is no usable prior (all zero)', () => {
    const lines = [line('a', 3), line('b', 8)]
    const spans = [span(1, 3), span(1, 8)]
    const out = applyLrcPrior(lines, spans, [0, 0])
    expect(out.map((l) => l.startTime)).toEqual([3, 8])
  })

  it('rescales the prior for a slower recording before gating', () => {
    const prior = [4, 8, 12, 16, 20]
    const lines = prior.map((p, i) => line(String(i), 1.25 * p))
    const spans = prior.map(() => span(1))
    const out = applyLrcPrior(lines, spans, prior)
    out.forEach((l, i) => expect(l.startTime).toBeCloseTo(1.25 * prior[i], 0))
  })

  it('returns lines unchanged when array lengths mismatch (defensive)', () => {
    const lines = [line('a', 3), line('b', 8)]
    expect(applyLrcPrior(lines, [span(1)], [2, 5, 9])).toBe(lines)
  })
})
