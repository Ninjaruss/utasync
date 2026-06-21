import { describe, it, expect, vi } from 'vitest'
import {
  isParticleToken,
  isAlignableToken,
  cosineSimilarity,
  greedyMatch,
  alignLineTokens,
  alignLinesTokens,
  countEmbedBatches,
  tokenEmbedText,
  tokenGlossText,
  targetEmbedText,
  exactTextMatchScore,
  buildScoreMatrix,
  optimalOneToOneMatch,
  extendManyToOne,
  matchTokens,
  buildAlignmentUnits,
  monotonicSequenceMatch,
} from '../../src/ai-pipeline/wordAligner'
import {
  offsetTokenAlignmentIndices,
  targetWordBaseOffset,
  targetWordsForAlignment,
  buildAlignmentSegments,
  buildAlignJob,
} from '../../src/lyrics/lineAligner'
import { splitTranslationWords } from '../../src/language/wordColors'
import type { Token } from '../../src/core/types'

const tok = (surface: string, pos = '名詞', reading?: string, posDetail1?: string): Token => ({
  surface,
  pos,
  reading,
  posDetail1,
  startIndex: 0,
  endIndex: surface.length,
})

describe('tokenEmbedText', () => {
  it('returns native surface for the embedding model (not romaji)', () => {
    expect(tokenEmbedText(tok('君', '名詞', 'キミ'))).toBe('君')
    expect(tokenEmbedText(tok('世界', '名詞', 'セカイ'))).toBe('世界')
  })
})

describe('tokenGlossText', () => {
  it('romanizes kuromoji reading when it differs from surface', () => {
    expect(tokenGlossText(tok('君', '名詞', 'キミ'))).toBe('kimi')
  })
  it('romanizes kana-only surfaces', () => {
    expect(tokenGlossText(tok('ねえ', '感動詞', 'ねえ'))).toBe('nee')
  })
  it('romanizes reading even when surface is also kana', () => {
    expect(tokenGlossText(tok('スキ', '形容詞', 'スキ'))).toBe('suki')
  })
  it('falls back to kanji romaji map when reading is missing', () => {
    expect(tokenGlossText(tok('愛'))).toBe('ai')
  })
})

describe('targetEmbedText', () => {
  it('lowercases ASCII target words', () => {
    expect(targetEmbedText('You')).toBe('you')
  })
  it('leaves non-ASCII words unchanged', () => {
    expect(targetEmbedText('你好')).toBe('你好')
  })
})

describe('isAlignableToken', () => {
  it('excludes particles and dependent verb suffixes', () => {
    expect(isAlignableToken(tok('が', '助詞'))).toBe(false)
    expect(isAlignableToken(tok('える', '動詞,非自立可能,一段,*,*,*,*'))).toBe(false)
    expect(isAlignableToken(tok('てる', '動詞', 'テル', '非自立'))).toBe(false)
    expect(isAlignableToken(tok('く', '動詞', 'ク', '非自立'))).toBe(false)
    expect(isAlignableToken(tok('かな', '助詞,終助詞,*,*,*,*,*'))).toBe(false)
  })
  it('includes content words and lexical particles', () => {
    expect(isAlignableToken(tok('君', '名詞'))).toBe(true)
    expect(isAlignableToken(tok('好き', '形容詞'))).toBe(true)
    expect(isAlignableToken(tok('会', '動詞,自立,*,*,*,*,*'))).toBe(true)
    expect(isAlignableToken(tok('だけ', '助詞', 'ダケ', '副助詞'))).toBe(true)
  })
})

describe('exactTextMatchScore', () => {
  it('returns 1 for identical romanized text', () => {
    expect(exactTextMatchScore('kimi', 'kimi')).toBe(1)
    expect(exactTextMatchScore('KIMI', 'kimi')).toBe(1)
  })
  it('returns 1 for common romaji gloss pairs', () => {
    expect(exactTextMatchScore('suki', 'like')).toBe(1)
    expect(exactTextMatchScore('kimi', 'you')).toBe(1)
    expect(exactTextMatchScore('ai', 'love')).toBe(1)
    expect(exactTextMatchScore('dake', 'only')).toBe(1)
  })
  it('returns 1 for poetic English aliases', () => {
    expect(exactTextMatchScore('nagai', 'endless')).toBe(1)
    expect(exactTextMatchScore('eien', 'forever')).toBe(1)
  })
  it('returns 0 for different text', () => {
    expect(exactTextMatchScore('kimi', 'like')).toBe(0)
  })
})

