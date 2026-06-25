import { describe, it, expect } from 'vitest'
import type { SungPhrase, TimedLine, Token } from '../../src/core/types'
import { projectPhraseTokensToLines } from '../../src/lyrics/phraseProjection'

const line = (original: string, startTime: number, endTime: number, translation = ''): TimedLine => ({
  original,
  translation,
  startTime,
  endTime,
})

const tok = (surface: string, startIndex: number, extra: Partial<Token> = {}): Token => ({
  surface,
  startIndex,
  endIndex: startIndex + surface.length,
  ...extra,
})

const phrase = (
  original: string,
  sourceLineIndices: number[],
  tokens: Token[],
  startTime = 0,
  endTime = 1,
): SungPhrase => ({
  id: original,
  startTime,
  endTime,
  original,
  translation: '',
  anchorSource: 'lcs',
  sourceLineIndices,
  tokens,
})

describe('projectPhraseTokensToLines', () => {
  it('maps a passthrough phrase straight onto its line, preserving readings', () => {
    const lines = [line('歩いて行こう', 1, 3)]
    const tokens = [
      tok('歩い', 0, { reading: 'アル' }),
      tok('て', 2),
      tok('行こう', 3, { reading: 'イコウ', audioReading: 'ユコウ', readingConfidence: 0.9 }),
    ]
    const out = projectPhraseTokensToLines(lines, [phrase('歩いて行こう', [0], tokens)])
    expect(out[0].tokens).toEqual(tokens)
  })

  it('splits a merged phrase back onto each source line with re-based offsets', () => {
    const lines = [line('夜の街を', 1, 3), line('歩いた', 3, 5)]
    const tokens = [tok('夜の街を', 0), tok('歩いた', 5)] // merged original "夜の街を 歩いた"
    const out = projectPhraseTokensToLines(lines, [phrase('夜の街を 歩いた', [0, 1], tokens)])
    expect(out[0].tokens).toEqual([tok('夜の街を', 0)])
    expect(out[1].tokens).toEqual([tok('歩いた', 0)])
  })

  it('re-joins split phrases onto a single line with original offsets', () => {
    const lines = [line('君の声が　遠くで響く', 0, 10)]
    const phrases = [
      phrase('君の声が', [0], [tok('君の声が', 0)], 0, 4),
      phrase('遠くで響く', [0], [tok('遠くで響く', 0)], 4, 10),
    ]
    const out = projectPhraseTokensToLines(lines, phrases)
    // full-width space is index 4 in the original line, so 遠くで響く starts at 5
    expect(out[0].tokens).toEqual([tok('君の声が', 0), tok('遠くで響く', 5)])
  })

  it('leaves an EN-only source line tokenless and never throws', () => {
    const lines = [line('岩は転がって', 1, 4, 'The rock rolls'), line('', 4, 5, 'and falls')]
    const tokens = [tok('岩は', 0), tok('転がって', 2)]
    const out = projectPhraseTokensToLines(lines, [phrase('岩は転がって', [0, 1], tokens)])
    expect(out[0].tokens).toEqual(tokens)
    expect(out[1].tokens).toBeUndefined()
  })

  it('returns lines unchanged when no phrases carry tokens', () => {
    const lines = [line('歩いて行こう', 1, 3)]
    const out = projectPhraseTokensToLines(lines, [phrase('歩いて行こう', [0], [])])
    expect(out[0].tokens).toBeUndefined()
  })
})
