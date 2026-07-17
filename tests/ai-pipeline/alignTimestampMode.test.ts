import { describe, it, expect } from 'vitest'
import type { TimedLine, TimedTranscriptWord } from '../../src/core/types'
import {
  preferredWhisperTimestampMode,
  accurateReadingsAvailable,
  accurateReadingsEstimate,
  accurateRealignReason,
  countMergedTranscriptSegments,
  suggestsWordLevelAlignment,
} from '../../src/ai-pipeline/alignTimestampMode'
import type { LineAlignmentQuality } from '../../src/core/types'

const line = (startTime: number, endTime: number): TimedLine => ({
  original: 'x',
  translation: '',
  startTime,
  endTime,
})
const seg = (word: string, startTime: number, endTime: number): TimedTranscriptWord => ({
  word,
  startTime,
  endTime,
})

describe('preferredWhisperTimestampMode', () => {
  it('uses segment timestamps on lite tier', () => {
    expect(preferredWhisperTimestampMode('lite', 60)).toBe('segment')
  })

  it('uses segment timestamps for long songs on full tier (speed default; accuracy on-demand)', () => {
    expect(preferredWhisperTimestampMode('full', 300)).toBe('segment')
    expect(preferredWhisperTimestampMode('full', 200)).toBe('segment')
  })

  it('uses word timestamps for short songs on full tier', () => {
    expect(preferredWhisperTimestampMode('full', 120)).toBe('word')
  })

  it('forces word timestamps on full tier when accurate readings are opted in', () => {
    expect(preferredWhisperTimestampMode('full', 300, { accurateReadings: true })).toBe('word')
  })

  it('honors the accurate-readings opt-in on lite tier (default stays segment)', () => {
    expect(preferredWhisperTimestampMode('lite', 120, { accurateReadings: true })).toBe('word')
    expect(preferredWhisperTimestampMode('lite', 300, { accurateReadings: true })).toBe('word')
  })
})

describe('accurateReadingsAvailable', () => {
  it('is offered on full tier for long songs (short songs already use word mode)', () => {
    expect(accurateReadingsAvailable('full', 300)).toBe(true)
    expect(accurateReadingsAvailable('full', 120)).toBe(false)
    expect(accurateReadingsAvailable('manual', 300)).toBe(false)
  })
  it('is offered on lite tier for any duration (lite defaults to segment)', () => {
    expect(accurateReadingsAvailable('lite', 120)).toBe(true)
    expect(accurateReadingsAvailable('lite', 300)).toBe(true)
  })
})

describe('accurateReadingsEstimate', () => {
  it('gives a time estimate only when the slower pass would actually run', () => {
    expect(accurateReadingsEstimate('full', 300)).toBe('~3–8 min')
    expect(accurateReadingsEstimate('full', 120)).toBeNull()
    expect(accurateReadingsEstimate('lite', 300)).toBe('~3–8 min')
    expect(accurateReadingsEstimate('manual', 300)).toBeNull()
  })
})

describe('countMergedTranscriptSegments', () => {
  it('counts transcript chunks that span two or more lyric lines', () => {
    const lines = [line(0, 3), line(3, 5), line(6, 8), line(9, 12)]
    // chunk 0 covers lines starting at 0 and 3 (merged); chunk 1 covers only line 2
    const words = [seg('a b', 0, 5.5), seg('c', 6, 8.5)]
    expect(countMergedTranscriptSegments(lines, words)).toBe(1)
  })

  it('is zero for word-level transcripts (one chunk per line region)', () => {
    const lines = [line(0, 3), line(3, 6)]
    const words = [seg('a', 0, 1), seg('b', 1, 2), seg('c', 3, 4), seg('d', 4, 5)]
    expect(countMergedTranscriptSegments(lines, words)).toBe(0)
  })
})

