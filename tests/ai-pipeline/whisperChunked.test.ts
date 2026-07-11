import { describe, it, expect } from 'vitest'
import { planWindows, stitchChunkedResults, type StitchChunk } from '../../src/ai-pipeline/whisperChunked'

const SR = 16000

describe('planWindows', () => {
  it('single window for audio <= 30s', () => {
    expect(planWindows(20 * SR, SR)).toEqual([{ startS: 0, endS: 20 }])
    expect(planWindows(30 * SR, SR)).toEqual([{ startS: 0, endS: 30 }])
  })
  it('30s windows with 5s overlap (stride 25)', () => {
    // 80s → [0,30], [25,55], [50,80]
    expect(planWindows(80 * SR, SR)).toEqual([
      { startS: 0, endS: 30 },
      { startS: 25, endS: 55 },
      { startS: 50, endS: 80 },
    ])
  })
  it('short tail (<8s) shifts the last window back instead of creating a sliver', () => {
    // 58s: naive windows [0,30],[25,55],[50,58] — 8s tail is OK (boundary).
    expect(planWindows(58 * SR, SR)).toEqual([
      { startS: 0, endS: 30 },
      { startS: 25, endS: 55 },
      { startS: 50, endS: 58 },
    ])
    // 57s: tail [50,57] is 7s (<8) → last window shifts back to end at 57: [27,57]
    expect(planWindows(57 * SR, SR)).toEqual([
      { startS: 0, endS: 30 },
      { startS: 27, endS: 57 },
    ])
  })
  it('empty audio → no windows', () => {
    expect(planWindows(0, SR)).toEqual([])
  })
  it('property: full coverage, <=30s windows, no gaps, no slivers for every duration 31..300s', () => {
    for (let s = 31; s <= 300; s++) {
      const w = planWindows(s * SR, SR)
      expect(w.length).toBeGreaterThan(0)
      expect(w[0].startS).toBe(0)
      expect(w[w.length - 1].endS).toBeCloseTo(s, 6)
      for (let i = 0; i < w.length; i++) {
        expect(w[i].endS - w[i].startS).toBeLessThanOrEqual(30 + 1e-9)
        if (i > 0) expect(w[i].startS).toBeLessThanOrEqual(w[i - 1].endS - 1e-9) // overlap/touch, no gap
        if (w.length > 1) expect(w[i].endS - w[i].startS).toBeGreaterThanOrEqual(8 - 1e-9)
      }
    }
  })
})

describe('stitchChunkedResults', () => {
  const c = (text: string, s: number, e: number | null): StitchChunk => ({ text, timestamp: [s, e] })

  it('applies window offsets and concatenates', () => {
    const out = stitchChunkedResults([
      { offsetS: 0, windowEndS: 30, chunks: [c('a', 0, 1), c('b', 1, 2)] },
      { offsetS: 25, windowEndS: 55, chunks: [c('x', 5, 6), c('y', 6, 7)] }, // → 30-31, 31-32
    ])
    expect(out.chunks.map((ch) => ch.timestamp)).toEqual([[0, 1], [1, 2], [30, 31], [31, 32]])
    expect(out.text).toBe('abxy')
  })

  it('dedups the overlap at the midpoint (cut = overlapStart + 2.5)', () => {
    // Windows [0,30] and [25,55]: overlap 25-30, cut at 27.5.
    const out = stitchChunkedResults([
      // window 1 words at 26 (midpoint 26.25 < 27.5 → keep) and 28 (28.25 > cut → drop)
      { offsetS: 0, windowEndS: 30, chunks: [c('keep1', 26, 26.5), c('drop1', 28, 28.5)] },
      // window 2 words at abs 26.2 (mid 26.45 < cut → drop) and abs 28 (mid 28.25 >= cut → keep)
      { offsetS: 25, windowEndS: 55, chunks: [c('drop2', 1.2, 1.7), c('keep2', 3, 3.5)] },
    ])
    expect(out.chunks.map((ch) => ch.text)).toEqual(['keep1', 'keep2'])
  })

  it('clamps a null end on a window final chunk to the window end and keeps monotonic order', () => {
    const out = stitchChunkedResults([
      { offsetS: 0, windowEndS: 30, chunks: [c('a', 1, 2), c('tail', 29, null)] },
    ])
    expect(out.chunks[1].timestamp).toEqual([29, 30])
    for (let i = 1; i < out.chunks.length; i++) {
      expect(out.chunks[i].timestamp[0]).toBeGreaterThanOrEqual(out.chunks[i - 1].timestamp[0])
    }
  })

  it('drops chunks with non-finite starts and returns empty for empty input', () => {
    expect(stitchChunkedResults([])).toEqual({ text: '', chunks: [] })
    const out = stitchChunkedResults([
      { offsetS: 0, windowEndS: 30, chunks: [{ text: 'bad', timestamp: [Number.NaN, 1] }, c('ok', 1, 2)] },
    ])
    expect(out.chunks.map((ch) => ch.text)).toEqual(['ok'])
  })
})
