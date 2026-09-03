import { describe, it, expect } from 'vitest'
import { englishGlossVariants, normalizeLemmaGloss } from '../../src/ai-pipeline/glossNormalize'

describe('englishGlossVariants', () => {
  it('splits hyphenated compounds', () => {
    expect(englishGlossVariants('near-unsalvageable')).toContain('unsalvageable')
  })

  it('strips un- prefixes', () => {
    expect(englishGlossVariants('unsalvageable')).toContain('salvageable')
  })

  it('normalizes UK/US colour spellings', () => {
    expect(englishGlossVariants('colour')).toContain('color')
    expect(normalizeLemmaGloss('colour')).toBe('color')
  })

  // JA pronoun glosses are stored in the nominative ('boku' -> 'i', 'bokura' ->
  // 'we'), but a translation line just as often uses the oblique or possessive
  // form. Without case folding, 僕 in "...for someone like me" found no lexical
  // match and fell through to embedding noise ("There").
  it('folds English pronoun case forms back to the nominative gloss', () => {
    expect(englishGlossVariants('me')).toContain('i')
    expect(englishGlossVariants('my')).toContain('i')
    expect(englishGlossVariants('mine')).toContain('i')
    expect(englishGlossVariants('us')).toContain('we')
    expect(englishGlossVariants('our')).toContain('we')
    expect(englishGlossVariants('him')).toContain('he')
    expect(englishGlossVariants('her')).toContain('she')
    expect(englishGlossVariants('them')).toContain('they')
    expect(englishGlossVariants('your')).toContain('you')
  })

  it('keeps the original target word as a candidate', () => {
    expect(englishGlossVariants('me')).toContain('me')
    expect(englishGlossVariants('her')).toContain('her')
  })
})
