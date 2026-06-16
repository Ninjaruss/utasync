import { describe, it, expect } from 'vitest'
import { alignTranscriptToLines, type TranscriptWord } from '../../src/ai-pipeline/aligner'
import type { TimedLine } from '../../src/core/types'

const plainLines = ['star in the sky', 'waiting in dreams']

const transcriptWords: TranscriptWord[] = [
  { word: 'star', startTime: 1.0, endTime: 1.5 },
  { word: 'in', startTime: 1.5, endTime: 1.7 },
  { word: 'the', startTime: 1.7, endTime: 1.9 },
  { word: 'sky', startTime: 1.9, endTime: 2.4 },
  { word: 'waiting', startTime: 3.0, endTime: 3.6 },
  { word: 'in', startTime: 3.6, endTime: 3.8 },
  { word: 'dreams', startTime: 3.8, endTime: 4.3 },
]

function isMonotonic(lines: TimedLine[]): boolean {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startTime < lines[i - 1].startTime) return false
  }
  return true
}

describe('alignTranscriptToLines', () => {
  it('anchors the first line to the first transcript word and stays monotonic', () => {
    const result = alignTranscriptToLines(plainLines, transcriptWords)
    expect(result).toHaveLength(2)
    expect(result[0].startTime).toBeCloseTo(1.0)
    expect(isMonotonic(result)).toBe(true)
    // Second line starts later than the first and within the transcript span.
    expect(result[1].startTime).toBeGreaterThan(result[0].startTime)
    expect(result[1].startTime).toBeLessThanOrEqual(4.3)
    // Lines are stitched end-to-start so there are no gaps/overlaps.
    expect(result[0].endTime).toBeCloseTo(result[1].startTime)
  })

  it('preserves original and translation text', () => {
    const existingLines: TimedLine[] = [
      { startTime: 0, endTime: 0, original: '星に願いを', translation: 'Star in the sky' },
      { startTime: 0, endTime: 0, original: '夢の中で待ってる', translation: 'Waiting in dreams' },
    ]
    const result = alignTranscriptToLines(
      existingLines.map((l) => l.original),
      transcriptWords,
      existingLines
    )
    expect(result[0].original).toBe('星に願いを')
    expect(result[0].translation).toBe('Star in the sky')
  })

  it('spreads spaceless (Japanese) lines across the whole transcript span', () => {
    // 5 Japanese lines (no spaces), 30 word-chunks spanning ~2s..60s.
    const lines = ['星空に願いをこめて', '夜の街を駆け抜ける', '君の声が聞こえる', '光の中で踊ろう', '明日へと続く道']
    const words: TranscriptWord[] = Array.from({ length: 30 }, (_, i) => ({
      word: `語${i}`,
      startTime: 2 + i * 2,
      endTime: 2 + i * 2 + 1.5,
    }))
    const result = alignTranscriptToLines(lines, words)

    expect(result).toHaveLength(5)
    expect(isMonotonic(result)).toBe(true)
    expect(result[0].startTime).toBeCloseTo(2, 0)
    // The last line must land in the back half of the song, not bunched at 0.
    expect(result[4].startTime).toBeGreaterThan(30)
    // The final line ends at (or near) the end of the transcript.
    expect(result[4].endTime).toBeGreaterThan(55)
  })

  it('handles an empty transcript without crashing', () => {
    const result = alignTranscriptToLines(plainLines, [])
    expect(result).toHaveLength(2)
    expect(result.every((l) => l.startTime === 0 && l.endTime === 0)).toBe(true)
  })

  it('handles more lines than transcript words and stays monotonic', () => {
    const lines = ['a', 'b', 'c', 'd', 'e']
    const words: TranscriptWord[] = [
      { word: 'x', startTime: 1, endTime: 2 },
      { word: 'y', startTime: 3, endTime: 4 },
    ]
    const result = alignTranscriptToLines(lines, words)
    expect(result).toHaveLength(5)
    expect(isMonotonic(result)).toBe(true)
  })
})
