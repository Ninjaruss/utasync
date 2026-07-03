import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

const here = dirname(fileURLToPath(import.meta.url))
const WORD_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_word.json')
const LYRICS = join(here, 'fixtures/akfg-user-ja.txt')

// YouTube caption onsets (seconds) per line index; `shared` = second half of a
// caption (starts after its predecessor, not at the caption timestamp).
const GT: { idx: number; onset: number; shared?: boolean; tol?: number }[] = [
  { idx: 0, onset: 98 }, { idx: 1, onset: 104 }, { idx: 2, onset: 111 },
  { idx: 3, onset: 118 }, { idx: 4, onset: 122 }, { idx: 5, onset: 131 },
  { idx: 6, onset: 131, shared: true }, { idx: 7, onset: 141 },
  { idx: 8, onset: 141, shared: true }, { idx: 9, onset: 148 },
  { idx: 10, onset: 154 }, { idx: 11, onset: 154, shared: true },
  // idx 13: the caption reads 177 s but the vocal onset (わ/理由) is 174.9 s — the
  // onset-backfill correctly snaps to the true start, so assert against that.
  { idx: 12, onset: 161, tol: 2.5 }, { idx: 13, onset: 175, tol: 2.5 }, { idx: 14, onset: 183 },
  { idx: 15, onset: 190 }, { idx: 16, onset: 203 }, { idx: 17, onset: 210 },
  { idx: 18, onset: 217 }, { idx: 19, onset: 217, shared: true },
  { idx: 20, onset: 223, tol: 2.5 }, { idx: 21, onset: 262 }, { idx: 22, onset: 275 },
  { idx: 23, onset: 282 }, { idx: 24, onset: 292 }, { idx: 25, onset: 292, shared: true },
  { idx: 26, onset: 299 }, { idx: 27, onset: 306 }, { idx: 28, onset: 306, shared: true },
  { idx: 29, onset: 312, tol: 2.5 },
]

describe.skipIf(!existsSync(WORD_CACHE))('AKFG word-level ground truth', () => {
  const lineTexts = readFileSync(LYRICS, 'utf8').trim().split('\n')
  const words = sanitizeTranscript(
    JSON.parse(readFileSync(WORD_CACHE, 'utf8')).chunks.flatMap(
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
    for (const { idx, onset, shared, tol = 2 } of GT) {
      if (shared) continue
      const l = lines[idx]
      expect(l.startTime, `line ${idx} "${lineTexts[idx].slice(0, 12)}" onset`).toBeGreaterThan(onset - tol)
      expect(l.startTime, `line ${idx} "${lineTexts[idx].slice(0, 12)}" onset`).toBeLessThan(onset + tol)
    }
  })

  it('gives every line a non-trivial sung duration (no word-mode collapse)', () => {
    const lines = align()
    for (let i = 0; i < lines.length; i++) {
      expect(lines[i].endTime - lines[i].startTime, `line ${i} "${lineTexts[i].slice(0, 12)}" duration`).toBeGreaterThan(1.0)
    }
  })

  // The actual sung span of each line, read glyph-by-glyph from the word-level
  // transcript. Every line's timestamp must COVER this span (start no later than
  // the vocal onset, end no earlier than the vocal offset) so a loop plays the
  // whole line — the core "usable for looping" requirement.
  const TRUE_SPAN: [number, number][] = [
    [97.6, 103.5], [104.8, 110.3], [111.6, 116.7], [118.2, 122.2], [122.7, 130.8],
    [131.6, 136.9], [138.2, 140.5], [141.3, 146.6], [146.6, 148.3], [148.3, 153.5],
    [155.0, 158.0], [158.4, 161.6], [161.6, 166.6], [174.9, 182.3], [182.9, 189.5],
    [190.3, 196.9], [203.2, 209.8], [210.6, 215.4], [217.0, 219.9], [220.5, 223.1],
    [224.0, 228.8], [261.6, 272.6], [275.7, 281.5], [281.5, 288.1], [292.5, 297.5],
    [298.1, 299.2], [299.2, 304.0], [306.0, 309.0], [309.4, 312.7], [312.8, 317.6],
  ]

  it('covers the whole sung span of every line (no late start, no early cutoff)', () => {
    const lines = align()
    const TOL = 0.6
    for (let i = 0; i < lines.length; i++) {
      const [onset, offset] = TRUE_SPAN[i]
      const l = lines[i]
      expect(l.startTime, `line ${i} "${lineTexts[i].slice(0, 12)}" starts late (onset ${onset})`).toBeLessThanOrEqual(onset + TOL)
      expect(l.endTime, `line ${i} "${lineTexts[i].slice(0, 12)}" ends early (offset ${offset})`).toBeGreaterThanOrEqual(offset - TOL)
    }
  })

  it('keeps 君の孤独 from collapsing onto its few matched glyphs (LCS-collapse guard)', () => {
    const lines = align()
    const idx = lineTexts.findIndex((t) => t.includes('君の孤独'))
    // Whisper mishears most of this line; the retry once collapsed it to ~0.7 s.
    expect(lines[idx].endTime - lines[idx].startTime).toBeGreaterThan(3.5)
  })

  it('anchors first-chorus 凍てつく地面 at the run onset, not its final 走 glyph', () => {
    const lines = align()
    const idx = lineTexts.findIndex((t) => t.includes('凍てつく地面'))
    // Whisper heard 凍てつく→傷つく; the run must still start near 161 s (≤163),
    // not latch onto 走り at ~165.5 s, and span the full sung phrase.
    expect(lines[idx].startTime).toBeLessThan(163.5)
    expect(lines[idx].startTime).toBeGreaterThan(159)
    expect(lines[idx].endTime - lines[idx].startTime).toBeGreaterThan(4)
  })

  it('keeps the whole timeline monotonic', () => {
    const lines = align()
    for (let i = 0; i < lines.length - 1; i++) {
      expect(lines[i].startTime, `line ${i} start`).toBeLessThanOrEqual(lines[i + 1].startTime + 0.001)
      expect(lines[i].endTime, `line ${i} end`).toBeLessThanOrEqual(lines[i + 1].startTime + 0.2)
    }
  })
})