describe('optimalOneToOneMatch', () => {
  it('prefers globally optimal assignment over greedy when targets would be stolen', () => {
    // Source 0 best=target 0 (0.9), source 1 best=target 0 (0.95) but should get target 1 (0.85)
    const scores = [
      [0.9, 0.4],
      [0.95, 0.85],
    ]
    const matches = optimalOneToOneMatch(scores, 0.5)
    expect(matches).toEqual([
      { sourceIndex: 0, targetIndex: 0, score: 0.9 },
      { sourceIndex: 1, targetIndex: 1, score: 0.85 },
    ])
  })

  it('respects position bonus when semantic scores tie', () => {
    const scores = buildScoreMatrix(
      ['a', 'b'],
      ['x', 'y'],
      [[1, 0], [0, 1]],
      [[1, 0], [0, 1]],
    )
    const matches = optimalOneToOneMatch(scores, 0.5)
    expect(matches).toEqual([
      { sourceIndex: 0, targetIndex: 0, score: expect.any(Number) },
      { sourceIndex: 1, targetIndex: 1, score: expect.any(Number) },
    ])
  })
})

describe('extendManyToOne', () => {
  it('maps an unmatched neighbor to the same target when similarity is strong', () => {
    const scores = [
      [0.9, 0.1],
      [0.85, 0.1],
      [0.1, 0.9],
    ]
    const sourceTexts = ['kimi', 'koto', 'suki']
    const targetTexts = ['i', 'like', 'you']
    const primary = [{ sourceIndex: 0, targetIndex: 0, score: 0.9 }]
    const extra = extendManyToOne(scores, sourceTexts, targetTexts, primary, 0.5)
    expect(extra).toEqual([{ sourceIndex: 1, targetIndex: 0, score: 0.85 }])
  })

  it('maps distant sources to the same target via gloss cluster', () => {
    const scores = [
      [0.9, 0.1],
      [0.1, 0.9],
      [0.2, 0.85],
    ]
    const sourceTexts = ['koi', 'sora', 'ai']
    const targetTexts = ['love', 'sky']
    const primary = [{ sourceIndex: 0, targetIndex: 0, score: 0.9 }]
    const extra = extendManyToOne(scores, sourceTexts, targetTexts, primary, 0.5)
    expect(extra.some((m) => m.sourceIndex === 2 && m.targetIndex === 0)).toBe(true)
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
        if (t === '君' || t === 'kimi' || t === 'you') return [1, 0, 0]
        if (t === '好き' || t === 'suki' || t === 'like') return [0, 1, 0]
        if (t === 'i') return [0, 0, 1]
        if (t === 'こと' || t === 'koto') return [0.88, 0.05, 0.07] // close to you, not like
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
      tok('ねえ', '感動詞', 'ネエ'),
      tok('いつか', '名詞', 'イツカ'),
      tok('会', '動詞,自立,*,*,*,*,*', 'ア'),
      tok('える', '動詞,非自立可能,一段,*,*,*,*', 'エル'),
      tok('かな', '助詞,終助詞,*,*,*,*,*'),
    ]
    const targetWords = ['Hey', 'someday', 'will', 'we', 'meet']
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        if (t === 'ねえ' || t === 'nee' || t === 'hey') return [1, 0, 0, 0, 0]
        if (t === 'いつか' || t === 'itsuka' || t === 'someday') return [0, 1, 0, 0, 0]
        if (t === '会' || t === 'a' || t === 'meet') return [0, 0, 0, 0, 1]
        if (t === 'will') return [0, 0, 1, 0, 0]
        if (t === 'we') return [0, 0, 0, 1, 0]
        return [0, 0, 0, 0, 0]
      })
    const result = await alignLineTokens(tokens, targetWords, embed)
    const aligned = result.filter((t) => t.alignmentIndices?.length)
    expect(aligned.length).toBeGreaterThanOrEqual(3)
    expect(result[0].alignmentIndices).toEqual([0]) // ねえ -> Hey
    expect(result[1].alignmentIndices).toEqual([1]) // いつか -> someday
    expect(result[2].alignmentIndices).toEqual([4]) // 会 -> meet
    expect(result[3].alignmentIndices).toBeUndefined() // える suffix excluded
    expect(result[4].alignmentIndices).toBeUndefined() // かな particle
  })

  it('uses exact romaji match to pair common lyric words', async () => {
    const tokens: Token[] = [tok('好き', '形容詞', 'スキ')]
    const targetWords = ['like', 'you']
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map(() => [0.2, 0.2])
    const result = await alignLineTokens(tokens, targetWords, embed)
    expect(result[0].alignmentIndices).toEqual([0]) // suki -> like
  })

  it('avoids wrong pairings when a higher-scoring competitor would steal a target', async () => {
    const tokens: Token[] = [
      tok('星', '名詞', 'ホシ'),
      tok('空', '名詞', 'ソラ'),
    ]
    const targetWords = ['star', 'sky']
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        if (t === 'hoshi' || t === 'star') return [1, 0.3]
        if (t === 'sora' || t === 'sky') return [0.3, 1]
        return [0, 0]
      })
    const result = await alignLineTokens(tokens, targetWords, embed)
    expect(result[0].alignmentIndices).toEqual([0]) // 星 -> star
    expect(result[1].alignmentIndices).toEqual([1]) // 空 -> sky
  })

  it('pairs poetic translation via gloss alias when embeddings are weak', async () => {
    const tokens: Token[] = [tok('長い', '形容詞', 'ナガイ')]
    const targetWords = ['endless', 'night']
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map(() => [0.2, 0.2])
    const result = await alignLineTokens(tokens, targetWords, embed)
    expect(result[0].alignmentIndices).toEqual([0])
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
    expect(matches[0]).toEqual({ sourceIndex: 0, targetIndex: 0, score: 1 })
  })
})

