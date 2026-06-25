import { describe, it, expect, vi } from 'vitest'
import type { SungPhrase, Token, TimedTranscriptWord } from '../../src/core/types'
import type { TimedLine } from '../../src/core/types'
import { enrichPhraseTokens, enrichAndProjectPhrases } from '../../src/lyrics/phraseEnrichment'

const phrase = (original: string, sourceLineIndices: number[]): SungPhrase => ({
  id: original,
  startTime: 0,
  endTime: 1,
  original,
  translation: '',
  anchorSource: 'lcs',
  sourceLineIndices,
})

const tok = (surface: string, extra: Partial<Token> = {}): Token => ({
  surface,
  startIndex: 0,
  endIndex: surface.length,
  ...extra,
})

describe('enrichPhraseTokens', () => {
  it('tokenizes each phrase from its own original text', async () => {
    const tokenizePhrase = vi.fn(async (text: string) => [tok(text, { reading: 'X' })])
    const out = await enrichPhraseTokens([phrase('戦争', [0]), phrase('理由', [1])], undefined, {
      tokenizePhrase,
    })
    expect(tokenizePhrase).toHaveBeenCalledWith('戦争')
    expect(tokenizePhrase).toHaveBeenCalledWith('理由')
    expect(out[0].tokens).toEqual([tok('戦争', { reading: 'X' })])
  })

  it('runs the reading reconciler when a transcript is present', async () => {
    const words: TimedTranscriptWord[] = [{ word: 'わけ', startTime: 0, endTime: 1 }]
    const tokenizePhrase = vi.fn(async () => [tok('理由', { reading: 'リユウ' })])
    const reconcilePhraseReadings = vi.fn(async (p: SungPhrase) =>
      (p.tokens ?? []).map((t) => ({ ...t, audioReading: 'ワケ', readingConfidence: 0.9 })),
    )
    const out = await enrichPhraseTokens([phrase('理由', [0])], words, {
      tokenizePhrase,
      reconcilePhraseReadings,
    })
    expect(reconcilePhraseReadings).toHaveBeenCalledOnce()
    expect(out[0].tokens?.[0]).toMatchObject({ audioReading: 'ワケ', readingConfidence: 0.9 })
  })

  it('skips reconciliation when there is no transcript', async () => {
    const tokenizePhrase = vi.fn(async () => [tok('理由')])
    const reconcilePhraseReadings = vi.fn(async (p: SungPhrase) => p.tokens ?? [])
    await enrichPhraseTokens([phrase('理由', [0])], [], { tokenizePhrase, reconcilePhraseReadings })
    expect(reconcilePhraseReadings).not.toHaveBeenCalled()
  })

  it('keeps the phrase when tokenization throws', async () => {
    const tokenizePhrase = vi.fn(async () => {
      throw new Error('kuromoji down')
    })
    const out = await enrichPhraseTokens([phrase('戦争', [0])], undefined, { tokenizePhrase })
    expect(out[0].tokens).toBeUndefined()
    expect(out[0].original).toBe('戦争')
  })
})

describe('per-phrase word alignment (2.3)', () => {
  it('runs alignPhraseTokens after tokenization', async () => {
    const tokenizePhrase = vi.fn(async () => [tok('歩いた')])
    const alignPhraseTokens = vi.fn(async (p: SungPhrase) =>
      (p.tokens ?? []).map((t) => ({ ...t, alignmentIndices: [0, 1] })),
    )
    const out = await enrichPhraseTokens([phrase('歩いた', [0])], undefined, {
      tokenizePhrase,
      alignPhraseTokens,
    })
    expect(alignPhraseTokens).toHaveBeenCalledOnce()
    expect(out[0].tokens?.[0].alignmentIndices).toEqual([0, 1])
  })

  it('keeps tokenized readings when alignment throws', async () => {
    const tokenizePhrase = vi.fn(async () => [tok('歩いた', { reading: 'アルイタ' })])
    const alignPhraseTokens = vi.fn(async () => {
      throw new Error('embedder down')
    })
    const out = await enrichPhraseTokens([phrase('歩いた', [0])], undefined, {
      tokenizePhrase,
      alignPhraseTokens,
    })
    expect(out[0].tokens?.[0]).toMatchObject({ reading: 'アルイタ' })
    expect(out[0].tokens?.[0].alignmentIndices).toBeUndefined()
  })
})

describe('enrichAndProjectPhrases', () => {
  it('enriches phrases and projects their tokens onto the display lines', async () => {
    const lines: TimedLine[] = [
      { original: '夜の街を', translation: '', startTime: 1, endTime: 3 },
      { original: '歩いた', translation: '', startTime: 3, endTime: 5 },
    ]
    // one merged phrase covering both rows
    const merged = phrase('夜の街を 歩いた', [0, 1])
    const tokenizePhrase = vi.fn(async () => [
      tok('夜の街を'),
      { surface: '歩いた', startIndex: 5, endIndex: 8 },
    ])
    const out = await enrichAndProjectPhrases(lines, [merged], undefined, { tokenizePhrase })
    expect(out.lines[0].tokens?.map((t) => t.surface)).toEqual(['夜の街を'])
    expect(out.lines[1].tokens).toEqual([{ surface: '歩いた', startIndex: 0, endIndex: 3 }])
    expect(out.phrases[0].tokens).toHaveLength(2)
  })
})
