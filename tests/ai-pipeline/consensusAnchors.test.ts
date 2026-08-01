import { describe, expect, it } from 'vitest'
import type { TimedLine, LineAlignmentQuality } from '../../src/core/types'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'
import { consensusAgreedLines, refineMixedLanguageAlignment } from '../../src/ai-pipeline/mixedLanguageAlign'

const RANK_QUALITY: LineAlignmentQuality[] = ['needs_review', 'approximate', 'good']

const line = (startTime: number): TimedLine => ({
  original: '',
  translation: '',
  startTime,
  endTime: startTime + 1,
})

// lineRank(pass, li) reads pass.mode (must not be 'proportional') and
// pass.lineAlignmentQuality?.[li] via QUALITY_RANK — so a fake pass only needs
// those two fields (plus `lines` for the startTime lookups) to drive rank>=1.
function fakePass(starts: (number | null)[], ranks: number[]): RefinedAlignment {
  return {
    lines: starts.map((s) => (s == null ? line(0) : line(s))),
    phrases: [],
    report: { merged: 0, split: 0, dropped: 0 } as unknown as RefinedAlignment['report'],
    mode: 'content',
    confidence: 0.5,
    anchorSources: ranks.map(() => 'lcs'),
    lineAlignmentQuality: ranks.map((r) => RANK_QUALITY[r]),
    phraseLayout: 'sheet',
    sheetLinesSnapshot: undefined,
  }
}

describe('consensusAgreedLines', () => {
  it('returns lines where both passes agree within tolerance and both have evidence', () => {
    const ja = fakePass([10, 20, 30, 40], [2, 2, 2, 0])
    const en = fakePass([10.5, 28, 30.2, 40], [2, 2, 2, 0])
    const agreed = consensusAgreedLines(ja, en)
    // line 0: |10-10.5|<=2.5 both evidenced -> agreed at midpoint
    // line 1: |20-28|>2.5 -> not agreed
    // line 2: agreed; line 3: no evidence (rank 0) -> not agreed
    expect(agreed.map((a) => a.li)).toEqual([0, 2])
    expect(agreed[0].time).toBeCloseTo(10.25, 5)
  })
})

describe('refineMixedLanguageAlignment passes exposure', () => {
  it('returns the inner ja/en passes', () => {
    const rows = [{ original: 'テスト line', translation: '', startTime: 0, endTime: 0 }]
    const words = [{ word: 'テスト', startTime: 1, endTime: 2 }]
    const res = refineMixedLanguageAlignment(rows, words, words)
    expect(res.passes.ja.lines).toHaveLength(1)
    expect(res.passes.en.lines).toHaveLength(1)
  })
})
