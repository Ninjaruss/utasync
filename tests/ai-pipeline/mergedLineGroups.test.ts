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
})
