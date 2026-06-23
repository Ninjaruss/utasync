import { describe, it, expect, vi } from 'vitest'
import { importNeedsTranslationAttach, normalizeImportedLines } from '../../src/sources/importNormalize'
import type { TimedLine } from '../../src/core/types'

vi.mock('../../src/sources/secondLanguageResolver', () => ({
  findSecondLanguageLyrics: vi.fn(async () => ({ lrc: 'translated line' })),
}))

vi.mock('../../src/lyrics/lineAligner', () => ({
  smartAttachSecondLanguage: vi.fn(async (lines: TimedLine[]) => ({
    lines: lines.map((l, i) => ({ ...l, translation: i === 0 ? 'hello' : '' })),
    mismatchedBlocks: [],
  })),
}))

describe('importNeedsTranslationAttach', () => {
  it('returns false when any line already has a translation', () => {
    const lines: TimedLine[] = [
      { startTime: 0, endTime: 0, original: '君', translation: 'you' },
      { startTime: 0, endTime: 0, original: 'だけ', translation: '' },
    ]
    expect(importNeedsTranslationAttach(lines)).toBe(false)
  })

  it('returns true when no translations are present', () => {
    const lines: TimedLine[] = [
      { startTime: 0, endTime: 0, original: '君', translation: '' },
    ]
    expect(importNeedsTranslationAttach(lines)).toBe(true)
  })
})

describe('normalizeImportedLines', () => {
  it('skips LRCLIB lookup when translations already exist', async () => {
    const { findSecondLanguageLyrics } = await import('../../src/sources/secondLanguageResolver')
    const lines: TimedLine[] = [
      { startTime: 1, endTime: 3, original: 'hello', translation: 'hola' },
    ]
    const result = await normalizeImportedLines('Song', 'Artist', lines)
    expect(result).toEqual(lines)
    expect(findSecondLanguageLyrics).not.toHaveBeenCalled()
  })
})
