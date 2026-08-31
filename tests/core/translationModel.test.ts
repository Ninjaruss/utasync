import { describe, it, expect } from 'vitest'
import type { TimedLine, LyricsData } from '../../src/core/types'

/**
 * These fields are declarations, so `npx tsc -b` — not this file — is what proves they exist:
 * Vitest transpiles without type-checking, and this suite passes with or without them.
 * What IS worth pinning here is the data contract the fitter must uphold, which the type
 * system cannot express: rows sharing a translationGroup carry the SAME translation string.
 */
describe('translation model fields', () => {
  it('a line without the new fields is unchanged', () => {
    const line: TimedLine = { startTime: 0, endTime: 1, original: 'a', translation: 'b' }
    expect(line.translationGroup).toBeUndefined()
    expect(line.translationConfidence).toBeUndefined()
  })

  it('rows in a group carry the same translation string', () => {
    // The contract every group producer must satisfy. Rows in a group each keep the
    // full translation so line.translation stays the single source of truth for
    // consumers that know nothing about groups; a consumer ignoring translationGroup
    // then repeats the text rather than blanking a row.
    const lines: TimedLine[] = [
      { startTime: 0, endTime: 1, original: 'a', translation: 'shared', translationGroup: 1, translationConfidence: 0.9 },
      { startTime: 1, endTime: 2, original: 'b', translation: 'shared', translationGroup: 1, translationConfidence: 0.4 },
      { startTime: 2, endTime: 3, original: 'c', translation: 'solo' },
    ]
    const grouped = lines.filter((l) => l.translationGroup === 1)
    expect(grouped).toHaveLength(2)
    expect(new Set(grouped.map((l) => l.translation)).size).toBe(1)
    expect(lines[2].translationGroup).toBeUndefined()
  })

  it('carries pairing provenance on the lyrics data', () => {
    const data: LyricsData = {
      lines: [{ startTime: 0, endTime: 1, original: 'a', translation: 'x' }],
      sourceLanguage: 'ja',
      translationLanguage: 'en',
      alignmentMode: 'manual',
      translationSource: 'x',
      unplacedTranslations: [{ text: 'orphan', afterLineIndex: 0 }],
      translationPairing: { method: 'semantic', meanConfidence: 0.65, flaggedLineCount: 1, version: 1 },
    }
    const clone = structuredClone(data)
    expect(clone.unplacedTranslations?.[0]).toEqual({ text: 'orphan', afterLineIndex: 0 })
    expect(clone.translationPairing?.version).toBe(1)
  })
})
