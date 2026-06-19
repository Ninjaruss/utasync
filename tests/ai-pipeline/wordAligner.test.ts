import { describe, it, expect, vi } from 'vitest'
import { isParticleToken, cosineSimilarity, greedyMatch, alignLineTokens, alignLinesTokens, countEmbedBatches, tokenEmbedText } from '../../src/ai-pipeline/wordAligner'
import type { Token } from '../../src/core/types'

const tok = (surface: string, pos = '名詞', reading?: string): Token => ({
  surface,
  pos,
  reading,
  startIndex: 0,
  endIndex: surface.length,
})

describe('tokenEmbedText', () => {
  it('prefers kuromoji reading when it differs from surface', () => {
    expect(tokenEmbedText(tok('君', '名詞', 'キミ'))).toBe('キミ')
  })
  it('falls back to surface when reading matches surface', () => {
    expect(tokenEmbedText(tok('ねえ', '感動詞', 'ねえ'))).toBe('ねえ')
  })
})

describe('alignLineTokens — multi-token lines', () => {
  it('maps several Japanese tokens onto fewer English words (many-to-one)', async () => {
    const tokens: Token[] = [
      tok('君', '名詞', 'キミ'),
      tok('の', '助詞'),
      tok('こと', '名詞', 'コト'),
      tok('が', '助詞'),
      tok('好き', '形容詞', 'スキ'),
    ]
    const targetWords = ['I', 'like', 'you']
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        if (t === 'キミ' || t === 'you') return [1, 0, 0]
        if (t === 'スキ' || t === 'like') return [0, 1, 0]
        if (t === 'I') return [0, 0, 1]
        if (t === 'コト') return [0.9, 0.05, 0.05] // close to キミ / you
        return [0, 0, 0]
      })
    const result = await alignLineTokens(tokens, targetWords, embed)
    expect(result[0].alignmentIndices).toEqual([2]) // 君 -> you
    expect(result[2].alignmentIndices).toEqual([2]) // こと -> you (many-to-one)
    expect(result[4].alignmentIndices).toEqual([1]) // 好き -> like
    expect(result[1].alignmentIndices).toBeUndefined() // particle
    expect(result[3].alignmentIndices).toBeUndefined() // particle
  })

  it('colors a longer lyric line with multiple content words', async () => {
    const tokens: Token[] = [
      tok('ねえ', '感動詞'),
      tok('いつか', '名詞', 'イツカ'),
      tok('会', '名詞', 'ア'),
      tok('える', '動詞', 'エル'),
      tok('かな', '助詞'),
    ]
    const targetWords = ['Hey', 'someday', 'will', 'we', 'meet']
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        if (t === 'ねえ' || t === 'Hey') return [1, 0, 0, 0, 0]
        if (t === 'イツカ' || t === 'someday') return [0, 1, 0, 0, 0]
        if (t === 'ア' || t === 'エル' || t === 'meet') return [0, 0, 0, 0, 1]
        if (t === 'will') return [0, 0, 1, 0, 0]
        if (t === 'we') return [0, 0, 0, 1, 0]
        return [0, 0, 0, 0, 0]
      })
    const result = await alignLineTokens(tokens, targetWords, embed)
    const aligned = result.filter((t) => t.alignmentIndices?.length)
    expect(aligned.length).toBeGreaterThanOrEqual(3)
    expect(result[0].alignmentIndices).toEqual([0]) // ねえ -> Hey
    expect(result[1].alignmentIndices).toEqual([1]) // いつか -> someday
  })
})

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
  it('never reuses a source index', () => {
    const source = [[1, 0], [0.9, 0.1]]
    const target = [[1, 0]]
    const matches = greedyMatch(source, target, 0.5, { allowManyToOne: false })
    expect(matches.length).toBe(1)
  })
  it('allows multiple sources to share one target when many-to-one is enabled', () => {
    const source = [[1, 0], [0.95, 0.05]]
    const target = [[1, 0]]
    const matches = greedyMatch(source, target, 0.5, { allowManyToOne: true })
    expect(matches.length).toBe(2)
    expect(matches[0].targetIndex).toBe(0)
    expect(matches[1].targetIndex).toBe(0)
  })
  it('keeps targets exclusive when many-to-one is disabled', () => {
    const source = [[1, 0], [0.95, 0.05]]
    const target = [[1, 0]]
    const matches = greedyMatch(source, target, 0.5, { allowManyToOne: false })
    expect(matches.length).toBe(1)
  })
  it('resolves a similarity tie deterministically, picking only one match for the single target', () => {
    const source = [[1, 0], [1, 0]] // identical to each other and to the target
    const target = [[1, 0]]
    const matches = greedyMatch(source, target, 0.5, { allowManyToOne: false })
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

  it('dedupes repeated surfaces and target words before calling embed', async () => {
    const embedSpy = vi.fn(embed)
    const jobs = [
      { tokens: [tok('君'), tok('君')], targetWords: ['you', 'you'] },
      { tokens: [tok('君')], targetWords: ['you'] },
    ]
    await alignLinesTokens(jobs, embedSpy)
    expect(embedSpy).toHaveBeenCalledTimes(1)
    expect(embedSpy.mock.calls[0][0]).toEqual(['君', 'you'])
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
