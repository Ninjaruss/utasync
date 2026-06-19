import { describe, it, expect } from 'vitest'
import { dedupeTexts, embedCacheKey, expandVectors } from '../../src/ai-pipeline/embedTextUtils'

describe('embedCacheKey', () => {
  it('lowercases ASCII translation words', () => {
    expect(embedCacheKey('You')).toBe('you')
    expect(embedCacheKey('  LOVE ')).toBe('love')
  })

  it('preserves CJK surfaces', () => {
    expect(embedCacheKey('君')).toBe('君')
    expect(embedCacheKey('  愛  ')).toBe('愛')
  })
})

describe('dedupeTexts', () => {
  it('collapses duplicate surfaces and English words', () => {
    const { unique, indexMap } = dedupeTexts(['君', 'you', '君', 'You', 'like'])
    expect(unique).toEqual(['君', 'you', 'like'])
    expect(indexMap).toEqual([0, 1, 0, 1, 2])
  })

  it('returns identity mapping when all texts are unique', () => {
    const { unique, indexMap } = dedupeTexts(['a', 'b', 'c'])
    expect(unique).toEqual(['a', 'b', 'c'])
    expect(indexMap).toEqual([0, 1, 2])
  })
})

describe('expandVectors', () => {
  it('maps unique vectors back to original order', () => {
    const vecs = expandVectors([[1], [2], [3]], [0, 1, 0, 2])
    expect(vecs).toEqual([[1], [2], [1], [3]])
  })
})