describe('alignLineTokens', () => {
  it('attaches alignmentIndices to matched, non-particle tokens', async () => {
    const tokens: Token[] = [
      tok('君', '名詞', 'キミ'),
      tok('が', '助詞'),
      tok('好き', '形容詞', 'スキ'),
    ]
    const targetWords = ['you', 'like', 'I']
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        if (t === 'kimi' || t === 'you') return [1, 0, 0]
        if (t === 'suki' || t === 'like') return [0, 1, 0]
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
      if (t === '君' || t === 'kimi' || t === 'you') return [1, 0, 0]
      if (t === '好き' || t === 'suki' || t === 'like') return [0, 1, 0]
      if (t === '愛' || t === 'ai' || t === 'love') return [0, 0, 1]
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

describe('monotonicSequenceMatch', () => {
  it('skips an unmatched English filler word between aligned pairs', () => {
    const scores = [
      [0.9, 0.2, 0.1],
      [0.1, 0.2, 0.9],
    ]
    const matches = monotonicSequenceMatch(scores, 0.5)
    expect(matches).toEqual([
      { sourceIndex: 0, targetIndex: 0, score: 0.9 },
      { sourceIndex: 1, targetIndex: 2, score: 0.9 },
    ])
  })
})

describe('buildAlignmentUnits', () => {
  it('merges adjacent nouns when the compound is in the kanji map', () => {
    const tokens: Token[] = [
      tok('恋', '名詞', 'コイ'),
      tok('愛', '名詞', 'アイ'),
    ]
    const units = buildAlignmentUnits(tokens)
    expect(units).toHaveLength(1)
    expect(units[0].tokenIndices).toEqual([0, 1])
    expect(units[0].embedText).toBe('恋愛')
    expect(units[0].glossText).toBe('renai')
  })

  it('does not merge unrelated adjacent nouns', () => {
    const tokens: Token[] = [
      tok('星', '名詞', 'ホシ'),
      tok('空', '名詞', 'ソラ'),
    ]
    expect(buildAlignmentUnits(tokens)).toHaveLength(2)
  })
})

describe('matchTokens', () => {
  it('combines optimal one-to-one with adjacent many-to-one extension', () => {
    const sourceTexts = ['kimi', 'koto', 'suki']
    const targetTexts = ['i', 'like', 'you']
    const sourceVecs = [
      [0, 0, 1],
      [0, 0, 0.9],
      [0, 1, 0],
    ]
    const targetVecs = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const matches = matchTokens(sourceTexts, targetTexts, sourceVecs, targetVecs, 0.5)
    expect(matches.find((m) => m.sourceIndex === 0)?.targetIndex).toBe(2)
    expect(matches.find((m) => m.sourceIndex === 1)?.targetIndex).toBe(2)
    expect(matches.find((m) => m.sourceIndex === 2)?.targetIndex).toBe(1)
  })
})

describe('alignLineTokens — My Eyes Only lyric pattern', () => {
  const embedFromMap = (pairs: Record<string, number[]>) => async (texts: string[]): Promise<number[][]> =>
    texts.map((t) => pairs[t] ?? [0.1, 0.1, 0.1])

  it('pairs mixed-script lines against the Japanese translation half only', async () => {
    const original = 'You always make me so happy 青空に溶けて'
    const translation = 'You always make me so happy\nMelt into the blue sky'
    const jaStart = original.indexOf('青空')
    const tokens: Token[] = [
      { surface: 'You', pos: '名詞', startIndex: 0, endIndex: 3 },
      { surface: '青空', pos: '名詞', reading: 'アオゾラ', startIndex: jaStart, endIndex: jaStart + 2 },
      { surface: 'に', pos: '助詞', startIndex: jaStart + 2, endIndex: jaStart + 3 },
      { surface: '溶け', pos: '動詞', reading: 'トケ', startIndex: jaStart + 3, endIndex: jaStart + 5 },
      { surface: 'て', pos: '助詞', startIndex: jaStart + 5, endIndex: jaStart + 6 },
    ]
    const targetWords = targetWordsForAlignment(original, translation)
    const embed = embedFromMap({
      aozora: [1, 0, 0, 0, 0],
      toke: [0, 1, 0, 0, 0],
      sora: [0, 0, 0, 1, 0],
      melt: [0, 1, 0, 0, 0],
      blue: [0, 0, 0, 1, 0],
      sky: [0, 0, 0, 0, 1],
    })
    const jaIndices = new Set([1, 2, 3, 4])
    const [result] = await alignLinesTokens(
      [{ tokens, targetWords, alignTokenIndices: [...jaIndices] }],
      embed,
    )
    const offset = targetWordBaseOffset(original, translation)
    const aligned = offsetTokenAlignmentIndices(result, offset)
    const words = splitTranslationWords(translation)
    expect(result[0].alignmentIndices).toBeUndefined() // English in original
    expect(aligned[3].alignmentIndices).toEqual([words.indexOf('Melt')]) // 溶け -> melt
    expect(aligned[1].alignmentIndices).toEqual([words.indexOf('sky')]) // 青空 -> sky
    expect(words[aligned[3].alignmentIndices![0]]).toBe('Melt')
    expect(words[aligned[1].alignmentIndices![0]]).toBe('sky')
  })

  it('pairs dual-phrase lines against all newline-joined translation words', async () => {
    const tokens: Token[] = [
      tok('滑り込む', '動詞', 'スベリコム'),
      tok('キミ', '名詞', 'キミ'),
      tok('の', '助詞'),
      tok('横', '名詞', 'ヨコ'),
      tok('隣り合わせ', '名詞', 'トナリアワセ'),
      tok('の', '助詞'),
      tok('ハート', '名詞', 'ハート'),
    ]
    const targetWords = [
      'Beside', 'you', 'as', 'you', 'slide', 'in', 'Adjacent', 'hearts',
    ]
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        if (t === 'kimi' || t === 'you') return [0, 1, 0, 0, 0, 0, 0, 0]
        if (t === 'yoko' || t === 'beside') return [1, 0, 0, 0, 0, 0, 0, 0]
        if (t === 'haato' || t === 'hearts' || t === 'adjacent') return [0, 0, 0, 0, 0, 0, 0, 1]
        return [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]
      })
    const result = await alignLineTokens(tokens, targetWords, embed)
    const aligned = result.filter((t) => t.alignmentIndices?.length)
    expect(aligned.length).toBeGreaterThanOrEqual(2)
    expect(result[1].alignmentIndices).toEqual([1]) // キミ -> you
    expect(result[3].alignmentIndices?.length).toBeGreaterThan(0) // 横
  })

  it('pairs ねえ いつか and また 来ようね via gloss matches', async () => {
    const neeTokens: Token[] = [
      tok('ねえ', '感動詞', 'ネエ'),
      tok('いつか', '名詞', 'イツカ'),
    ]
    const embedWeak = async (texts: string[]): Promise<number[][]> =>
      texts.map(() => [0.2, 0.2, 0.2])
    const neeResult = await alignLineTokens(neeTokens, ['Hey', 'someday'], embedWeak)
    expect(neeResult[0].alignmentIndices).toEqual([0])
    expect(neeResult[1].alignmentIndices).toEqual([1])

    const mataTokens: Token[] = [
      tok('また', '副詞', 'マタ'),
      tok('来よう', '動詞', 'コヨウ'),
      tok('ね', '助詞', 'ネ'),
    ]
    const mataResult = await alignLineTokens(
      mataTokens,
      ["I'll", 'come', 'back', 'for', 'you'],
      embedWeak,
    )
    expect(mataResult[0].alignmentIndices).toEqual([2]) // また -> back
    expect(mataResult[1].alignmentIndices).toEqual([1]) // 来よう -> come
  })

  it('pairs キミの隣で against the Japanese translation line', async () => {
    const original = 'I promise for my eyes only キミの隣で'
    const jaStart = original.indexOf('キミ')
    const tokens: Token[] = [
      { surface: 'I', pos: '名詞', startIndex: 0, endIndex: 1 },
      { surface: 'キミ', pos: '名詞', reading: 'キミ', startIndex: jaStart, endIndex: jaStart + 2 },
      { surface: 'の', pos: '助詞', startIndex: jaStart + 2, endIndex: jaStart + 3 },
      { surface: '隣', pos: '名詞', reading: 'トナリ', startIndex: jaStart + 3, endIndex: jaStart + 4 },
      { surface: 'で', pos: '助詞', startIndex: jaStart + 4, endIndex: jaStart + 5 },
    ]
    const targetWords = ['Next', 'to', 'you']
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map(() => [0.2, 0.2, 0.2])
    const [result] = await alignLinesTokens(
      [{ tokens, targetWords, alignTokenIndices: [1, 2, 3, 4] }],
      embed,
    )
    expect(result[1].alignmentIndices).toEqual([2]) // キミ -> you
    expect(result[3].alignmentIndices).toEqual([0]) // 隣 -> next
  })

  it('pairs だけ with only, not てる (一歩だけ遅れてる)', async () => {
    const tokens: Token[] = [
      tok('一', '名詞', 'イチ'),
      tok('歩', '名詞', 'ホ'),
      tok('だけ', '助詞', 'ダケ', '副助詞'),
      tok('遅れ', '動詞', 'オクレ', '自立'),
      tok('てる', '動詞', 'テル', '非自立'),
    ]
    const targetWords = ['Only', 'one', 'step', 'behind']
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        // てる would score highest for "only" if it were alignable — must be excluded
        if (t === 'teru' || t === 'only') return [0.95, 0, 0, 0]
        if (t === 'dake') return [0.5, 0, 0, 0]
        if (t === 'ichi' || t === 'one') return [0, 1, 0, 0]
        if (t === 'ho' || t === 'step') return [0, 0, 1, 0]
        if (t === 'okure' || t === 'behind') return [0, 0, 0, 1]
        return [0.1, 0.1, 0.1, 0.1]
      })
    const result = await alignLineTokens(tokens, targetWords, embed)
    expect(result[2].alignmentIndices).toEqual([0]) // だけ -> only
    expect(result[4].alignmentIndices).toBeUndefined() // てる suffix excluded
  })

  it('excludes te-form auxiliaries in 溶けてく so 溶け pairs with melt', async () => {
    const tokens: Token[] = [
      tok('恋', '名詞', 'コイ'),
      tok('に', '助詞'),
      tok('溶け', '動詞', 'トケ', '自立'),
      tok('て', '助詞', 'テ', '接続助詞'),
      tok('く', '動詞', 'ク', '非自立'),
    ]
    const targetWords = ['Dissolving', 'in', 'love']
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        if (t === '恋' || t === 'koi' || t === 'love') return [0, 0, 1]
        if (t === '溶け' || t === 'toke' || t === 'dissolving' || t === 'melt') return [1, 0, 0]
        if (t === 'in') return [0, 1, 0]
        return [0.1, 0.1, 0.1]
      })
    const result = await alignLineTokens(tokens, targetWords, embed)
    expect(result[0].alignmentIndices).toEqual([2]) // 恋 -> love
    expect(result[2].alignmentIndices).toEqual([0]) // 溶け -> dissolving/melt
    expect(result[3].alignmentIndices).toBeUndefined() // て
    expect(result[4].alignmentIndices).toBeUndefined() // く auxiliary
  })

  it('pairs dual-phrase 一歩だけ遅れてる いつも通りのあたし per translation line', async () => {
    const original = '一歩だけ遅れてる いつも通りのあたし'
    const translation = "Only one step behind\nI'm the same as always"
    const tokens: Token[] = [
      { surface: '一', pos: '名詞', reading: 'イチ', startIndex: 0, endIndex: 1 },
      { surface: '歩', pos: '名詞', reading: 'ホ', startIndex: 1, endIndex: 2 },
      { surface: 'だけ', pos: '助詞', reading: 'ダケ', posDetail1: '副助詞', startIndex: 2, endIndex: 4 },
      { surface: '遅れ', pos: '動詞', reading: 'オクレ', posDetail1: '自立', startIndex: 4, endIndex: 6 },
      { surface: 'てる', pos: '動詞', reading: 'テル', posDetail1: '非自立', startIndex: 6, endIndex: 8 },
      { surface: 'いつも', pos: '名詞', reading: 'イツモ', startIndex: 9, endIndex: 12 },
      { surface: '通り', pos: '名詞', reading: 'トオリ', startIndex: 12, endIndex: 14 },
      { surface: 'の', pos: '助詞', startIndex: 14, endIndex: 15 },
      { surface: 'あたし', pos: '名詞', reading: 'アタシ', startIndex: 15, endIndex: 18 },
    ]
    const segments = buildAlignmentSegments(original, translation, tokens)
    expect(segments).not.toBeNull()
    const words = splitTranslationWords(translation)
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map(() => [0.2, 0.2, 0.2, 0.2])
    const [result] = await alignLinesTokens([{ tokens, targetWords: [], segments: segments! }], embed)
    expect(result[2].alignmentIndices).toEqual([words.indexOf('Only')]) // だけ -> only
    expect(result[3].alignmentIndices).toEqual([words.indexOf('behind')]) // 遅れ -> behind
    expect(result[5].alignmentIndices).toEqual([words.indexOf('always')]) // いつも -> always
    expect(result[6].alignmentIndices).toEqual([words.indexOf('same')]) // 通り -> same
    expect(result[8].alignmentIndices).toEqual([words.indexOf("I'm")]) // あたし -> I'm
    expect(result[4].alignmentIndices).toBeUndefined() // てる
    expect(result[7].alignmentIndices).toBeUndefined() // の
    // Must not pair to function words
    expect(result.some((t) => t.alignmentIndices?.includes(words.indexOf('the')))).toBe(false)
    expect(result.some((t) => t.alignmentIndices?.includes(words.indexOf('as')))).toBe(false)
  })

  it('buildAlignJob stores display-space indices for mixed-script lines', async () => {
    const original = 'You always make me so happy 青空に溶けて'
    const translation = 'You always make me so happy\nMelt into the blue sky'
    const jaStart = original.indexOf('青空')
    const tokens: Token[] = [
      { surface: '青空', pos: '名詞', reading: 'アオゾラ', startIndex: jaStart, endIndex: jaStart + 2 },
      { surface: '溶け', pos: '動詞', reading: 'トケ', startIndex: jaStart + 3, endIndex: jaStart + 5 },
    ]
    const line = { startTime: 0, endTime: 1, original, translation, tokens }
    const job = buildAlignJob(line)
    const words = splitTranslationWords(translation)
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        if (t === 'aozora' || t === 'sky') return [1, 0, 0]
        if (t === 'toke' || t === 'melt') return [0, 1, 0]
        if (t === 'blue') return [0, 0, 1]
        return [0.1, 0.1, 0.1]
      })
    const [result] = await alignLinesTokens([job], embed)
    expect(result[0].alignmentIndices).toEqual([words.indexOf('sky')])
    expect(result[1].alignmentIndices).toEqual([words.indexOf('Melt')])
  })
})

describe('lyricGloss — AKFG vocabulary', () => {
  it('links rolling/korogaru and world/sekai for exact-match scoring', async () => {
    const { glossMatchesTarget } = await import('../../src/ai-pipeline/lyricGloss')
    expect(glossMatchesTarget('korogaru', 'rolling')).toBe(true)
    expect(glossMatchesTarget('rooringu', 'rolling')).toBe(true)
    expect(glossMatchesTarget('sekai', 'world')).toBe(true)
    expect(glossMatchesTarget('asa', 'morning')).toBe(true)
    expect(exactTextMatchScore('korogaru', 'rolling')).toBe(1)
  })
})
