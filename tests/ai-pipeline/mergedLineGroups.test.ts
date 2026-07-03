import { describe, it, expect } from 'vitest'
import { findMergedLineGroups } from '../../src/ai-pipeline/alignTimestampMode'
import type { TimedLine } from '../../src/core/types'

describe('findMergedLineGroups', () => {
  it('groups consecutive lines that start inside one long transcript chunk', () => {
    const lines: TimedLine[] = [
      { original: 'a', translation: '', startTime: 10, endTime: 12 },
      { original: 'b', translation: '', startTime: 12, endTime: 18 },
      { original: 'c', translation: '', startTime: 18, endTime: 22 },
      { original: 'd', translation: '', startTime: 30, endTime: 32 },
    ]
    const words = [
      { word: 'ab', startTime: 10, endTime: 12 },
      { word: 'bc merged phrase', startTime: 12, endTime: 24 },
      { word: 'd', startTime: 30, endTime: 32 },
    ]
    const groups = findMergedLineGroups(lines, words)
    expect(groups).toEqual([[1, 2]])
  })

  it('groups a tail-straddling chunk (prev line closing syllables + next line share it)', () => {
    // Chunk 5–8 holds the end of line 0 (…んだ) and the whole of line 1 (rolling);
    // only line 1 STARTS inside, but both overlap, so both must be grouped.
    const lines: TimedLine[] = [
      { original: '何を間違った それさえもわからないんだ', translation: '', startTime: 1, endTime: 6 },
      { original: 'ローリング ローリング', translation: '', startTime: 6, endTime: 8 },
      { original: '次の行', translation: '', startTime: 12, endTime: 14 },
    ]
    const words = [
      { word: '何を間違ったそれさえも', startTime: 1, endTime: 5 },
      { word: 'わからないんだロリーロリー', startTime: 5, endTime: 8 },
      { word: '次の行', startTime: 12, endTime: 14 },
    ]
    expect(findMergedLineGroups(lines, words)).toEqual([[0, 1]])
  })

  it('does not group lines that merely touch a chunk edge', () => {
    const lines: TimedLine[] = [
      { original: 'a', translation: '', startTime: 1, endTime: 5 },
      { original: 'b', translation: '', startTime: 5, endTime: 9 },
    ]
    // Each line sits in its own chunk; neither overlaps the other's chunk.
    const words = [
      { word: 'aaaa', startTime: 1, endTime: 5 },
      { word: 'bbbb', startTime: 5, endTime: 9 },
    ]
    expect(findMergedLineGroups(lines, words)).toEqual([])
  })
})