describe('suggestsWordLevelAlignment', () => {
  const merged = [line(0, 3), line(3, 5), line(6, 9), line(9, 11)]
  const mergedWords = [seg('a b', 0, 5.5), seg('c d', 6, 11.5)]

  it('suggests on full tier when the segment transcript merged multiple lines', () => {
    expect(suggestsWordLevelAlignment(merged, mergedWords, 'full')).toBe(true)
  })

  it('suggests on lite tier too (the word-mode opt-in is honored there)', () => {
    expect(suggestsWordLevelAlignment(merged, mergedWords, 'lite')).toBe(true)
  })

  it('does not suggest on manual tier (auto-align unavailable)', () => {
    expect(suggestsWordLevelAlignment(merged, mergedWords, 'manual')).toBe(false)
  })

  it('does not suggest when nothing is merged (already word-level / clean)', () => {
    const clean = [line(0, 3), line(3, 6)]
    const cleanWords = [seg('a', 0, 1.4), seg('b', 3, 4.4)]
    expect(suggestsWordLevelAlignment(clean, cleanWords, 'full')).toBe(false)
  })
})

describe('accurateRealignReason', () => {
  const merged = [line(0, 3), line(3, 5), line(6, 9), line(9, 11)]
  const mergedWords = [seg('a b', 0, 5.5), seg('c d', 6, 11.5)]
  const wordWords = [seg('a', 0, 1.4), seg('b', 3, 4.4)]
  const q = (labels: string): LineAlignmentQuality[] =>
    [...labels].map((c) => (c === 'g' ? 'good' : c === 'a' ? 'approximate' : 'needs_review'))

  it('reports segment-blocks when the transcript merged multiple lines (existing hint)', () => {
    expect(accurateRealignReason(merged, mergedWords, q('gggg'), 'full')).toBe('segment-blocks')
  })

  it('reports weak-labels when a large share of lines could not be verified', () => {
    // 12 lines, 7 not-good (58%) — well past the 35% / 6-line floor.
    const lines = Array.from({ length: 12 }, (_, i) => line(i * 3, i * 3 + 3))
    expect(accurateRealignReason(lines, wordWords, q('gggggaaannnn'), 'full')).toBe('weak-labels')
  })

  it('stays quiet for a mostly-verified song (off-timing banner owns stray rows)', () => {
    // 12 lines, 3 not-good (25%) — below both floors.
    const lines = Array.from({ length: 12 }, (_, i) => line(i * 3, i * 3 + 3))
    expect(accurateRealignReason(lines, wordWords, q('gggggggggann'), 'full')).toBe(null)
  })

  it('needs the absolute line floor, not just the share', () => {
    // 5 not-good of 8 (63%) but under the 6-line floor.
    const lines = Array.from({ length: 8 }, (_, i) => line(i * 3, i * 3 + 3))
    expect(accurateRealignReason(lines, wordWords, q('gggaaann'), 'full')).toBe(null)
  })

  it('is null on manual tier and without labels', () => {
    const lines = Array.from({ length: 12 }, (_, i) => line(i * 3, i * 3 + 3))
    expect(accurateRealignReason(lines, wordWords, q('gggggaaannnn'), 'manual')).toBe(null)
    expect(accurateRealignReason(lines, wordWords, undefined, 'full')).toBe(null)
  })

  it('ignores blank rows when computing the share', () => {
    // 7 real lines + 5 blanks; 6 of 7 real lines unverified -> fires even
    // though the not-good share of ALL 12 rows (50%) would also pass — the
    // blanks (all 'good') must not dilute the scoreable share.
    const lines = [
      ...Array.from({ length: 7 }, (_, i) => line(i * 3, i * 3 + 3)),
      ...Array.from({ length: 5 }, (_, i) => ({ original: '', translation: '', startTime: 50 + i, endTime: 51 + i })),
    ]
    expect(accurateRealignReason(lines, wordWords, q('gaaannnggggg'), 'full')).toBe('weak-labels')
  })
})
