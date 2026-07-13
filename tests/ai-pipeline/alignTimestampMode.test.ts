import { describe, it, expect } from 'vitest'
import type { TimedLine, TimedTranscriptWord } from '../../src/core/types'
import {
  preferredWhisperTimestampMode,
  accurateReadingsAvailable,
  accurateReadingsEstimate,
  countMergedTranscriptSegments,
  suggestsWordLevelAlignment,
} from '../../src/ai-pipeline/alignTimestampMode'

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

  it('uses segment timestamps for long songs on full tier', () => {
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
