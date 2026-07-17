import { describe, it, expect } from 'vitest'
import { singleWordGlossKey, reverseIndex } from '../../scripts/lib/enjaDict.mjs'

describe('singleWordGlossKey', () => {
  it('accepts a single-word gloss, stripping leading "to "/article/parenthetical', () => {
    expect(singleWordGlossKey('spring')).toBe('spring')
    expect(singleWordGlossKey('to run')).toBe('run')
    expect(singleWordGlossKey('a pacifier')).toBe('pacifier')
    expect(singleWordGlossKey('(vulgar) blowjob')).toBe('blowjob')
  })
  it('rejects multi-word glosses and junk', () => {
    expect(singleWordGlossKey('teething ring')).toBeNull()
    expect(singleWordGlossKey('to go for a walk')).toBeNull()
    expect(singleWordGlossKey('')).toBeNull()
    expect(singleWordGlossKey('a')).toBeNull() // too short after stripping
  })
})

describe('reverseIndex', () => {
  const words = [
    { kanji: [{ text: '春', common: true }], kana: [{ text: 'はる', common: true }],
      sense: [{ partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'spring' }, { lang: 'eng', text: 'springtime' }] }] },
    { kanji: [{ text: '泉', common: false }], kana: [{ text: 'いずみ', common: true }],
      sense: [{ partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'spring' }, { lang: 'eng', text: 'fountain' }] }] },
  ]
  it('maps an English word to ranked, capped Japanese equivalents (headword+reading)', () => {
    const idx = reverseIndex(words, { cap: 6 })
    expect(idx['spring']).toEqual([
      { w: '春', r: 'はる' },
      { w: '泉', r: 'いずみ' },
    ])
    expect(idx['fountain']).toEqual([{ w: '泉', r: 'いずみ' }])
    expect(idx['springtime']).toEqual([{ w: '春', r: 'はる' }])
  })
  it('dedupes by headword and caps', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      kanji: [{ text: `x${i}`, common: false }], kana: [{ text: `かな${i}`, common: false }],
      sense: [{ partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'thing' }] }],
    }))
    expect(reverseIndex(many, { cap: 6 })['thing'].length).toBe(6)
  })
})
