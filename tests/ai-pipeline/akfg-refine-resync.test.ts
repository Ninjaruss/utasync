import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

const here = dirname(fileURLToPath(import.meta.url))
const SEGMENT_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_segment.json')
const LYRICS = join(here, 'fixtures/akfg-user-ja.txt')

function sheetFrom(lines: string[]) {
  return lines.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))
}

describe.skipIf(!existsSync(SEGMENT_CACHE))('AKFG refine — second-chorus pair', () => {
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
})
