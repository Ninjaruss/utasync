import { describe, it, expect } from 'vitest'
import { mergeBilingualAlignments } from '../../src/lyrics/bilingualMerge'
import type { TimedLine, SungPhrase } from '../../src/core/types'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original, translation: '', startTime, endTime,
})

const phrase = (
  id: string, sourceLineIndices: number[], startTime: number, endTime: number,
): SungPhrase => ({
  id, startTime, endTime, original: id, translation: '',
  anchorSource: 'lcs', sourceLineIndices,
})

const word = (w: string, startTime: number, endTime: number): TranscriptWord => ({
  word: w, startTime, endTime,
})

function align(
  lines: TimedLine[],
  quality: Array<'good' | 'approximate' | 'needs_review'>,
  phrases: SungPhrase[] = [],
): RefinedAlignment {
  return {
    lines, phrases, report: {} as never, mode: 'content', confidence: 1,
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

  it('with wordsForActivity: a good-selected line keeps its time; only the needs_review neighbor redistributes', () => {
    // Line 0 is selected 'good' from the EN pass with a SHORT span (12..12.5) that
    // has NO matching word activity there — all the activity clusters near 40s.
    // Without an anchoredMask, redistributeDegenerateRuns re-scores line 0 against
    // its local word window, finds no English activity, treats it as non-'good',
    // and sweeps it onto the far Japanese-region audio (~40s) — while its returned
    // label still says 'good'. The mask must protect line 0 so only the genuinely
    // unanchored needs_review line 1 moves. (Verified: this scenario re-times line 0
    // to ~40s without the mask; with it, line 0 stays 12..12.5.)
    const s = [line('I found a place where I am not alone', 0, 0), line('過去の輝きに価値はない', 0, 0)]
    const alignJ = align(
      [line('I found a place where I am not alone', 8, 9), line('過去の輝きに価値はない', 9, 9.2)],
      ['needs_review', 'needs_review'],
    )
    const alignE = align(
      [line('I found a place where I am not alone', 12, 12.5), line('過去の輝きに価値はない', 12.5, 12.7)],
      ['good', 'needs_review'],
    )
    // Activity words all cluster near 40s (Japanese-region), none near line 0's 12s span.
    const words: TranscriptWord[] = [
      word('かこ', 40.0, 40.4), word('かがやき', 40.4, 41.0), word('ない', 41.0, 41.5),
    ]
    const merged = mergeBilingualAlignments(s, alignJ, alignE, 'ja', words)
    // The good EN-selected line 0 keeps its selected start and stays on its 12s span
    // — NOT swept to the far ~40s activity. (Without the mask it moves to ~40s; see
    // the NOMASK vs MASK reproduction. A sub-second end-clip from the neighbor
    // redistributing away is expected and leaves the start anchored.)
    expect(merged.lines[0].startTime).toBe(12)
    expect(merged.lines[0].startTime).toBeLessThan(13)
    // The needs_review neighbor is the one that moved (redistributed onto the ~40s activity).
    expect(merged.lines[1].startTime).toBeGreaterThan(30)
    expect(merged.lines[1].endTime - merged.lines[1].startTime).toBeGreaterThan(0.3)
    // Labels stay honest: line 0 still good, line 1 still needs_review.
    expect(merged.lineAlignmentQuality).toEqual(['good', 'needs_review'])
  })

  it('merges non-identical phrase sets: sorted, defined times, 1:1 line coverage', () => {
    // Default SHEET layout: phrases are 1:1 with lines. The two passes carry the
    // SAME per-line phrase structure but list them in a DIFFERENT order and with
    // different times; selection routes JA-script lines to J's phrase and Latin
    // lines to E's phrase. We assert clean 1:1 coverage of the merged lines.
    // (Multi-line phrase spans that diverge across passes are a documented
    // follow-up — see mergePhrases; not exercised here.)
    const s = [
      line('ただ', 0, 0), line('I found a place', 0, 0),
      line('過去', 0, 0), line('Tore down the gates', 0, 0),
    ]
    const alignJ = align(
      [line('ただ', 10, 12), line('I found a place', 12, 14), line('過去', 20, 22), line('Tore down the gates', 22, 24)],
      ['good', 'needs_review', 'good', 'needs_review'],
      [phrase('J-line0', [0], 10, 12), phrase('J-line1', [1], 12, 14), phrase('J-line2', [2], 20, 22), phrase('J-line3', [3], 22, 24)],
    )
    const alignE = align(
      [line('ただ', 5, 5.3), line('I found a place', 13, 16), line('過去', 17, 17.3), line('Tore down the gates', 24, 28)],
      ['needs_review', 'good', 'needs_review', 'good'],
      // Deliberately different order + only the Latin lines' phrases matter here.
      [phrase('E-line3', [3], 24, 28), phrase('E-line1', [1], 13, 16), phrase('E-line0', [0], 5, 5.3), phrase('E-line2', [2], 17, 17.3)],
    )
    const merged = mergeBilingualAlignments(s, alignJ, alignE)
    const ph = merged.phrases
    // (a) no undefined/non-finite times
    for (const p of ph) {
      expect(Number.isFinite(p.startTime)).toBe(true)
      expect(Number.isFinite(p.endTime)).toBe(true)
    }
    // (b) sorted by startTime
    for (let i = 1; i < ph.length; i++) {
      expect(ph[i].startTime).toBeGreaterThanOrEqual(ph[i - 1].startTime)
    }
    // (c) each of the 4 merged line indices covered by exactly one phrase
    const cover = new Map<number, number>()
    for (const p of ph) for (const li of p.sourceLineIndices) cover.set(li, (cover.get(li) ?? 0) + 1)
    for (let li = 0; li < merged.lines.length; li++) expect(cover.get(li)).toBe(1)
    // Times resync to merged lines: E-line3 span follows the merged line-3 time.
    const l3 = ph.find((p) => p.sourceLineIndices.includes(3))!
    expect(l3.startTime).toBe(merged.lines[3].startTime)
    expect(l3.endTime).toBe(merged.lines[3].endTime)
  })
})
