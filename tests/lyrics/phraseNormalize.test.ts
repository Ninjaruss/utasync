import { describe, it, expect } from 'vitest'
import type { TimedLine, TimedTranscriptWord } from '../../src/core/types'
import { derivePhrases, repairPhraseTranslationOrder } from '../../src/lyrics/phraseNormalize'
import type { SungPhrase, Token } from '../../src/core/types'

const line = (
  original: string,
  startTime: number,
  endTime: number,
  translation = '',
): TimedLine => ({ original, translation, startTime, endTime })

describe('derivePhrases — passthrough', () => {
  it('keeps anchored rows as one phrase each', () => {
    const lines = [
      line('歩いて行こう', 1, 3, "Let's keep walking"),
      line('明日へ', 3, 5, 'Toward tomorrow'),
    ]
    const { phrases, report } = derivePhrases(lines, [], ['lcs', 'lcs'])
    expect(phrases).toHaveLength(2)
    expect(phrases.map((p) => p.original)).toEqual(['歩いて行こう', '明日へ'])
    expect(phrases.map((p) => p.translation)).toEqual(["Let's keep walking", 'Toward tomorrow'])
    expect(phrases[0]).toMatchObject({ startTime: 1, endTime: 3, sourceLineIndices: [0] })
    expect(report.splits).toBe(0)
    expect(report.merges).toBe(0)
  })
})

describe('derivePhrases — merge', () => {
  it('folds an EN-only continuation row into the preceding sung phrase', () => {
    const lines = [
      line('岩は転がって落ちて', 1, 4, 'The rock rolls down'),
      line('', 4, 5, 'and breaks apart'),
    ]
    const { phrases, report } = derivePhrases(lines, [], ['lcs', 'interpolated'])
    expect(phrases).toHaveLength(1)
    expect(phrases[0]).toMatchObject({
      original: '岩は転がって落ちて',
      startTime: 1,
      endTime: 5,
      sourceLineIndices: [0, 1],
    })
    expect(phrases[0].translation).toBe('The rock rolls down and breaks apart')
    expect(report.merges).toBe(1)
  })

  it('folds a short interpolated fragment into the previous breath', () => {
    const lines = [
      line('夜の街を', 1, 3, 'Through the night town'),
      line('歩いた', 3, 4.5, 'I walked'),
    ]
    const { phrases } = derivePhrases(lines, [], ['lcs', 'interpolated'])
    expect(phrases).toHaveLength(1)
    expect(phrases[0].original).toBe('夜の街を 歩いた')
    expect(phrases[0].translation).toBe('Through the night town I walked')
  })

  it('folds a leading EN-only row into the following sung phrase', () => {
    const lines = [
      line('', 1, 2, 'Intro line'),
      line('始まりの歌', 2, 5, 'Song of beginning'),
    ]
    const { phrases } = derivePhrases(lines, [], ['interpolated', 'lcs'])
    expect(phrases).toHaveLength(1)
    expect(phrases[0]).toMatchObject({
      original: '始まりの歌',
      startTime: 1,
      endTime: 5,
      sourceLineIndices: [0, 1],
    })
    expect(phrases[0].translation).toBe('Intro line Song of beginning')
    expect(phrases[0].anchorSource).toBe('lcs')
  })

  it('does not merge two independently anchored rows', () => {
    const lines = [
      line('夜の街を', 1, 3, 'Through the night town'),
      line('歩いた', 3, 4.5, 'I walked'),
    ]
    const { phrases } = derivePhrases(lines, [], ['lcs', 'lcs'])
    expect(phrases).toHaveLength(2)
  })
})

const word = (w: string, startTime: number, endTime: number): TimedTranscriptWord => ({
  word: w,
  startTime,
  endTime,
})

describe('derivePhrases — split', () => {
  it('splits one row spanning two clusters at its phrase boundary', () => {
    const lines = [line('君の声が　遠くで響く', 0, 10, 'Your voice / echoes far away')]
    const words = [
      word('君の', 0, 1.5),
      word('声が', 1.5, 3),
      // 2s gap (≥ 1.5s) before the next cluster
      word('遠くで', 5, 7),
      word('響く', 7, 9),
    ]
    const { phrases, report } = derivePhrases(lines, words, ['lcs'])
    expect(phrases).toHaveLength(2)
    expect(phrases.map((p) => p.original)).toEqual(['君の声が', '遠くで響く'])
    expect(phrases.map((p) => p.translation)).toEqual(['Your voice', 'echoes far away'])
    expect(phrases[0]).toMatchObject({ startTime: 0, sourceLineIndices: [0] })
    expect(phrases[1]).toMatchObject({ endTime: 10, sourceLineIndices: [0] })
    // boundary sits in the silent gap between the two clusters
    expect(phrases[0].endTime).toBeGreaterThanOrEqual(3)
    expect(phrases[0].endTime).toBeLessThanOrEqual(5)
    expect(phrases[1].startTime).toBe(phrases[0].endTime)
    expect(report.splits).toBe(1)
  })

  it('does not split when there is no clear text boundary', () => {
    const lines = [line('遠くで響くこだま', 0, 10, 'A distant echo')]
    const words = [word('遠くで', 0, 2), word('響くこだま', 5, 9)]
    const { phrases, report } = derivePhrases(lines, words, ['lcs'])
    expect(phrases).toHaveLength(1)
    expect(report.splits).toBe(0)
  })

  it('does not split when the clusters are not separated by a gap', () => {
    const lines = [line('君の声が　遠くで響く', 0, 10, 'Your voice / echoes far away')]
    const words = [word('君の声が', 0, 4), word('遠くで響く', 4.2, 9)]
    const { phrases } = derivePhrases(lines, words, ['lcs'])
    expect(phrases).toHaveLength(1)
  })
})

describe('repairPhraseTranslationOrder', () => {
  const phrase = (original: string, translation: string, tokens?: Token[]): SungPhrase => ({
    id: original,
    startTime: 0,
    endTime: 1,
    original,
    translation,
    anchorSource: 'lcs',
    sourceLineIndices: [0],
    tokens,
  })

  it('leaves tokenless phrases untouched (Phase 1 has no tokens yet)', () => {
    const phrases = [phrase('夜の街を', 'Through the night town'), phrase('歩いた', 'I walked')]
    const out = repairPhraseTranslationOrder(phrases)
    expect(out.map((p) => p.translation)).toEqual(['Through the night town', 'I walked'])
  })

  it('returns the same number of phrases and preserves phrase identity fields', () => {
    const phrases = [phrase('A', 'a'), phrase('B', 'b')]
    const out = repairPhraseTranslationOrder(phrases)
    expect(out).toHaveLength(2)
    expect(out.map((p) => p.sourceLineIndices)).toEqual([[0], [0]])
    expect(out.map((p) => p.anchorSource)).toEqual(['lcs', 'lcs'])
  })
})
