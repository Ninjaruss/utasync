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

describe('resolveLineReadings — adoption', () => {
  const sube = [tok('そんな', 'ソンナ'), tok('僕', 'ボク'), tok('に', 'ニ'),
    tok('術', 'ジュツ'), tok('は', 'ハ'), tok('ない', 'ナイ'), tok('よな', 'ヨナ')]

  it('adopts a real non-standard reading bracketed by anchors (術→すべ)', () => {
    const d = resolveLineReadings(sube, 'そんな僕にすべはないよな')
    const jutsu = d[3]
    expect(jutsu.kind).toBe('adopt')
    expect(jutsu.audioReading).toBe('すべ')
    expect(jutsu.confidence!).toBeGreaterThanOrEqual(0.8)
  })

  it('adopts 理由→わけ when the rest of the line matches', () => {
    const tokens = [tok('理由', 'リユウ'), tok('も', 'モ'), tok('ない', 'ナイ'), tok('のに', 'ノニ')]
    const d = resolveLineReadings(tokens, 'わけもないのに')
    expect(d[0].kind).toBe('adopt')
    expect(d[0].audioReading).toBe('わけ')
  })

  it('stays neutral when the differing span is NOT bracketed by anchors', () => {
    const d = resolveLineReadings(sube, 'まったくちがうおと')
    expect(d[3].kind).toBe('neutral')
  })

  it('stays neutral when the line is poorly aligned even if the span is clean', () => {
    const d = resolveLineReadings(sube, 'かきくけこすべさしすせそたちつてと')
    expect(d[3].kind).not.toBe('adopt')
  })

  // 凍てつく (いてつく) is mis-sung/mis-transcribed as 傷つく / 痛つく. comparableKana
  // drops the differing kanji (傷/痛), leaving only the shared okurigana つく — a
  // SUBSTRING of the correct reading いてつく, not a real alternate. Adopting つく
  // shows the wrong reading in sung mode. The shared-okurigana fragment must not
  // be adopted (nor flagged as a mismatch).
  it('does not adopt a shared-okurigana fragment of the dictionary reading (凍てつく)', () => {
    const ja = [
      tok('凍てつく', 'イテツク'), tok('世界', 'セカイ'), tok('を', 'ヲ'),
      tok('転がる', 'コロガル'), tok('よう', 'ヨウ'), tok('に', 'ニ'),
      tok('走り出し', 'ハシリダシ'), tok('た', 'タ'),
    ]
    const d = resolveLineReadings(ja, 'きずつくせかいをころがるようにはしりだした')
    expect(d[0].kind).not.toBe('adopt')
    expect(d[0].kind).not.toBe('mismatch')
  })
})
