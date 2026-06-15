import { describe, it, expect } from 'vitest'
import { detectEnglishGrammar } from '../../../src/language/english/grammar'

describe('detectEnglishGrammar', () => {
  it('detects present perfect', () => {
    const hits = detectEnglishGrammar("I've been waiting")
    expect(hits.some((h) => h.pattern.toLowerCase().includes('perfect'))).toBe(true)
  })

  it('detects phrasal verb', () => {
    const hits = detectEnglishGrammar('give up')
    expect(hits.some((h) => h.pattern.toLowerCase().includes('phrasal'))).toBe(true)
  })

  it('returns empty for plain noun', () => {
    expect(detectEnglishGrammar('cat')).toEqual([])
  })
})
