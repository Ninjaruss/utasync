import { describe, it, expect } from 'vitest'
import type { LyricsData, SungPhrase, TimedLine } from '../../src/core/types'
import {
  summarizePhraseChanges,
  phrasesToTimedLines,
  applySungLayout,
  revertToSheetLayout,
} from '../../src/lyrics/phraseLayout'

const line = (original: string, startTime: number, endTime: number, translation = ''): TimedLine => ({
  original,
  translation,
  startTime,
  endTime,
})

const phrase = (
  original: string,
  sourceLineIndices: number[],
  startTime: number,
  endTime: number,
  translation = '',
): SungPhrase => ({
  id: `p-${sourceLineIndices.join('-')}-${startTime}`,
  startTime,
  endTime,
  original,
  translation,
  anchorSource: 'lcs',
  sourceLineIndices,
})

const lyrics = (over: Partial<LyricsData>): LyricsData => ({
  lines: [],
  sourceLanguage: 'ja',
  translationLanguage: 'en',
  alignmentMode: 'auto',
  ...over,
})

describe('summarizePhraseChanges', () => {
  it('reports a merge with before/after text', () => {
    const lines = [line('岩は転がって', 1, 4, 'The rock rolls'), line('', 4, 5, 'and falls')]
    const phrases = [phrase('岩は転がって', [0, 1], 1, 5, 'The rock rolls and falls')]
    const changes = summarizePhraseChanges(lines, phrases)
    expect(changes).toEqual([
      { kind: 'merge', sourceLineIndices: [0, 1], before: ['岩は転がって', ''], after: ['岩は転がって'] },
    ])
  })

  it('reports a split with both resulting phrases', () => {
    const lines = [line('君の声が　遠くで響く', 0, 10)]
    const phrases = [phrase('君の声が', [0], 0, 4), phrase('遠くで響く', [0], 4, 10)]
    const changes = summarizePhraseChanges(lines, phrases)
    expect(changes).toEqual([
      { kind: 'split', sourceLineIndices: [0], before: ['君の声が　遠くで響く'], after: ['君の声が', '遠くで響く'] },
    ])
  })

  it('ignores passthrough rows (no change)', () => {
    const lines = [line('歩いて行こう', 1, 3), line('明日へ', 3, 5)]
    const phrases = [phrase('歩いて行こう', [0], 1, 3), phrase('明日へ', [1], 3, 5)]
    expect(summarizePhraseChanges(lines, phrases)).toEqual([])
  })
})

describe('phrasesToTimedLines', () => {
  it('produces one display row per phrase carrying timing, text and tokens', () => {
    const p = phrase('歩いた', [0], 1, 3, 'I walked')
    p.tokens = [{ surface: '歩いた', startIndex: 0, endIndex: 3 }]
    expect(phrasesToTimedLines([p])).toEqual([
      { startTime: 1, endTime: 3, original: '歩いた', translation: 'I walked', tokens: p.tokens },
    ])
  })
})

describe('applySungLayout / revertToSheetLayout', () => {
  it('switches lines to the phrase rows and snapshots the sheet', () => {
    const sheet = [line('君の声が　遠くで響く', 0, 10)]
    const phrases = [phrase('君の声が', [0], 0, 4), phrase('遠くで響く', [0], 4, 10)]
    const applied = applySungLayout(lyrics({ lines: sheet, phrases }))
    expect(applied.phraseLayout).toBe('sung')
    expect(applied.lines.map((l) => l.original)).toEqual(['君の声が', '遠くで響く'])
    expect(applied.sheetLinesSnapshot).toEqual(sheet)
  })

  it('restores the original sheet rows and clears the snapshot on revert', () => {
    const sheet = [line('君の声が　遠くで響く', 0, 10)]
    const phrases = [phrase('君の声が', [0], 0, 4), phrase('遠くで響く', [0], 4, 10)]
    const reverted = revertToSheetLayout(applySungLayout(lyrics({ lines: sheet, phrases })))
    expect(reverted.phraseLayout).toBe('sheet')
    expect(reverted.lines).toEqual(sheet)
    expect(reverted.sheetLinesSnapshot).toBeUndefined()
  })

  it('does not clobber the original snapshot when applied twice', () => {
    const sheet = [line('君の声が　遠くで響く', 0, 10)]
    const phrases = [phrase('君の声が', [0], 0, 4), phrase('遠くで響く', [0], 4, 10)]
    const once = applySungLayout(lyrics({ lines: sheet, phrases }))
    const twice = applySungLayout(once)
    expect(twice.sheetLinesSnapshot).toEqual(sheet)
  })

  it('is a no-op when there are no phrases', () => {
    const base = lyrics({ lines: [line('歩いた', 1, 3)] })
    expect(applySungLayout(base)).toBe(base)
  })
})
