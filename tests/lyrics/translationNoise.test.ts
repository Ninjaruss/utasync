import { describe, it, expect } from 'vitest'
import { isTranslationNoiseLine } from '../../src/lyrics/translationNoise'

describe('isTranslationNoiseLine', () => {
  const opts = { songTitle: 'Example Song', artist: 'Example Artist' }

  it('catches a leading title line', () => {
    expect(isTranslationNoiseLine('Example Song - Example Artist', opts)).toBe(true)
    expect(isTranslationNoiseLine('Example Song', opts)).toBe(true)
  })

  it('catches translator credits', () => {
    expect(isTranslationNoiseLine('Translated by Someone', opts)).toBe(true)
    expect(isTranslationNoiseLine('translation: someone', opts)).toBe(true)
  })

  it('catches translator notes', () => {
    expect(isTranslationNoiseLine('(TN: this is a pun)', opts)).toBe(true)
    expect(isTranslationNoiseLine('[Note: untranslatable]', opts)).toBe(true)
  })

  it('leaves real lyric lines alone', () => {
    expect(isTranslationNoiseLine('I walk alone through the quiet town', opts)).toBe(false)
    expect(isTranslationNoiseLine('Nothing left to say', opts)).toBe(false)
  })

  it('does not eat a lyric line that merely mentions the title word', () => {
    expect(isTranslationNoiseLine('This example song of ours goes on and on', opts)).toBe(false)
  })
})
