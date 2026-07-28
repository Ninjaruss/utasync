import { describe, it, expect } from 'vitest'
import { applyLrcPrior } from '../../src/lyrics/lrcPrior'
import type { TimedLine } from '../../src/core/types'
import type { LineMatchedSpan } from '../../src/ai-pipeline/contentAligner'

// Recollect lines #0-#26 as the aligner actually placed them (the +12s bulge is
// #5-#14), with per-line content-match coverage, both from the [bulge-diag] run.
const placement = [
  0.0, 6.4, 12.0, 13.1, 16.3, 26.9, 34.2, 38.3, 41.0, 46.3, 47.1, 49.2, 49.6,
  50.6, 52.3, 54.3, 55.4, 59.1, 62.8, 65.3, 74.2, 75.4, 76.3, 77.5, 80.2, 81.4, 96.0,
]
const coverage = [
  1.0, 1.0, 1.0, 1.0, 1.0, 0.21, 0.23, 1.0, 0.95, 1.0, 1.0, 1.0, 1.0, 1.0, 0.92,
  1.0, 1.0, 0.96, 0.59, 0.38, 0.0, 0.07, 0.86, 0.88, 0.0, 0.13, 0.57,
]
// The user's LRC truth for the same 27 lines (the prior).
const truth = [
  3.72, 6.76, 10.08, 13.56, 16.8, 20.24, 23.52, 27.0, 29.8, 33.48, 36.16, 40.08,
  43.2, 45.64, 49.24, 52.72, 57.08, 59.76, 63.0, 65.96, 69.28, 71.52, 73.72,
  75.52, 77.64, 78.24, 93.4,
]

const lines: TimedLine[] = placement.map((t, i) => ({
  original: `line ${i}`, translation: '', startTime: t, endTime: t + 2,
}))
const spans: Array<LineMatchedSpan | null> = coverage.map((c, i) =>
  c > 0 ? { firstTime: placement[i], lastEndTime: placement[i] + 1, matchedChars: Math.round(c * 100), totalChars: 100 } : null,
)

describe('applyLrcPrior on the real Recollect bulge', () => {
  const out = applyLrcPrior(lines, spans, truth)
  const err = out.map((l, i) => Math.abs(l.startTime - truth[i]))

  it('collapses the +12s bulge (#5-#14) to within 3s of truth', () => {
    for (let i = 5; i <= 14; i++) {
      expect(err[i], `line #${i} err`).toBeLessThan(3)
    }
  })

  it('leaves the already-correct lines close to truth', () => {
    for (const i of [1, 2, 3, 4, 15, 16, 17]) {
      expect(err[i], `line #${i} err`).toBeLessThan(3)
    }
  })

  it('drops the whole-section mean error well below the pre-fix ~4s', () => {
    const mean = err.reduce((s, e) => s + e, 0) / err.length
    expect(mean).toBeLessThan(2)
  })

  it('keeps the result monotonic', () => {
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    }
  })
})
