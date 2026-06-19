import { describe, it, expect, vi } from 'vitest'
import { isParticleToken, cosineSimilarity, greedyMatch, alignLineTokens, alignLinesTokens, countEmbedBatches } from '../../src/ai-pipeline/wordAligner'
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
  it('resolves a similarity tie deterministically, picking only one match for the single target', () => {
    const source = [[1, 0], [1, 0]] // identical to each other and to the target
    const target = [[1, 0]]
    const matches = greedyMatch(source, target, 0.5)
    expect(matches.length).toBe(1)
    // Both candidates score 1 against the single target, so the sort is a tie.
    // Array.prototype.sort is stable in modern JS, so candidates retain their
    // original generation order (sourceIndex 0 before 1) and index 0 wins.
    expect(matches[0]).toEqual({ sourceIndex: 0, targetIndex: 0, score: 1 })
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

  it('leaves tokens unmatched when every token is a particle (alignableIndices empty, targetWords non-empty)', async () => {
    const tokens: Token[] = [tok('が', '助詞'), tok('を', '助詞'), tok('は', '助詞')]
    const targetWords = ['you', 'like', 'I']
    const result = await alignLineTokens(tokens, targetWords, async () => {
      throw new Error('embed should not be called when there are no alignable tokens')
    })
    expect(result[0].alignmentIndices).toBeUndefined()
    expect(result[1].alignmentIndices).toBeUndefined()
    expect(result[2].alignmentIndices).toBeUndefined()
  })
})

describe('alignLinesTokens', () => {
  const embed = async (texts: string[]): Promise<number[][]> =>
    texts.map((t) => {
      if (t === '君' || t === 'you') return [1, 0, 0]
      if (t === '好き' || t === 'like') return [0, 1, 0]
      if (t === '愛' || t === 'love') return [0, 0, 1]
      return [0, 0, 0]
    })

  it('aligns multiple lines in a single embed call', async () => {
    const embedSpy = vi.fn(embed)
    const jobs = [
      { tokens: [tok('君'), tok('好き')], targetWords: ['you', 'like'] },
      { tokens: [tok('愛')], targetWords: ['love'] },
    ]
    const results = await alignLinesTokens(jobs, embedSpy)
    expect(embedSpy).toHaveBeenCalledTimes(1)
    expect(embedSpy.mock.calls[0][0]).toEqual(['君', '好き', 'you', 'like', '愛', 'love'])
    expect(results[0][0].alignmentIndices).toEqual([0])
    expect(results[0][1].alignmentIndices).toEqual([1])
    expect(results[1][0].alignmentIndices).toEqual([0])
  })

  it('splits large batches when maxTextsPerBatch is set', async () => {
    const embedSpy = vi.fn(embed)
    const jobs = [
      { tokens: [tok('君'), tok('好き')], targetWords: ['you', 'like'] },
      { tokens: [tok('愛')], targetWords: ['love'] },
    ]
    await alignLinesTokens(jobs, embedSpy, { maxTextsPerBatch: 4 })
    expect(embedSpy).toHaveBeenCalledTimes(2)
  })

  it('reports batch progress when splitting embed calls', async () => {
    const onBatchProgress = vi.fn()
    const jobs = [
      { tokens: [tok('君'), tok('好き')], targetWords: ['you', 'like'] },
      { tokens: [tok('愛')], targetWords: ['love'] },
    ]
    await alignLinesTokens(jobs, embed, { maxTextsPerBatch: 4, onBatchProgress })
    expect(onBatchProgress).toHaveBeenCalledTimes(2)
    expect(onBatchProgress).toHaveBeenNthCalledWith(1, 1, 2)
    expect(onBatchProgress).toHaveBeenNthCalledWith(2, 2, 2)
  })
})

describe('countEmbedBatches', () => {
  it('returns 1 when all texts fit a single batch', () => {
    const jobs = [{ tokens: [tok('君')], targetWords: ['you'] }]
    expect(countEmbedBatches(jobs)).toBe(1)
  })
  it('returns multiple batches when maxTextsPerBatch forces splits', () => {
    const jobs = [
      { tokens: [tok('君'), tok('好き')], targetWords: ['you', 'like'] },
      { tokens: [tok('愛')], targetWords: ['love'] },
    ]
    expect(countEmbedBatches(jobs, 4)).toBe(2)
  })
})
