import { describe, it, expect } from 'vitest'
import { whisperLanguageFor } from '../../src/ai-pipeline/whisperLanguage'

describe('whisperLanguageFor', () => {
  it('maps app language codes to Whisper language names', () => {
    expect(whisperLanguageFor('ja')).toBe('japanese')
    expect(whisperLanguageFor('en')).toBe('english')
  })

  it('defaults to japanese when unknown', () => {
    expect(whisperLanguageFor(undefined)).toBe('japanese')
  })
})
