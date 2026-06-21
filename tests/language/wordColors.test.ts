import { describe, it, expect } from 'vitest'
import {
  splitTranslationWords,
  splitTranslationLines,
  splitTranslationLineWords,
  translationWordCount,
  colorForToken,
  colorForTranslationWord,
  PARTICLE_COLOR,
  PAIR_COLORS,
} from '../../src/language/wordColors'
import type { Token } from '../../src/core/types'

const tok = (surface: string, pos: string, alignmentIndices?: number[]): Token =>
  ({ surface, pos, startIndex: 0, endIndex: surface.length, alignmentIndices })

describe('splitTranslationWords', () => {
  it('splits on whitespace and drops empty entries', () => {
    expect(splitTranslationWords('  I  like   you ')).toEqual(['I', 'like', 'you'])
  })

  it('strips leading and trailing punctuation from words', () => {
    expect(splitTranslationWords('Hello, world!')).toEqual(['Hello', 'world'])
    expect(splitTranslationWords('"you" — love.')).toEqual(['you', 'love'])
  })

  it('flattens newline-separated translation lines in order', () => {
    expect(splitTranslationWords('Beside you\nAdjacent hearts')).toEqual(['Beside', 'you', 'Adjacent', 'hearts'])
  })

  it('splitTranslationLines flattens to the same global indices as splitTranslationWords', () => {
    const text = "Only one step behind\nI'm the same as always"
    const flat = splitTranslationWords(text)
    const lines = splitTranslationLines(text)
    let offset = 0
    for (const words of lines) {
      for (let i = 0; i < words.length; i++) {
        expect(words[i]).toBe(flat[offset + i])
      }
      offset += words.length
    }
    expect(offset).toBe(flat.length)
    expect(translationWordCount(text)).toBe(flat.length)
  })

  it('splitTranslationLineWords strips punctuation on a single line', () => {
    expect(splitTranslationLineWords('Hello, world!')).toEqual(['Hello', 'world'])
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

  it('gives every source token mapped to the same word — and that word — one shared color', () => {
    // Many-to-one: 君 and こと both map to translation word "you" (index 1).
    const tokens = [tok('君', '名詞', [1]), tok('こと', '名詞', [1]), tok('好き', '名詞', [3])]
    const shared = colorForTranslationWord(tokens, 1)
    expect(shared).not.toBeNull()
    expect(colorForToken(tokens, 0)).toBe(shared)
    expect(colorForToken(tokens, 1)).toBe(shared)
    // A different pair keeps a distinct color, consistent on both sides.
    const other = colorForTranslationWord(tokens, 3)
    expect(other).not.toBe(shared)
    expect(colorForToken(tokens, 2)).toBe(other)
  })
})
