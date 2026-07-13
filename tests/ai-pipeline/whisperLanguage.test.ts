import { describe, it, expect } from 'vitest'
import { whisperLanguageFor, isMixedLanguageSheet, detectSheetLanguage } from '../../src/ai-pipeline/whisperLanguage'

describe('whisperLanguageFor', () => {
  it('maps app language codes to Whisper language names', () => {
    expect(whisperLanguageFor('ja')).toBe('japanese')
    expect(whisperLanguageFor('en')).toBe('english')
  })

  it('defaults to japanese when unknown', () => {
    expect(whisperLanguageFor(undefined)).toBe('japanese')
  })

  it('returns undefined for mixed so Whisper auto-detects per chunk', () => {
    expect(whisperLanguageFor('mixed')).toBeUndefined()
  })
})

describe('detectSheetLanguage', () => {
  const JA_LINES = ['ただただ荒れていく時代に', '過去の輝きに価値はない', '心の形を作る', '手はいつも汚れだらけ']
  const EN_LINES = ['I found a place where I am not alone', 'Stranger than heaven', 'Back streets walking on the edge', 'Nothing left to lose tonight']

  it('detects a pure JA sheet as ja even when stored language says en', () => {
    expect(detectSheetLanguage(JA_LINES, 'en')).toBe('ja')
  })

  it('detects a pure EN sheet as en even when stored language defaulted to ja', () => {
    expect(detectSheetLanguage(EN_LINES, 'ja')).toBe('en')
  })

  it('detects alternating JA/EN sections as mixed', () => {
    expect(detectSheetLanguage([...JA_LINES.slice(0, 3), ...EN_LINES.slice(0, 3)], 'ja')).toBe('mixed')
  })

  it('one-off English hooks do not flip a JA sheet', () => {
    expect(detectSheetLanguage([...JA_LINES, 'oh yeah'], 'ja')).toBe('ja')
  })

  it('a couple of substantial EN lines below the mixed threshold keep the dominant script', () => {
    expect(detectSheetLanguage([...JA_LINES, ...EN_LINES.slice(0, 2)], 'ja')).toBe('ja')
    expect(detectSheetLanguage([...EN_LINES, ...JA_LINES.slice(0, 2)], 'ja')).toBe('en')
  })

  it('falls back to the stored language when no script is detected', () => {
    expect(detectSheetLanguage(['...', '♪'], 'en')).toBe('en')
    expect(detectSheetLanguage([], undefined)).toBe('ja')
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
