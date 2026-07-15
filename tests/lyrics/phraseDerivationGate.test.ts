import { describe, it, expect } from 'vitest'
import type { LyricsData } from '../../src/core/types'
import {
  ALIGNMENT_PIPELINE_VERSION,
  needsMixedRealign,
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

/** A code-switching sheet: 3 JA lines + 3 substantial Latin lines → detectSheetLanguage 'mixed'. */
const mixedLyrics = (over: Partial<LyricsData>): LyricsData =>
  lyrics({
    lines: [
      { original: '歩いた道', translation: '', startTime: 1, endTime: 3 },
      { original: '君の声が', translation: '', startTime: 3, endTime: 5 },
      { original: '空を見て', translation: '', startTime: 5, endTime: 7 },
      { original: 'we are the night', translation: '', startTime: 7, endTime: 9 },
      { original: 'hold me close now', translation: '', startTime: 9, endTime: 11 },
      { original: 'never let me go', translation: '', startTime: 11, endTime: 13 },
    ],
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

  // Round-6 A1: bumping the version must make songs aligned by the *previous*
  // pipeline (v19) re-refine with the new fixes on open.
  it('re-refines a JA song stamped with the previous pipeline version', () => {
    expect(
      shouldRefineStoredAlignment(lyrics({ alignmentPipelineVersion: ALIGNMENT_PIPELINE_VERSION - 1 })),
    ).toBe(true)
  })

  // Round-6 A2a: a mixed song's stored transcript is the merged single stream —
  // a single-pass re-refine cannot reconstruct the two-pass EN-forced merge and
  // can corrupt a good round-5 alignment, so it must be skipped regardless of version.
  it('skips mixed-language songs even when below the current version', () => {
    expect(
      shouldRefineStoredAlignment(mixedLyrics({ alignmentPipelineVersion: 0 })),
    ).toBe(false)
    expect(
      shouldRefineStoredAlignment(mixedLyrics({ alignmentPipelineVersion: ALIGNMENT_PIPELINE_VERSION - 1 })),
    ).toBe(false)
  })
})

describe('needsMixedRealign', () => {
  it('flags a mixed-language song aligned before the current pipeline version', () => {
    expect(needsMixedRealign(mixedLyrics({ alignmentPipelineVersion: 0 }))).toBe(true)
    expect(
      needsMixedRealign(mixedLyrics({ alignmentPipelineVersion: ALIGNMENT_PIPELINE_VERSION - 1 })),
    ).toBe(true)
  })

  it('does not flag a mixed song already on the current version', () => {
    expect(
      needsMixedRealign(mixedLyrics({ alignmentPipelineVersion: ALIGNMENT_PIPELINE_VERSION })),
    ).toBe(false)
  })

  it('does not flag JA-only songs at any version (single-pass re-refine fixes them)', () => {
    expect(needsMixedRealign(lyrics({ alignmentPipelineVersion: 0 }))).toBe(false)
    expect(
      needsMixedRealign(lyrics({ alignmentPipelineVersion: ALIGNMENT_PIPELINE_VERSION - 1 })),
    ).toBe(false)
  })

  it('does not flag manual or transcript-less mixed songs', () => {
    expect(
      needsMixedRealign(mixedLyrics({ alignmentMode: 'manual', alignmentPipelineVersion: 0 })),
    ).toBe(false)
    expect(
      needsMixedRealign(mixedLyrics({ transcriptWords: undefined, alignmentPipelineVersion: 0 })),
    ).toBe(false)
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
