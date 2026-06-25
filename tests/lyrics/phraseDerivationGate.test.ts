import { describe, it, expect } from 'vitest'
import type { LyricsData } from '../../src/core/types'
import { shouldDerivePhrasesForStoredSong } from '../../src/lyrics/phraseNormalize'

const lyrics = (over: Partial<LyricsData>): LyricsData => ({
  lines: [{ original: '歩いた', translation: 'I walked', startTime: 1, endTime: 3 }],
  sourceLanguage: 'ja',
  translationLanguage: 'en',
  alignmentMode: 'auto',
  transcriptWords: [{ word: 'あるいた', startTime: 1, endTime: 3 }],
  ...over,
})

describe('shouldDerivePhrasesForStoredSong', () => {
  it('derives when an auto-aligned song has a transcript but no phrases yet', () => {
    expect(shouldDerivePhrasesForStoredSong(lyrics({}))).toBe(true)
  })

  it('does not re-derive when phrases already exist', () => {
    const withPhrases = lyrics({
      phrases: [
        { id: 'p0', startTime: 1, endTime: 3, original: '歩いた', translation: 'I walked', anchorSource: 'lcs', sourceLineIndices: [0] },
      ],
    })
    expect(shouldDerivePhrasesForStoredSong(withPhrases)).toBe(false)
  })

  it('skips manual-only songs with no transcript', () => {
    expect(shouldDerivePhrasesForStoredSong(lyrics({ transcriptWords: undefined, alignmentMode: 'manual' }))).toBe(false)
    expect(shouldDerivePhrasesForStoredSong(lyrics({ transcriptWords: [] }))).toBe(false)
  })

  it('skips when there are no lines', () => {
    expect(shouldDerivePhrasesForStoredSong(lyrics({ lines: [] }))).toBe(false)
  })
})
