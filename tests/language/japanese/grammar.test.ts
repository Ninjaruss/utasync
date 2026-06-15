import { describe, it, expect } from 'vitest'
import { detectGrammarPatterns } from '../../../src/language/japanese/grammar'

describe('detectGrammarPatterns', () => {
  it('detects ている pattern', () => {
    const annotations = detectGrammarPatterns('待っている')
    const hit = annotations.find((a) => a.pattern.includes('ている'))
    expect(hit).toBeTruthy()
    expect(hit?.explanation).toBeTruthy()
  })

  it('detects ない negative form', () => {
    const annotations = detectGrammarPatterns('行かない')
    const hit = annotations.find((a) => a.pattern.includes('ない'))
    expect(hit).toBeTruthy()
  })

  it('returns empty array for plain text', () => {
    const annotations = detectGrammarPatterns('猫')
    expect(annotations).toEqual([])
  })
})
