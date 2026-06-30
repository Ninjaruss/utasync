import { describe, it, expect } from 'vitest'
import { alignByContent } from '../../src/ai-pipeline/contentAligner'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

/**
 * Regression: a line's end must reflect where its final mora finishes being sung,
 * not where that mora *begins*. Whisper word tokens carry real onsets and offsets;
 * a drawn-out closing mora (melisma) is its own token spanning seconds. Stamping
 * the line end at the token onset clipped the held tail — an AB-loop of the line
 * then stopped before the listener heard the final syllable (real AKFG case:
 * 僕らはきっとこの先も looped out right before 先も).
 */
describe('line end at final-mora offset', () => {
  it('extends a line to the offset of a held closing mora', () => {
    const line = 'さきも'
    const words: TranscriptWord[] = [
      { word: 'さ', startTime: 10.0, endTime: 10.4 },
      { word: 'き', startTime: 10.4, endTime: 10.8 },
      { word: 'も', startTime: 10.8, endTime: 13.0 }, // drawn-out final mora
    ]
    const { lines } = alignByContent([line], words, undefined, 'ja')
    // The closing mora finishes at 13.0; the line must not end at its 10.8 onset.
    expect(lines[0].endTime).toBeGreaterThan(12.5)
  })

  it('keeps the next line handoff clean while capturing the tail', () => {
    const lineA = 'さきも'
    const lineB = 'こころ'
    const words: TranscriptWord[] = [
      { word: 'さ', startTime: 10.0, endTime: 10.4 },
      { word: 'き', startTime: 10.4, endTime: 10.8 },
      { word: 'も', startTime: 10.8, endTime: 12.0 },
      { word: 'こ', startTime: 12.4, endTime: 12.7 },
      { word: 'こ', startTime: 12.7, endTime: 13.0 },
      { word: 'ろ', startTime: 13.0, endTime: 13.6 },
    ]
    const { lines } = alignByContent([lineA, lineB], words, undefined, 'ja')
    expect(lines[0].endTime).toBeGreaterThan(11.8) // captured the held も
    expect(lines[0].endTime).toBeLessThanOrEqual(lines[1].startTime) // no overlap
  })
})
