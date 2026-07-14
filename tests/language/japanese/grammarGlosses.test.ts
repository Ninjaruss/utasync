import { describe, it, expect } from 'vitest'
import { grammarGloss, isGrammarToken } from '../../../src/language/japanese/grammarGlosses'
import type { Token } from '../../../src/core/types'

const tok = (patch: Partial<Token> & { surface: string }): Token => ({
  startIndex: 0,
  endIndex: patch.surface.length,
  ...patch,
})

describe('isGrammarToken', () => {
  it('recognizes particles and auxiliaries', () => {
    expect(isGrammarToken(tok({ surface: 'は', pos: '助詞' }))).toBe(true)
    expect(isGrammarToken(tok({ surface: 'た', pos: '助動詞' }))).toBe(true)
  })

  it('recognizes dependent grammar verbs and formal nouns (非自立)', () => {
    expect(isGrammarToken(tok({ surface: 'てる', pos: '動詞', posDetail1: '非自立' }))).toBe(true)
    expect(isGrammarToken(tok({ surface: 'こと', pos: '名詞', posDetail1: '非自立' }))).toBe(true)
  })

  it('does not flag content words', () => {
    expect(isGrammarToken(tok({ surface: '空', reading: 'ソラ', pos: '名詞' }))).toBe(false)
    expect(isGrammarToken(tok({ surface: '走る', pos: '動詞', posDetail1: '自立' }))).toBe(false)
  })
})

describe('grammarGloss', () => {
  it('glosses core case particles by function, not homophones', () => {
    expect(grammarGloss(tok({ surface: 'は', pos: '助詞', posDetail1: '係助詞' }))).toMatch(/topic/)
    expect(grammarGloss(tok({ surface: 'が', pos: '助詞', posDetail1: '格助詞' }))).toMatch(/subject/)
    expect(grammarGloss(tok({ surface: 'を', pos: '助詞', posDetail1: '格助詞' }))).toMatch(/object/)
    expect(grammarGloss(tok({ surface: 'の', pos: '助詞', posDetail1: '連体化' }))).toMatch(/possessive/)
  })

  it('disambiguates の by particle subtype (possessive vs sentence-ending)', () => {
    expect(grammarGloss(tok({ surface: 'の', pos: '助詞', posDetail1: '終助詞' }))).toMatch(/explanatory/)
  })

  it('glosses auxiliaries via their baseForm (かっ → た past)', () => {
    expect(grammarGloss(tok({ surface: 'た', pos: '助動詞', baseForm: 'た' }))).toMatch(/past/)
    expect(grammarGloss(tok({ surface: 'ん', pos: '助動詞', baseForm: 'ぬ' }))).toMatch(/negat/)
    expect(grammarGloss(tok({ surface: 'ましょ', pos: '助動詞', baseForm: 'ます' }))).toMatch(/polite/)
  })

  it('glosses dependent grammar verbs (てる → ている progressive)', () => {
    expect(grammarGloss(tok({ surface: 'てる', pos: '動詞', posDetail1: '非自立', baseForm: 'てる' }))).toMatch(/progressive|continuing|-ing/)
    expect(grammarGloss(tok({ surface: 'しまう', pos: '動詞', posDetail1: '非自立', baseForm: 'しまう' }))).toMatch(/completely|regret/)
  })

  it('returns undefined for grammar tokens without a curated entry', () => {
    expect(grammarGloss(tok({ surface: 'なんちゃら', pos: '助詞' }))).toBeUndefined()
  })

  it('returns undefined for content words even when a same-sound entry exists', () => {
    expect(grammarGloss(tok({ surface: '田', reading: 'タ', pos: '名詞' }))).toBeUndefined()
  })
})
