import { describe, it, expect } from 'vitest'
import { mergeBilingualAlignments } from '../../src/lyrics/bilingualMerge'
import type { TimedLine } from '../../src/core/types'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original, translation: '', startTime, endTime,
})

function align(
  lines: TimedLine[],
  quality: Array<'good' | 'approximate' | 'needs_review'>,
): RefinedAlignment {
  return {
    lines, phrases: [], report: {} as never, mode: 'content', confidence: 1,
    anchorSources: lines.map(() => 'lcs' as never),
    lineAlignmentQuality: quality,
    phraseLayout: 'sheet',
  }
}

const sheet = [
  line('ただただ荒れていく時代に', 0, 0),
  line('I found a place where I am not alone', 0, 0),
  line('過去の輝きに価値はない', 0, 0),
  line('Tore down the gates took all my pain', 0, 0),
]

describe('mergeBilingualAlignments', () => {
  it('takes JA-script lines from the JA pass and Latin lines from the EN pass', () => {
    const alignJ = align([
      line('ただただ荒れていく時代に', 10, 12),
      line('I found a place where I am not alone', 12, 12.3),
      line('過去の輝きに価値はない', 20, 22),
      line('Tore down the gates took all my pain', 22, 22.3),
    ], ['good', 'needs_review', 'good', 'needs_review'])
    const alignE = align([
      line('ただただ荒れていく時代に', 5, 5.3),
      line('I found a place where I am not alone', 13, 16),
      line('過去の輝きに価値はない', 17, 17.3),
      line('Tore down the gates took all my pain', 24, 28),
    ], ['needs_review', 'good', 'needs_review', 'good'])
    const merged = mergeBilingualAlignments(sheet, alignJ, alignE)
    expect(merged.lines[0]).toMatchObject({ startTime: 10, endTime: 12 })
    expect(merged.lines[1]).toMatchObject({ startTime: 13, endTime: 16 })
    expect(merged.lines[2]).toMatchObject({ startTime: 20, endTime: 22 })
    expect(merged.lines[3]).toMatchObject({ startTime: 24, endTime: 28 })
    for (let i = 1; i < merged.lines.length; i++) {
      expect(merged.lines[i].startTime).toBeGreaterThanOrEqual(merged.lines[i - 1].startTime)
    }
    expect(merged.lineAlignmentQuality).toEqual(['good', 'good', 'good', 'good'])
  })

  it('quality tie-break: a Latin line the EN pass could not anchor falls back to a good JA-pass result', () => {
    const s = [line('過去の輝きに価値はない', 0, 0), line('Oh la la la', 0, 0)]
    const alignJ = align([line('過去の輝きに価値はない', 10, 12), line('Oh la la la', 12, 14)], ['good', 'good'])
    const alignE = align([line('過去の輝きに価値はない', 5, 5.3), line('Oh la la la', 40, 40.3)], ['needs_review', 'needs_review'])
    const merged = mergeBilingualAlignments(s, alignJ, alignE)
    expect(merged.lines[1]).toMatchObject({ startTime: 12, endTime: 14 })
    expect(merged.lineAlignmentQuality![1]).toBe('good')
  })

  it('blank/interjection lines default to the JA pass', () => {
    const s = [line('心の形を作る', 0, 0), line('嗚呼', 0, 0)]
    const alignJ = align([line('心の形を作る', 10, 12), line('嗚呼', 12, 13)], ['good', 'approximate'])
    const alignE = align([line('心の形を作る', 5, 5.3), line('嗚呼', 30, 30.3)], ['needs_review', 'needs_review'])
    const merged = mergeBilingualAlignments(s, alignJ, alignE)
    expect(merged.lines[1]).toMatchObject({ startTime: 12, endTime: 13 })
  })

  it('returns the JA alignment unchanged when the EN alignment is null (EN pass failed)', () => {
    const alignJ = align([line('ただ', 10, 12), line('I found a place', 12, 14)], ['good', 'needs_review'])
    const merged = mergeBilingualAlignments([line('ただ', 0, 0), line('I found a place', 0, 0)], alignJ, null)
    expect(merged.lines).toEqual(alignJ.lines)
  })
})
