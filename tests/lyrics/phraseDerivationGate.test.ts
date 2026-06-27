import { describe, it, expect } from 'vitest'
import type { LyricsData } from '../../src/core/types'
import {
  ALIGNMENT_PIPELINE_VERSION,
  shouldRefineStoredAlignment,
} from '../../src/lyrics/phraseAlignment'
import { shouldDerivePhrasesForStoredSong } from '../../src/lyrics/phraseNormalize'

const lyrics = (over: Partial<LyricsData>): LyricsData => ({
  lines: [{ original: '歩いた', translation: 'I walked', startTime: 1, endTime: 3 }],
  sourceLanguage: 'ja',
  translationLanguage: 'en',
  alignmentMode: 'auto',
  transcriptWords: [{ word: 'あるいた', startTime: 1, endTime: 3 }],
  ...over,
})

describe('shouldRefineStoredAlignment', () => {
  it('refines when pipeline version is below current', () => {
    expect(shouldRefineStoredAlignment(lyrics({ alignmentPipelineVersion: 0 }))).toBe(true)
    expect(shouldRefineStoredAlignment(lyrics({ alignmentPipelineVersion: 1 }))).toBe(true)
    expect(shouldRefineStoredAlignment(lyrics({ alignmentPipelineVersion: 2 }))).toBe(true)
  })

  it('skips when already on the current pipeline version', () => {
    expect(
      shouldRefineStoredAlignment(lyrics({ alignmentPipelineVersion: ALIGNMENT_PIPELINE_VERSION })),
    ).toBe(false)
  })

  it('re-refines songs that already have phrases but stale pipeline version', () => {
    const withPhrases = lyrics({
      alignmentPipelineVersion: 1,
      phrases: [
        {
          id: 'p0',
          startTime: 1,
          endTime: 3,
          original: '歩いた',
          translation: 'I walked',
          anchorSource: 'lcs',
          sourceLineIndices: [0],
        },
      ],
    })
    expect(shouldRefineStoredAlignment(withPhrases)).toBe(true)
  })

  it('skips manual-only songs with no transcript', () => {
    expect(
      shouldRefineStoredAlignment(lyrics({ transcriptWords: undefined, alignmentMode: 'manual' })),
    ).toBe(false)
    expect(shouldRefineStoredAlignment(lyrics({ transcriptWords: [] }))).toBe(false)
  })

  it('skips when there are no lines', () => {
    expect(shouldRefineStoredAlignment(lyrics({ lines: [] }))).toBe(false)
  })
})

describe('shouldDerivePhrasesForStoredSong (legacy)', () => {
  it('only gates on missing phrases', () => {
    expect(shouldDerivePhrasesForStoredSong(lyrics({}))).toBe(true)
    expect(
      shouldDerivePhrasesForStoredSong(
        lyrics({
          phrases: [
            {
              id: 'p0',
              startTime: 1,
              endTime: 3,
              original: '歩いた',
              translation: 'I walked',
              anchorSource: 'lcs',
              sourceLineIndices: [0],
            },
          ],
        }),
      ),
    ).toBe(false)
  })
})
