import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import type { TimedLine, LyricsData } from '../../src/core/types'

describe('translation model fields', () => {
  it('a line without the new fields is unchanged', () => {
    const line: TimedLine = { startTime: 0, endTime: 1, original: 'a', translation: 'b' }
    expect(line.translationGroup).toBeUndefined()
    expect(line.translationConfidence).toBeUndefined()
  })

  it('round-trips groups and confidence through structured clone', async () => {
    const lines: TimedLine[] = [
      { startTime: 0, endTime: 1, original: 'a', translation: 'x', translationGroup: 1, translationConfidence: 0.9 },
      { startTime: 1, endTime: 2, original: 'b', translation: 'x', translationGroup: 1, translationConfidence: 0.4 },
    ]
    const data: LyricsData = {
      lines,
      sourceLanguage: 'ja',
      translationLanguage: 'en',
      alignmentMode: 'manual',
      translationSource: 'x',
      unplacedTranslations: [{ text: 'orphan', afterLineIndex: 1 }],
      translationPairing: { method: 'semantic', meanConfidence: 0.65, flaggedLineCount: 1, version: 1 },
    }
    const clone = structuredClone(data)
    expect(clone.lines[0].translationGroup).toBe(1)
    expect(clone.lines[1].translationGroup).toBe(1)
    expect(clone.unplacedTranslations?.[0]).toEqual({ text: 'orphan', afterLineIndex: 1 })
    expect(clone.translationPairing?.version).toBe(1)
    void Dexie
  })
})
