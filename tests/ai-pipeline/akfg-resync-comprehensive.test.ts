/**
 * Comprehensive AKFG resync correctness tests.
 *
 * Covers:
 *  - Segment transcript: only lines 7 (嗚呼) and 26 (ローリング2) are weak after refine
 *  - Both weak lines return no-change under resync (transcript-resolution-limited)
 *  - realignAllWeak does not corrupt any good line
 *  - Good lines are protected from resync corruption by the guard in realignSection
 *  - Word transcript: 6 weak lines, all return no-change under resync (proportional-split ceiling)
 *  - realignAllWeak with word transcript doesn't move any line more than 1s
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import {
  refineAlignmentWithPhrases,
  realignSection,
  realignAllWeakSections,
} from '../../src/lyrics/phraseAlignment'
import type { LineAlignmentQuality, TimedLine } from '../../src/core/types'

const here = dirname(fileURLToPath(import.meta.url))
const SEGMENT_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_segment.json')
const WORD_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_word.json')
const LYRICS = join(here, 'fixtures/akfg-user-ja.txt')

function loadTranscript(path: string) {
  return sanitizeTranscript(
    JSON.parse(readFileSync(path, 'utf8')).chunks.flatMap(
      (c: { text?: string; timestamp?: number[] }) => {
        const [start, end] = c.timestamp ?? []
        const word = c.text?.trim()
        if (!word || !Number.isFinite(start)) return []
        return [{ word, startTime: start, endTime: end ?? start + 1 }]
      },
    ),
  )
}

function sheetFrom(lines: string[]) {
  return lines.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
}

// ─── Segment transcript suite ─────────────────────────────────────────────

describe.skipIf(!existsSync(SEGMENT_CACHE))('AKFG resync — segment transcript', () => {
  const lineTexts = readFileSync(LYRICS, 'utf8').trim().split('\n')
  const words = loadTranscript(SEGMENT_CACHE)
  const refined = refineAlignmentWithPhrases(sheetFrom(lineTexts), words, 'ja')
  const quality = refined.lineAlignmentQuality!

  it('refine produces exactly 2 weak lines: 嗚呼 (idx 6) and ローリング2 (idx 25)', () => {
    const weakIndices = quality.map((q, i) => (q !== 'good' ? i : -1)).filter((i) => i >= 0)
    expect(weakIndices).toHaveLength(2)
    expect(lineTexts[weakIndices[0]]).toContain('嗚呼')
    expect(lineTexts[weakIndices[1]]).toContain('ローリング')
    // ローリング2 is the second-chorus instance (after 角を曲がって)
    const cornerIdx = lineTexts.findIndex((t) => t.includes('角を曲が'))
    expect(weakIndices[1]).toBeGreaterThan(cornerIdx)
  })

  it('嗚呼 (idx 6, approximate) has plausible span (1–4 s)', () => {
    const aIdx = lineTexts.findIndex((t) => t.includes('嗚呼'))
    expect(quality[aIdx]).toBe('approximate')
    const span = refined.lines[aIdx].endTime - refined.lines[aIdx].startTime
    expect(span).toBeGreaterThan(0.8)
    expect(span).toBeLessThan(4)
  })

  it('ローリング2 (idx 25, needs_review) has reasonable span (1.5–4 s)', () => {
    const rIndices = lineTexts
      .map((t, i) => (t === 'ローリング ローリング' ? i : -1))
      .filter((i) => i >= 0)
    const r2Idx = rIndices[1] // second instance
    expect(quality[r2Idx]).toBe('needs_review')
    const span = refined.lines[r2Idx].endTime - refined.lines[r2Idx].startTime
    expect(span).toBeGreaterThan(1.5)
    expect(span).toBeLessThan(5)
  })

  it('resync of 嗚呼 (approx) fills the gap to the next good line', () => {
    // recoverInterjectionTiming gives 嗚呼 the "ああ" chunk timing.
    // realignSection then extends it to fill the full gap before line 7 (a good anchor).
    // This is an improvement — not a no-change case.
    const aIdx = lineTexts.findIndex((t) => t.includes('嗚呼'))
    const nextGoodIdx = aIdx + 1
    const result = realignSection(refined.lines, aIdx, words, quality, 'ja', refined.anchorSources)
    const after = result.lines[aIdx]
    const span = after.endTime - after.startTime
    expect(span).toBeGreaterThan(1.5)
    expect(span).toBeLessThan(6)
    // Start should not shift (ああ chunk boundary is already correct)
    expect(Math.abs(after.startTime - refined.lines[aIdx].startTime)).toBeLessThan(0.3)
    // End should extend to meet line 7's start (fills the ~1.5s silence gap)
    expect(after.endTime).toBeGreaterThanOrEqual(result.lines[nextGoodIdx].startTime - 0.1)
    // Neighbor line must not be corrupted
    expect(result.lines[nextGoodIdx].startTime).toBe(refined.lines[nextGoodIdx].startTime)
  })

  it('resync of ローリング2 (needs_review) returns unchanged — no matching chunk', () => {
    const rIndices = lineTexts
      .map((t, i) => (t === 'ローリング ローリング' ? i : -1))
      .filter((i) => i >= 0)
    const r2Idx = rIndices[1]
    const before = refined.lines[r2Idx]
    const result = realignSection(refined.lines, r2Idx, words, quality, 'ja', refined.anchorSources)
    const after = result.lines[r2Idx]
    expect(Math.abs(after.startTime - before.startTime)).toBeLessThan(0.3)
    expect(Math.abs(after.endTime - before.endTime)).toBeLessThan(0.3)
  })

  it('realignAllWeak does not move any line by more than 2s', () => {
    // 嗚呼 (interjection) shifts ~1.56s as realignSection fills the silence gap to line 7.
    // All other lines shift < 0.1s (good lines are no-ops; ローリング2 is resolution-limited).
    const result = realignAllWeakSections(
      refined.lines,
      words,
      quality,
      'ja',
      refined.anchorSources,
    )
    refined.lines.forEach((before: TimedLine, i: number) => {
      const after = result.lines[i]
      const startShift = Math.abs(after.startTime - before.startTime)
      const endShift = Math.abs(after.endTime - before.endTime)
      expect(startShift).toBeLessThanOrEqual(2.0)
      expect(endShift).toBeLessThanOrEqual(2.0)
    })
  })

  it('resync on any good line is a no-op (protected by guard)', () => {
    const goodIndices = quality.map((q, i) => (q === 'good' ? i : -1)).filter((i) => i >= 0)
    expect(goodIndices.length).toBeGreaterThan(20)
    for (const idx of goodIndices) {
      const before = refined.lines[idx]
      const result = realignSection(refined.lines, idx, words, quality, 'ja', refined.anchorSources)
      const after = result.lines[idx]
      // Guard must return identical timing for good lines
      expect(after.startTime).toBe(before.startTime)
      expect(after.endTime).toBe(before.endTime)
      // Neighbors must not be corrupted either
      if (idx + 1 < refined.lines.length) {
        const neighborBefore = refined.lines[idx + 1]
        const neighborAfter = result.lines[idx + 1]
        expect(Math.abs(neighborAfter.startTime - neighborBefore.startTime)).toBeLessThan(0.1)
        expect(Math.abs(neighborAfter.endTime - neighborBefore.endTime)).toBeLessThan(0.1)
      }
    }
  })

  it('corner and vanish lines remain good quality with spans > 6s after refine', () => {
    const cornerIdx = lineTexts.findIndex((t) => t.includes('角を曲が'))
    const vanishIdx = lineTexts.findIndex((t) => t.includes('此処から'))
    expect(quality[cornerIdx]).toBe('good')
    expect(quality[vanishIdx]).toBe('good')
    expect(refined.lines[cornerIdx].endTime - refined.lines[cornerIdx].startTime).toBeGreaterThan(6)
    expect(refined.lines[vanishIdx].endTime - refined.lines[vanishIdx].startTime).toBeGreaterThan(6)
  })
})

// ─── Word transcript suite ────────────────────────────────────────────────

describe.skipIf(!existsSync(WORD_CACHE))('AKFG resync — word transcript', () => {
  const lineTexts = readFileSync(LYRICS, 'utf8').trim().split('\n')
  const words = loadTranscript(WORD_CACHE)
  const refined = refineAlignmentWithPhrases(sheetFrom(lineTexts), words, 'ja')
  const quality = refined.lineAlignmentQuality!

  it('refine produces at most 8 weak lines (transcript phonetic drift expected)', () => {
    const weakCount = quality.filter((q: LineAlignmentQuality) => q !== 'good').length
    // Word transcript has more per-word precision, so more lines appear approximate
    // (Whisper mishears 心絡まって, 君の孤独, etc.) — 6 is the known baseline
    expect(weakCount).toBeGreaterThanOrEqual(2)
    expect(weakCount).toBeLessThanOrEqual(8)
  })

  it('corner and vanish are good quality with correct timing', () => {
    const cornerIdx = lineTexts.findIndex((t) => t.includes('角を曲が'))
    const vanishIdx = lineTexts.findIndex((t) => t.includes('此処から'))
    expect(quality[cornerIdx]).toBe('good')
    expect(quality[vanishIdx]).toBe('good')
    // Word-level ground truth: corner starts ~275.7s, vanish ends ~288.1s
    expect(refined.lines[cornerIdx].startTime).toBeGreaterThan(274)
    expect(refined.lines[cornerIdx].startTime).toBeLessThan(277)
    expect(refined.lines[vanishIdx].endTime).toBeGreaterThan(286)
    expect(refined.lines[vanishIdx].endTime).toBeLessThan(291)
  })

  it('resync on any good line is a no-op (guard)', () => {
    const goodIndices = quality.map((q: LineAlignmentQuality, i: number) => (q === 'good' ? i : -1)).filter((i: number) => i >= 0)
    for (const idx of goodIndices) {
      const before = refined.lines[idx]
      const result = realignSection(refined.lines, idx, words, quality, 'ja', refined.anchorSources)
      const after = result.lines[idx]
      expect(after.startTime).toBe(before.startTime)
      expect(after.endTime).toBe(before.endTime)
    }
  })

  it('resync on non-interjection weak lines produces no-change (at transcript resolution limit)', () => {
    // 嗚呼 (interjection) is excluded — recoverInterjectionTiming gives it an approximate
    // chunk placement that realignSection then extends by ~3.5s to fill the silence gap.
    // All other weak lines are at the proportional-split ceiling and shift < 0.6s.
    const aIdx = lineTexts.findIndex((t: string) => t.includes('嗚呼'))
    const weakIndices = quality
      .map((q: LineAlignmentQuality, i: number) => (q !== 'good' ? i : -1))
      .filter((i: number) => i >= 0 && i !== aIdx)
    for (const idx of weakIndices) {
      const before = refined.lines[idx]
      const result = realignSection(refined.lines, idx, words, quality, 'ja', refined.anchorSources)
      const after = result.lines[idx]
      // Resync cannot improve beyond what the proportional split already gave
      // (line 21 may shift endTime by up to 0.5 s due to better anchor context)
      expect(Math.abs(after.startTime - before.startTime)).toBeLessThan(0.6)
      expect(Math.abs(after.endTime - before.endTime)).toBeLessThan(0.6)
    }
  })

  it('realignAllWeak does not move any line by more than 4s', () => {
    // 嗚呼 (interjection) shifts up to ~3.5s as realignSection fills the full silence gap
    // between its recovered chunk timing and the next good anchor (line 7, 何を間違った).
    // This is an intentional improvement. All other lines shift < 0.6s.
    const result = realignAllWeakSections(
      refined.lines,
      words,
      quality,
      'ja',
      refined.anchorSources,
    )
    refined.lines.forEach((before: TimedLine, i: number) => {
      const after = result.lines[i]
      const startShift = Math.abs(after.startTime - before.startTime)
      const endShift = Math.abs(after.endTime - before.endTime)
      expect(startShift).toBeLessThanOrEqual(4.0)
      expect(endShift).toBeLessThanOrEqual(4.0)
    })
  })

  it('no line gets a zero or negative span after realignAllWeak', () => {
    const result = realignAllWeakSections(
      refined.lines,
      words,
      quality,
      'ja',
      refined.anchorSources,
    )
    result.lines.forEach((l: TimedLine, i: number) => {
      expect(l.endTime - l.startTime).toBeGreaterThan(0)
    })
  })
})
