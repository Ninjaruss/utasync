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

const here = dirname(fileURLToPath(import.meta.url))
const SEGMENT_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_segment.json')
const LYRICS = join(here, 'fixtures/akfg-user-ja.txt')

function fmt(t: number): string {
  const m = Math.floor(t / 60)
  return `${m}:${(t % 60).toFixed(1).padStart(4, '0')}`
}

function sheetFrom(lines: string[]) {
  return lines.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
}

describe.skipIf(!existsSync(SEGMENT_CACHE))('AKFG refine + re-sync integration', () => {
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

  const firstClauseIdx = lineTexts.findIndex((t) => t.includes('何を間違った'))
  const secondClauseIdx = lineTexts.findIndex((t) => t.includes('何をなくした'))
  const firstRollingIdx = firstClauseIdx + 1
  const secondRollingIdx = secondClauseIdx + 1
  const finalEntwinedIdx = lineTexts.length - 2
  const finalRunIdx = lineTexts.length - 1

  function assertLocalMonotonic(
    lines: { startTime: number; endTime: number }[],
    lo: number,
    hi: number,
  ) {
    for (let i = lo + 1; i <= hi; i++) {
      expect(lines[i].startTime).toBeGreaterThanOrEqual(lines[i - 1].startTime - 0.01)
      expect(lines[i].startTime).toBeLessThanOrEqual(lines[i - 1].endTime + 0.25)
    }
  }

  function assertSecondChorusPair(lines: { startTime: number; endTime: number }[]) {
    const clause = lines[secondClauseIdx]
    const rolling = lines[secondRollingIdx]
    const refClause = lines[firstClauseIdx]
    const refRolling = lines[firstRollingIdx]

    expect(clause.endTime - clause.startTime).toBeGreaterThan((refClause.endTime - refClause.startTime) * 0.85)
    expect(rolling.endTime - rolling.startTime).toBeGreaterThan((refRolling.endTime - refRolling.startTime) * 0.85)
    expect(clause.endTime).toBeGreaterThan(296.5)
    expect(rolling.startTime).toBeGreaterThanOrEqual(clause.endTime - 0.15)
    expect(rolling.startTime).toBeGreaterThan(296.5)
    expect(rolling.startTime).toBeLessThan(297.5)
    expect(rolling.endTime).toBeLessThanOrEqual(lines[secondRollingIdx + 1].startTime + 0.05)
    expect(rolling.endTime - rolling.startTime).toBeGreaterThan(1.8)
  }

  it('refine sets second-chorus clause + rolling like chorus 1', () => {
    const refined = refineAlignmentWithPhrases(sheetFrom(lineTexts), words, 'ja')
    assertSecondChorusPair(refined.lines)
    assertLocalMonotonic(refined.lines, secondClauseIdx, secondRollingIdx + 1)
  })

  it('re-sync on rolling line preserves pair split (does not squash to 1s)', () => {
    const refined = refineAlignmentWithPhrases(sheetFrom(lineTexts), words, 'ja')
    const before = {
      clause: { ...refined.lines[secondClauseIdx] },
      rolling: { ...refined.lines[secondRollingIdx] },
    }

    const resynced = realignSection(
      refined.lines,
      secondRollingIdx,
      words,
      refined.lineAlignmentQuality!,
      'ja',
      refined.anchorSources,
    )

    assertSecondChorusPair(resynced.lines)
    assertLocalMonotonic(resynced.lines, secondClauseIdx, secondRollingIdx + 1)

    const rolling = resynced.lines[secondRollingIdx]
    expect(rolling.endTime - rolling.startTime).toBeGreaterThan(1.8)
    expect(rolling.startTime).toBeCloseTo(before.rolling.startTime, 0)
    expect(rolling.endTime).toBeCloseTo(before.rolling.endTime, 0)
  })

  it('re-sync on clause line does not swallow rolling into 6s block', () => {
    const refined = refineAlignmentWithPhrases(sheetFrom(lineTexts), words, 'ja')
    const resynced = realignSection(
      refined.lines,
      secondClauseIdx,
      words,
      refined.lineAlignmentQuality!,
      'ja',
      refined.anchorSources,
    )

    assertSecondChorusPair(resynced.lines)
    expect(resynced.lines[secondClauseIdx].endTime - resynced.lines[secondClauseIdx].startTime).toBeLessThan(5.5)
  })

  it('re-sync repairs squashed rolling after broken pass1 merge', () => {
    const refined = refineAlignmentWithPhrases(sheetFrom(lineTexts), words, 'ja')
    const broken = refined.lines.map((l) => ({ ...l }))
    // Simulate pre-refine merged state from alignLyrics on segment transcript.
    broken[secondClauseIdx].startTime = 292.8
    broken[secondClauseIdx].endTime = 299.2
    broken[secondRollingIdx].startTime = 298.9
    broken[secondRollingIdx].endTime = 299.2
    const quality = [...refined.lineAlignmentQuality!]
    quality[secondRollingIdx] = 'needs_review'

    const resynced = realignSection(
      broken,
      secondRollingIdx,
      words,
      quality,
      'ja',
      refined.anchorSources,
    )

    assertSecondChorusPair(resynced.lines)
  })

  it('realignAllWeak does not squash second-chorus rolling', () => {
    const refined = refineAlignmentWithPhrases(sheetFrom(lineTexts), words, 'ja')
    const all = realignAllWeakSections(
      refined.lines,
      words,
      refined.lineAlignmentQuality!,
      'ja',
      refined.anchorSources,
    )

    assertSecondChorusPair(all.lines)
    assertLocalMonotonic(all.lines, secondClauseIdx, secondRollingIdx + 1)
  })

  it('re-sync on final entwined rolling keeps non-zero span', () => {
    const refined = refineAlignmentWithPhrases(sheetFrom(lineTexts), words, 'ja')
    const beforeSpan = refined.lines[finalEntwinedIdx].endTime - refined.lines[finalEntwinedIdx].startTime
    expect(beforeSpan).toBeGreaterThan(1.5)

    const resynced = realignSection(
      refined.lines,
      finalEntwinedIdx,
      words,
      refined.lineAlignmentQuality!,
      'ja',
      refined.anchorSources,
    )

    const entwined = resynced.lines[finalEntwinedIdx]
    const run = resynced.lines[finalRunIdx]
    expect(entwined.endTime - entwined.startTime).toBeGreaterThan(1.5)
    expect(run.endTime - run.startTime).toBeGreaterThan(2.5)
    expect(run.startTime).toBeLessThanOrEqual(entwined.endTime + 0.15)
  })

  it('logs stable second-chorus timing snapshot for debugging', () => {
    const refined = refineAlignmentWithPhrases(sheetFrom(lineTexts), words, 'ja')
    const resynced = realignSection(
      refined.lines,
      secondRollingIdx,
      words,
      refined.lineAlignmentQuality!,
      'ja',
      refined.anchorSources,
    )
    const clause = resynced.lines[secondClauseIdx]
    const rolling = resynced.lines[secondRollingIdx]
    expect(`${fmt(clause.startTime)}-${fmt(clause.endTime)}`).toMatch(/^4:52/)
    expect(`${fmt(rolling.startTime)}-${fmt(rolling.endTime)}`).toMatch(/^4:5[6-9]/)
  })
})
