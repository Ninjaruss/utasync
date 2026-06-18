import { describe, it, expect } from 'vitest'
import { isParticleToken, cosineSimilarity, greedyMatch, alignLineTokens } from '../../src/ai-pipeline/wordAligner'
import type { Token } from '../../src/core/types'

const tok = (surface: string, pos = '名詞'): Token => ({ surface, pos, startIndex: 0, endIndex: surface.length })

describe('isParticleToken', () => {
  it('identifies kuromoji particle tag', () => {
    expect(isParticleToken(tok('が', '助詞'))).toBe(true)
    expect(isParticleToken(tok('が', '助詞,格助詞,一般,*'))).toBe(true)
  })
  it('treats non-particle tags as false', () => {
    expect(isParticleToken(tok('君', '名詞'))).toBe(false)
    expect(isParticleToken(tok('long'))).toBe(false)
  })
})

describe('cosineSimilarity', () => {
  it('returns 1 for identical normalized vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
  })
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })
})

describe('greedyMatch', () => {
  it('pairs each source vector with its closest unused target vector', () => {
    const source = [[1, 0], [0, 1]]
    const target = [[0, 1], [1, 0]] // intentionally reversed order
    const matches = greedyMatch(source, target, 0.5)
    expect(matches).toEqual([
      { sourceIndex: 0, targetIndex: 1, score: 1 },
      { sourceIndex: 1, targetIndex: 0, score: 1 },
    ])
  })
  it('drops pairs below the similarity threshold', () => {
    const source = [[1, 0]]
    const target = [[0, 1]] // orthogonal, similarity 0
    expect(greedyMatch(source, target, 0.5)).toEqual([])
  })
  it('never reuses a source or target index', () => {
    const source = [[1, 0], [0.9, 0.1]]
    const target = [[1, 0]]
    const matches = greedyMatch(source, target, 0.5)
    expect(matches.length).toBe(1)
  })
})

describe('alignLineTokens', () => {
  it('attaches alignmentIndices to matched, non-particle tokens', async () => {
    const tokens: Token[] = [tok('君'), tok('が', '助詞'), tok('好き')]
    const targetWords = ['you', 'like', 'I']
    // Fake embedder: identical surface => identical vector, so 君~you and 好き~like
    // are forced to be the closest match via hand-picked vectors.
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        if (t === '君') return [1, 0, 0]
        if (t === '好き') return [0, 1, 0]
        if (t === 'you') return [1, 0, 0]
        if (t === 'like') return [0, 1, 0]
        return [0, 0, 1] // 'I' — unrelated to any source token
      })
    const result = await alignLineTokens(tokens, targetWords, embed)
    expect(result[0].alignmentIndices).toEqual([0]) // 君 -> you
    expect(result[2].alignmentIndices).toEqual([1]) // 好き -> like
    expect(result[1].alignmentIndices).toBeUndefined() // particle, never matched
  })

  it('leaves tokens unmatched when there is nothing to align against', async () => {
    const tokens: Token[] = [tok('君')]
    const result = await alignLineTokens(tokens, [], async () => [])
    expect(result[0].alignmentIndices).toBeUndefined()
  })
})
