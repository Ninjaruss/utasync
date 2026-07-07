import { describe, it, expect } from 'vitest'
import type { Token } from '../../../src/core/types'
import {
  findMorphSpans,
  lineTextFromTokens,
  morphMergeGroups,
  tokenIndicesInSpan,
} from '../../../src/language/japanese/morphSpans'
import { buildAlignmentUnits } from '../../../src/ai-pipeline/wordAligner'

const contiguous =(tokens: Omit<Token, 'startIndex' | 'endIndex'>[]): Token[] => {
  let cursor = 0
  return tokens.map((t) => {
    const start = cursor
    cursor += t.surface.length
    return { ...t, startIndex: start, endIndex: cursor }
  })
}

describe('findMorphSpans', () => {
  it('finds concessive たって on full adjective stem', () => {
    const spans = findMorphSpans('どんなに冷たくたって')
    expect(spans.some((s) => s.label === '〜たって')).toBe(true)
  })

  it('finds negative te-form span', () => {
    const spans = findMorphSpans('あなたが居なくて')
    expect(spans.some((s) => s.label === '〜なくて')).toBe(true)
  })

  it('finds negative potential れない span', () => {
    const spans = findMorphSpans('触れない思い')
    expect(spans.some((s) => s.label === '〜れない')).toBe(true)
  })

  it('finds te-miseru span', () => {
    const spans = findMorphSpans('愛してみせるよ')
    expect(spans.some((s) => s.label === '〜てみせる')).toBe(true)
  })
})

describe('morphMergeGroups', () => {
  it('merges kuromoji-split concessive tail into one group', () => {
    const tokens = contiguous([
      { surface: '冷たく', pos: '形容詞,自立', reading: 'ツメタク' },
      { surface: 'たっ', pos: '助動詞', reading: 'タッ' },
      { surface: 'て', pos: '助詞,接続助詞', reading: 'テ' },
    ])
    const groups = morphMergeGroups(tokens)
    expect(groups).toEqual([[0, 1, 2]])
  })

  it('merges negative te when verb stem is split from なく+て', () => {
    const tokens = contiguous([
      { surface: '居', pos: '動詞,自立', reading: 'イ' },
      { surface: 'なく', pos: '助動詞', reading: 'ナク' },
      { surface: 'て', pos: '助詞,接続助詞', reading: 'テ' },
    ])
    expect(morphMergeGroups(tokens)).toEqual([[0, 1, 2]])
  })
})

describe('buildAlignmentUnits grammar spans', () => {
  it('uses span-driven merge for 見ていたい', () => {
    const tokens = contiguous([
      { surface: '見', pos: '動詞,自立', reading: 'ミ' },
      { surface: 'て', pos: '助詞,接続助詞', reading: 'テ' },
      { surface: 'い', pos: '動詞,非自立', reading: 'イ' },
      { surface: 'たい', pos: '助動詞', reading: 'タイ' },
    ])
    expect(buildAlignmentUnits(tokens).map((u) => u.embedText)).toEqual(['見ていたい'])
  })

  it('does not over-merge directional てく chains', () => {
    const tokens = contiguous([
      { surface: '溶け', pos: '動詞,自立', reading: 'トケ' },
      { surface: 'て', pos: '助詞,接続助詞', reading: 'テ' },
      { surface: 'く', pos: '動詞,非自立', reading: 'ク' },
    ])
    const units = buildAlignmentUnits(tokens)
    expect(units.length).toBeGreaterThan(1)
    expect(units.some((u) => u.embedText === '溶けてく')).toBe(false)
  })
})

describe('tokenIndicesInSpan', () => {
  it('maps char span back to token indices', () => {
    const tokens = contiguous([
      { surface: '愛', pos: '動詞,自立', reading: 'アイ' },
      { surface: 'し', pos: '動詞,自立', reading: 'シ' },
      { surface: 'て', pos: '助詞,接続助詞', reading: 'テ' },
      { surface: 'みせ', pos: '動詞,非自立', reading: 'ミセ' },
      { surface: 'る', pos: '助動詞', reading: 'ル' },
    ])
    const text = lineTextFromTokens(tokens)
    const span = findMorphSpans(text).find((s) => s.label === '〜てみせる')
    expect(span).toBeTruthy()
    if (span) {
      expect(tokenIndicesInSpan(tokens, span.start, span.end)).toEqual([0, 1, 2, 3, 4])
    }
  })
})
