import { describe, it, expect } from 'vitest'
import { detectGrammarPatterns } from '../../../src/language/japanese/grammar'
import type { Token } from '../../../src/core/types'

const contiguous = (surfaces: string[]): Token[] => {
  let cursor = 0
  return surfaces.map((surface) => {
    const start = cursor
    cursor += surface.length
    return { surface, startIndex: start, endIndex: cursor, pos: '動詞' }
  })
}

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

  it('populates tokenIndices when tokens are provided', () => {
    const tokens = contiguous(['見', 'て', 'い', 'る'])
    const annotations = detectGrammarPatterns('見ている', tokens)
    const hit = annotations.find((a) => a.pattern === '〜ている')
    expect(hit?.tokenIndices).toEqual([0, 1, 2, 3])
  })
})
