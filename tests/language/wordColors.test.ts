import { describe, it, expect } from 'vitest'
import { splitTranslationWords, colorForToken, colorForTranslationWord, PARTICLE_COLOR, PAIR_COLORS } from '../../src/language/wordColors'
import type { Token } from '../../src/core/types'

const tok = (surface: string, pos: string, alignmentIndices?: number[]): Token =>
  ({ surface, pos, startIndex: 0, endIndex: surface.length, alignmentIndices })

describe('splitTranslationWords', () => {
  it('splits on whitespace and drops empty entries', () => {
    expect(splitTranslationWords('  I  like   you ')).toEqual(['I', 'like', 'you'])
  })
})

describe('colorForToken', () => {
  it('gives particles the fixed particle color regardless of match state', () => {
    const tokens = [tok('君', '名詞', [0]), tok('が', '助詞')]
    expect(colorForToken(tokens, 1)).toBe(PARTICLE_COLOR)
  })
  it('gives matched non-particle tokens a palette color', () => {
    const tokens = [tok('君', '名詞', [0])]
    expect(colorForToken(tokens, 0)).toBe(PAIR_COLORS[0])
  })
  it('gives unmatched non-particle tokens no color', () => {
    const tokens = [tok('君', '名詞')]
    expect(colorForToken(tokens, 0)).toBeNull()
  })
  it('cycles palette colors by order of matched tokens within the line', () => {
    const tokens = [tok('a', '名詞', [0]), tok('b', '助詞'), tok('c', '名詞', [1])]
    expect(colorForToken(tokens, 0)).toBe(PAIR_COLORS[0])
    expect(colorForToken(tokens, 2)).toBe(PAIR_COLORS[1 % PAIR_COLORS.length])
  })
  it('returns null instead of throwing for an index past the end of tokens', () => {
    const tokens = [tok('君', '名詞', [0])]
    expect(colorForToken(tokens, tokens.length)).toBeNull()
  })
  it('returns null instead of throwing for a negative index', () => {
    const tokens = [tok('君', '名詞', [0])]
    expect(colorForToken(tokens, -1)).toBeNull()
  })
})

describe('colorForTranslationWord', () => {
  it('matches the color of the token whose alignmentIndices points to it', () => {
    const tokens = [tok('君', '名詞', [0]), tok('好き', '名詞', [2])]
    expect(colorForTranslationWord(tokens, 0)).toBe(colorForToken(tokens, 0))
    expect(colorForTranslationWord(tokens, 2)).toBe(colorForToken(tokens, 1))
  })
  it('returns null for an unmatched translation word index', () => {
    const tokens = [tok('君', '名詞', [0])]
    expect(colorForTranslationWord(tokens, 5)).toBeNull()
  })
})
