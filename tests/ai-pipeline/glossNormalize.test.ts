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
})
