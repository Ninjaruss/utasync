import { describe, it, expect } from 'vitest'
import { glossMatchesTarget } from '../../src/ai-pipeline/lyricGloss'
import { isAlignableEnglishWord } from '../../src/core/language'
import { englishGlossVariants } from '../../src/ai-pipeline/glossNormalize'

// Tokens left unpaired / mis-paired by the real-app pipeline on "Rock'n'Roll,
// Morning Light Falls on You" (verified against the song audio + translation).
// Surface-disambiguated so homophones (e.g. 鳴る=ring) are unaffected.
describe('lyricGloss — Rock\'n\'Roll verb glosses', () => {
  it('笑え (warae) glosses to smile', () => {
    expect(glossMatchesTarget('warae', 'smile', '笑え')).toBe(true)
    expect(glossMatchesTarget('warau', 'smile', '笑う')).toBe(true)
  })

  it('連れ (tsure/zure) glosses to take', () => {
    expect(glossMatchesTarget('tsure', 'take', '連れ')).toBe(true)
    expect(glossMatchesTarget('zure', 'take', '連れ')).toBe(true)
  })

  it('持っ (mot) glosses to have', () => {
    expect(glossMatchesTarget('mot', 'have', '持っ')).toBe(true)
    expect(glossMatchesTarget('motte', 'have', '持って')).toBe(true)
  })

  it('成れ (nare) glosses to become, gated by the 成 kanji', () => {
    expect(glossMatchesTarget('nare', 'become', '成れ')).toBe(true)
    expect(glossMatchesTarget('naru', 'become', '成る')).toBe(true)
    // homophones keep their own sense: 鳴る=ring, 成す=accomplish stay out
    expect(glossMatchesTarget('naru', 'become', '鳴る')).toBe(false)
    expect(glossMatchesTarget('nasu', 'become', '成す')).toBe(false)
  })

  it('matches the gerund target "taking" for 連れて行く', () => {
    expect(glossMatchesTarget('zure', 'taking', '連れ')).toBe(true)
  })

  it('treats lexical have/has/had as alignable (gated by a curated gloss)', () => {
    // Auxiliary uses still won't pair unless a JA token actually glosses to "have".
    expect(isAlignableEnglishWord('have')).toBe(true)
    expect(isAlignableEnglishWord('had')).toBe(true)
  })

  it('lemmatizes gerund/plural targets so base-form glosses match', () => {
    expect(englishGlossVariants('taking')).toContain('take')
    expect(englishGlossVariants('wars')).toContain('war')
    expect(englishGlossVariants('running')).toContain('run')
  })

  it('does not pollute the homophone 鳴る (ring) or ずれ (gap)', () => {
    // surface-gated: bare romaji without the kanji surface must not gain these glosses
    expect(glossMatchesTarget('naru', 'become', '鳴る')).toBe(false)
    expect(glossMatchesTarget('zure', 'take', 'ずれ')).toBe(false)
  })
})
