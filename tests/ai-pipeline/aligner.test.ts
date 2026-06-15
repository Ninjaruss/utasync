import { describe, it, expect } from 'vitest'
import { alignTranscriptToLines } from '../../src/ai-pipeline/aligner'
import type { TimedLine } from '../../src/core/types'

const plainLines = ['star in the sky', 'waiting in dreams']

const transcriptWords = [
  { word: 'star', startTime: 1.0, endTime: 1.5 },
  { word: 'in', startTime: 1.5, endTime: 1.7 },
  { word: 'the', startTime: 1.7, endTime: 1.9 },
  { word: 'sky', startTime: 1.9, endTime: 2.4 },
  { word: 'waiting', startTime: 3.0, endTime: 3.6 },
  { word: 'in', startTime: 3.6, endTime: 3.8 },
  { word: 'dreams', startTime: 3.8, endTime: 4.3 },
]

describe('alignTranscriptToLines', () => {
  it('assigns correct start/end times to each line', () => {
    const result = alignTranscriptToLines(plainLines, transcriptWords)
    expect(result[0].startTime).toBeCloseTo(1.0)
    expect(result[0].endTime).toBeCloseTo(3.0)
    expect(result[1].startTime).toBeCloseTo(3.0)
  })

  it('preserves original and translation text', () => {
    const existingLines: TimedLine[] = [
      { startTime: 0, endTime: 0, original: '星に願いを', translation: 'Star in the sky' },
      { startTime: 0, endTime: 0, original: '夢の中で待ってる', translation: 'Waiting in dreams' },
    ]
    const result = alignTranscriptToLines(
      existingLines.map((l) => l.translation),
      transcriptWords,
      existingLines
    )
    expect(result[0].original).toBe('星に願いを')
    expect(result[0].translation).toBe('Star in the sky')
  })
})
