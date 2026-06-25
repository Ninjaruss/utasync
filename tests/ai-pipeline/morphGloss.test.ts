import { describe, it, expect } from 'vitest'
import { morphGlossMatches, functionWordRomaji } from '../../src/ai-pipeline/morphGloss'
import { glossMatchesSource } from '../../src/ai-pipeline/lyricGloss'

describe('morphGlossMatches', () => {
  it('maps negative te-forms to negation targets regardless of verb stem', () => {
    expect(morphGlossMatches({ romaji: 'inakute', surface: '居なくて' }, 'not')).toBe(true)
    expect(morphGlossMatches({ romaji: 'ikanakute', surface: '行かなくて' }, 'not')).toBe(true)
    expect(morphGlossMatches({ romaji: 'shiranakute', surface: '知らなくて' }, 'without')).toBe(true)
  })

  it('maps concessive たって using suffix, not a fixed phrase', () => {
    expect(morphGlossMatches({ romaji: 'tsumetakutatte', surface: '冷たくたって' }, 'cold')).toBe(true)
    expect(morphGlossMatches({ romaji: 'atsukutatte', surface: '暑くたって' }, 'hot')).toBe(true)
    expect(morphGlossMatches({ romaji: 'iktatte', surface: '行ったって' }, 'even')).toBe(true)
  })

  it('maps てみせる auxiliaries on different verb stems', () => {
    expect(morphGlossMatches({ romaji: 'aishitemiseru', surface: '愛してみせる' }, 'love')).toBe(true)
    expect(morphGlossMatches({ romaji: 'kaitemiseru', surface: '書いてみせる' }, 'show')).toBe(true)
  })

  it('requires kanji hint for ambiguous past-tense endings', () => {
    expect(morphGlossMatches({ romaji: 'matta', surface: '舞った' }, 'dancing')).toBe(true)
    expect(morphGlossMatches({ romaji: 'matta', surface: '待った' }, 'dancing')).toBe(false)
  })

  it('resolves function-word surfaces', () => {
    expect(functionWordRomaji('のに')).toBe('noni')
    expect(functionWordRomaji('どんなに')).toBe('donnani')
    expect(glossMatchesSource({ romaji: 'noni', surface: 'のに' }, 'although')).toBe(true)
    expect(glossMatchesSource({ romaji: 'donnani', surface: 'どんなに' }, 'matter')).toBe(true)
  })

  it('maps て+い+たい morphology to want/dreaming targets', () => {
    expect(morphGlossMatches({ romaji: 'miteitai', surface: '見ていたい' }, 'want')).toBe(true)
    expect(morphGlossMatches({ romaji: 'miteitai', surface: '見ていたい' }, 'dreaming')).toBe(true)
  })

  it('maps 寸前 set phrases on any noun stem', () => {
    expect(morphGlossMatches({ romaji: 'bakuhatsusunzen', surface: '爆発寸前' }, 'verge')).toBe(true)
    expect(morphGlossMatches({ romaji: 'genkaisunzen', surface: '限界寸前' }, 'brink')).toBe(true)
  })

  it('maps negative desire 知りたくはない to know/want', () => {
    expect(morphGlossMatches({ romaji: 'shiritakuhanai', surface: '知りたくはない' }, 'know')).toBe(true)
    expect(morphGlossMatches({ romaji: 'shiritakuhanai', surface: '知りたくはない' }, 'want')).toBe(true)
  })

  it('maps negative potential 触れない to untouchable', () => {
    expect(morphGlossMatches({ romaji: 'furenai', surface: '触れない' }, 'untouchable')).toBe(true)
  })

  it('maps から/まで particles via function-word gloss', () => {
    expect(glossMatchesSource({ romaji: 'kara', surface: 'から' }, 'from')).toBe(true)
    expect(glossMatchesSource({ romaji: 'made', surface: 'まで' }, 'until')).toBe(true)
  })
})
