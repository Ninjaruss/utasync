import { describe, it, expect } from 'vitest'
import { nwAlign, comparableKana, buildExpectedKana } from '../../src/ai-pipeline/readingAlignment'
import type { Token } from '../../src/core/types'

const tok = (surface: string, reading?: string): Token => ({
  surface, reading, pos: '名詞', startIndex: 0, endIndex: surface.length,
})

describe('nwAlign', () => {
  it('aligns identical strings as all matches', () => {
    const cols = nwAlign('あい', 'あい')
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: 1, b: 1 }])
  })

  it('represents a substitution as aligned mismatched columns', () => {
    const cols = nwAlign('あいう', 'あえう')
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: 1, b: 1 }, { a: 2, b: 2 }])
  })

  it('represents a deletion (extra A char) with b = -1', () => {
    const cols = nwAlign('あいう', 'あう')
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: 1, b: -1 }, { a: 2, b: 1 }])
  })

  it('represents an insertion (extra B char) with a = -1', () => {
    const cols = nwAlign('あう', 'あいう')
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: -1, b: 1 }, { a: 1, b: 2 }])
  })
})

describe('comparableKana', () => {
  it('lowercases katakana to hiragana and drops the long mark', () => {
    expect(comparableKana('スベ')).toBe('すべ')
    expect(comparableKana('アー')).toBe('あ')
  })
})

describe('buildExpectedKana', () => {
  it('concatenates token readings and maps each kana back to its token', () => {
    const tokens = [tok('僕', 'ボク'), tok('に', 'ニ'), tok('術', 'ジュツ')]
    const { a, owner } = buildExpectedKana(tokens)
    expect(a).toBe('ぼくにじゅつ')
    expect(owner).toEqual([0, 0, 1, 2, 2, 2])
  })
})

import { resolveLineReadings } from '../../src/ai-pipeline/readingAlignment'

describe('resolveLineReadings — verified & neutral', () => {
  it('skips kana-only tokens', () => {
    const tokens = [tok('の', 'ノ')]
    expect(resolveLineReadings(tokens, 'の')[0].kind).toBe('skip')
  })

  it('verifies a kanji token when the transcript wrote the kanji', () => {
    const tokens = [tok('車', 'クルマ')]
    expect(resolveLineReadings(tokens, '小さな車は')[0]).toEqual({ kind: 'verified', confidence: 1 })
  })

  it('verifies when the sung kana match the dictionary reading', () => {
    const tokens = [tok('戦争', 'センソウ')]
    const d = resolveLineReadings(tokens, 'せんそう')[0]
    expect(d.kind).toBe('verified')
  })

  it('stays neutral when there is no transcript kana', () => {
    const tokens = [tok('戦争', 'センソウ')]
    expect(resolveLineReadings(tokens, '')[0].kind).toBe('neutral')
  })
})
