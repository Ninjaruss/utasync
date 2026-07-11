import { describe, it, expect } from 'vitest'
import { whisperLanguageFor, isMixedLanguageSheet } from '../../src/ai-pipeline/whisperLanguage'

describe('whisperLanguageFor', () => {
  it('maps app language codes to Whisper language names', () => {
    expect(whisperLanguageFor('ja')).toBe('japanese')
    expect(whisperLanguageFor('en')).toBe('english')
  })

  it('defaults to japanese when unknown', () => {
    expect(whisperLanguageFor(undefined)).toBe('japanese')
  })
})

describe('isMixedLanguageSheet', () => {
  it('true when the sheet has >=3 substantial lines of each script', () => {
    expect(isMixedLanguageSheet([
      'ただただ荒れていく時代に', '過去の輝きに価値はない', '心の形を作る',
      'I found a place where I am not alone', 'Stranger than heaven', 'Back streets walking on the edge',
    ])).toBe(true)
  })
  it('false for a JA sheet with an occasional English hook', () => {
    expect(isMixedLanguageSheet([
      'ただただ荒れていく時代に', '過去の輝きに価値はない', 'oh yeah', '心の形を作る', '手はいつも汚れだらけ',
    ])).toBe(false)
  })
  it('false for a pure EN sheet', () => {
    expect(isMixedLanguageSheet(['hello world today', 'another line of text', 'and one more here'])).toBe(false)
  })
  it('false for a pure JA sheet', () => {
    expect(isMixedLanguageSheet(['ただただ荒れていく', '過去の輝きに', '心の形を作る', '手はいつも'])).toBe(false)
  })
})
