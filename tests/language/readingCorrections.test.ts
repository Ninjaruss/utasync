import { describe, it, expect } from 'vitest'
import type { Token } from '../../src/core/types'
import { applyReadingCorrections } from '../../src/language/japanese/readingCorrections'

const tok = (surface: string, reading: string, pos = '名詞'): Token => ({
  surface,
  reading,
  pos,
  startIndex: 0,
  endIndex: surface.length,
})

describe('applyReadingCorrections', () => {
  it('corrects 角 from かく to かど (corner) for a standalone noun', () => {
    const [out] = applyReadingCorrections([tok('角', 'カク')])
    expect(out.reading).toBe('カド')
  })

  it('corrects 術 from じゅつ to すべ (means/way)', () => {
    const [out] = applyReadingCorrections([tok('術', 'ジュツ')])
    expect(out.reading).toBe('スベ')
  })

  it('leaves a correct reading untouched', () => {
    const [out] = applyReadingCorrections([tok('角', 'カド')])
    expect(out.reading).toBe('カド')
  })

  it('does not touch compound tokens with a different surface', () => {
    const [out] = applyReadingCorrections([tok('角度', 'カクド')])
    expect(out.reading).toBe('カクド')
  })

  it('does not touch unrelated tokens or change identity fields', () => {
    const tokens = [tok('世界', 'セカイ'), tok('角', 'カク')]
    const out = applyReadingCorrections(tokens)
    expect(out[0].reading).toBe('セカイ')
    expect(out[1]).toMatchObject({ surface: '角', startIndex: 0 })
  })

  it('corrects 粉雪 from こゆき to こなゆき', () => {
    const [out] = applyReadingCorrections([tok('粉雪', 'コユキ')])
    expect(out.reading).toBe('コナユキ')
  })
})

describe('applyReadingCorrections — context rules', () => {
  // IPADIC splits 彷徨う into 彷徨[ホウコウ]+う, so the ruby reads ほうこう while
  // the song sings さまよ(う). The correction needs the next token as context:
  // standalone 彷徨 really is ほうこう.
  it('corrects 彷徨 to さまよ when followed by う', () => {
    const out = applyReadingCorrections([tok('彷徨', 'ホウコウ'), tok('う', 'ウ', '助動詞')])
    expect(out[0].reading).toBe('サマヨ')
  })

  it('corrects 彷徨 to さまよ when followed by っ (彷徨った)', () => {
    const out = applyReadingCorrections([tok('彷徨', 'ホウコウ'), tok('っ', 'ッ', '動詞')])
    expect(out[0].reading).toBe('サマヨ')
  })

  it('leaves standalone 彷徨 as ほうこう', () => {
    const out = applyReadingCorrections([tok('彷徨', 'ホウコウ'), tok('の', 'ノ', '助詞')])
    expect(out[0].reading).toBe('ホウコウ')
  })
})

describe('applyReadingCorrections — numeral gemination', () => {
  // Mirrors kuromoji's tagging: numerals are 名詞,数 and counters 名詞,接尾.
  const numeral = (surface: string, reading: string): Token => ({
    surface, reading, pos: '名詞', posDetail1: '数', startIndex: 0, endIndex: surface.length,
  })
  const counter = (surface: string, reading: string): Token => ({
    surface, reading, pos: '名詞', posDetail1: '接尾', startIndex: 0, endIndex: surface.length,
  })

  it('geminates 一+歩 to いっ+ぽ (not いち+ほ)', () => {
    const out = applyReadingCorrections([numeral('一', 'イチ'), counter('歩', 'ホ')])
    expect(out[0].reading).toBe('イッ')
    expect(out[1].reading).toBe('ポ')
  })

  it('geminates 一+回 to いっ+かい', () => {
    const out = applyReadingCorrections([numeral('一', 'イチ'), counter('回', 'カイ')])
    expect(out[0].reading).toBe('イッ')
    expect(out[1].reading).toBe('カイ')
  })

  it('does not geminate before a voiced counter (一番 = いちばん)', () => {
    const out = applyReadingCorrections([numeral('一', 'イチ'), counter('番', 'バン')])
    expect(out[0].reading).toBe('イチ')
    expect(out[1].reading).toBe('バン')
  })

  it('does not geminate when the next token is not a counter suffix', () => {
    const out = applyReadingCorrections([numeral('一', 'イチ'), tok('人生', 'ジンセイ')])
    expect(out[0].reading).toBe('イチ')
  })
})
