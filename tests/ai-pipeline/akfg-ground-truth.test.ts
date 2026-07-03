import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

const here = dirname(fileURLToPath(import.meta.url))
const SEGMENT_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_segment.json')
const LYRICS = join(here, 'fixtures/akfg-user-ja.txt')

// Full-song ground truth from the official YouTube captions (seconds).
// `onset` is the caption timestamp; `shared` marks a line that is the second half
// of a caption and therefore shares the previous line's onset (it begins somewhere
// after the predecessor, not at the caption timestamp). `tol` overrides the default
// ±2 s onset tolerance for lines Whisper transcribes loosely.
interface GT {
  idx: number
  onset: number
  shared?: boolean
  tol?: number
}
const GROUND_TRUTH: GT[] = [
  { idx: 0, onset: 98 },
  { idx: 1, onset: 104 },
  { idx: 2, onset: 111 },
  { idx: 3, onset: 118 },
  { idx: 4, onset: 122 },
  { idx: 5, onset: 131 },
  { idx: 6, onset: 131, shared: true }, // 嗚呼 — interjection after そんな僕に
  { idx: 7, onset: 141 },
  { idx: 8, onset: 141, shared: true }, // ローリング ローリング
  { idx: 9, onset: 148 },
  { idx: 10, onset: 154 },
  { idx: 11, onset: 154, shared: true }, // 心絡まって ローリング ローリング
  { idx: 12, onset: 161 },
  { idx: 13, onset: 177 },
  { idx: 14, onset: 183 },
  { idx: 15, onset: 190 },
  { idx: 16, onset: 203 },
  { idx: 17, onset: 210 },
  { idx: 18, onset: 217 },
  { idx: 19, onset: 217, shared: true }, // 光輝いたように ように
  { idx: 20, onset: 223, tol: 3 }, // pre-bridge climax; caption rough
  { idx: 21, onset: 262 },
  { idx: 22, onset: 275 },
  { idx: 23, onset: 282 },
  { idx: 24, onset: 292 },
  { idx: 25, onset: 292, shared: true }, // ローリング ローリング
  { idx: 26, onset: 299 },
  { idx: 27, onset: 306 },
  { idx: 28, onset: 306, shared: true }, // 心絡まって ローリング ローリング
  { idx: 29, onset: 312, tol: 3 }, // final run line; caption rough
]

// Contiguous-singing pairs: the second line begins right as the first ends (no
// instrumental break), so a large gap here means a premature cutoff.
const CONTIGUOUS_PAIRS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [9, 10], [10, 11], [11, 12], [13, 14], [14, 15], [16, 17], [17, 18],
  [18, 19], [19, 20], [21, 22], [22, 23], [24, 25], [25, 26], [26, 27], [27, 28], [28, 29],
]

describe.skipIf(!existsSync(SEGMENT_CACHE))('AKFG full-song ground truth', () => {
  const lineTexts = readFileSync(LYRICS, 'utf8').trim().split('\n')
  const words = sanitizeTranscript(
    JSON.parse(readFileSync(SEGMENT_CACHE, 'utf8')).chunks.flatMap(
      (c: { text?: string; timestamp?: number[] }) => {
        const [start, end] = c.timestamp ?? []
        const word = c.text?.trim()
        if (!word || !Number.isFinite(start)) return []
        return [{ word, startTime: start, endTime: end }]
      },
    ),
  )

  function align() {
    const sheetRows = lineTexts.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
    return refineAlignmentWithPhrases(sheetRows, words, 'ja').lines
  }

  it('aligns every caption-start line within tolerance of its YouTube onset', () => {
    const lines = align()
    for (const { idx, onset, shared, tol = 2 } of GROUND_TRUTH) {
      if (shared) continue
      const l = lines[idx]
      expect(l.startTime, `line ${idx} "${lineTexts[idx].slice(0, 12)}" onset`).toBeGreaterThan(onset - tol)
      expect(l.startTime, `line ${idx} "${lineTexts[idx].slice(0, 12)}" onset`).toBeLessThan(onset + tol)
    }
  })

  it('starts every shared second-half line after its predecessor and before the next caption', () => {
    const lines = align()
    for (const { idx, shared } of GROUND_TRUTH) {
      if (!shared) continue
      const prev = lines[idx - 1]
      const l = lines[idx]
      expect(l.startTime, `line ${idx} after predecessor`).toBeGreaterThan(prev.startTime)
      // Never collapses to the predecessor's start (the original zero-duration bug).
      expect(l.startTime - prev.startTime, `line ${idx} not collapsed onto predecessor`).toBeGreaterThan(1.0)
    }
  })

  it('gives every line a non-trivial sung duration (no zero-width lines)', () => {
    const lines = align()
    for (let i = 0; i < lines.length; i++) {
      expect(lines[i].endTime - lines[i].startTime, `line ${i} "${lineTexts[i].slice(0, 12)}" duration`).toBeGreaterThan(1.0)
    }
  })

  it('keeps both 心絡まって lines at a full ~3.5 s duration (regression on the collapse bug)', () => {
    const lines = align()
    const entwinedIdxs = lineTexts
      .map((t, i) => (t.includes('心絡まって') ? i : -1))
      .filter((i) => i >= 0)
    expect(entwinedIdxs).toHaveLength(2)
    for (const i of entwinedIdxs) {
      expect(lines[i].endTime - lines[i].startTime, `心絡まって line ${i} duration`).toBeGreaterThan(2.5)
    }
  })

  it('has no premature cutoffs between contiguously-sung lines', () => {
    const lines = align()
    for (const [a, b] of CONTIGUOUS_PAIRS) {
      const gap = lines[b].startTime - lines[a].endTime
      // Contiguous phrases: the next line starts as this one ends. Allow a small
      // breath but flag a real hole (> 2 s) as a premature cutoff.
      expect(gap, `gap ${a}->${b} (${lineTexts[a].slice(0, 8)} -> ${lineTexts[b].slice(0, 8)})`).toBeLessThan(2.0)
      // And no overlap beyond a tiny epsilon.
      expect(gap, `overlap ${a}->${b}`).toBeGreaterThan(-0.2)
    }
  })

  it('keeps the whole timeline monotonic', () => {
    const lines = align()
    for (let i = 0; i < lines.length - 1; i++) {
      expect(lines[i].startTime, `line ${i} start <= line ${i + 1} start`).toBeLessThanOrEqual(lines[i + 1].startTime + 0.001)
      expect(lines[i].endTime, `line ${i} end <= line ${i + 1} start + eps`).toBeLessThanOrEqual(lines[i + 1].startTime + 0.2)
    }
  })
})
