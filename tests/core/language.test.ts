import { describe, it, expect } from 'vitest'
import { isParticleToken, isAlignableToken, isAlignableEnglishWord, normalizeEnglishAlignmentWord } from '../../src/core/language'
import type { Token } from '../../src/core/types'

const tok = (surface: string, pos?: string, posDetail1?: string): Token => ({
  surface,
  pos,
  posDetail1,
  startIndex: 0,
  endIndex: surface.length,
})

describe('isParticleToken', () => {
  it('identifies kuromoji particle tag', () => {
    expect(isParticleToken(tok('が', '助詞'))).toBe(true)
    expect(isParticleToken(tok('が', '助詞,格助詞,一般,*'))).toBe(true)
  })
  it('treats non-particle tags as false', () => {
    expect(isParticleToken(tok('君', '名詞'))).toBe(false)
    expect(isParticleToken(tok('long'))).toBe(false)
  })
})

describe('isAlignableToken', () => {
  it('excludes particles and dependent verb suffixes', () => {
    expect(isAlignableToken(tok('が', '助詞'))).toBe(false)
    expect(isAlignableToken(tok('える', '動詞,非自立可能,一段,*,*,*,*'))).toBe(false)
    expect(isAlignableToken(tok('てる', '動詞', '非自立'))).toBe(false)
    expect(isAlignableToken(tok('く', '動詞', '非自立'))).toBe(false)
  })
  it('includes content words and lexical particles like だけ', () => {
    expect(isAlignableToken(tok('君', '名詞'))).toBe(true)
    expect(isAlignableToken(tok('だけ', '助詞', '副助詞'))).toBe(true)
  })
})

describe('isAlignableEnglishWord', () => {
  it('excludes articles, prepositions, and auxiliaries', () => {
    expect(isAlignableEnglishWord('the')).toBe(false)
    expect(isAlignableEnglishWord('as')).toBe(false)
    expect(isAlignableEnglishWord('in')).toBe(false)
    expect(isAlignableEnglishWord('to')).toBe(false)
    expect(isAlignableEnglishWord('is')).toBe(false)
  })
  it('includes content words and contractions', () => {
    expect(isAlignableEnglishWord('behind')).toBe(true)
    expect(isAlignableEnglishWord('same')).toBe(true)
    expect(isAlignableEnglishWord("I'm")).toBe(true)
    expect(isAlignableEnglishWord('only')).toBe(true)
  })
})

describe('normalizeEnglishAlignmentWord', () => {
  it('unwraps common contractions for gloss lookup', () => {
    expect(normalizeEnglishAlignmentWord("I'm")).toBe('i')
    expect(normalizeEnglishAlignmentWord("I'll")).toBe('i')
    expect(normalizeEnglishAlignmentWord("you're")).toBe('you')
  })
})
