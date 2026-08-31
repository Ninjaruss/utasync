import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shouldRefitTranslation } from '../../src/lyrics/translationRefit'
import type { TimedLine, LyricsData } from '../../src/core/types'
import type { SmartAttachResult } from '../../src/lyrics/lineAligner'

const L = (original: string): TimedLine => ({ startTime: 0, endTime: 1, original, translation: '' })

describe('shouldRefitTranslation', () => {
  it('is false when the originals are unchanged', () => {
    expect(shouldRefitTranslation([L('a'), L('b')], [L('a'), L('b')])).toBe(false)
  })

  it('is true when the line count changed', () => {
    expect(shouldRefitTranslation([L('a'), L('b')], [L('a'), L('b'), L('c')])).toBe(true)
  })

  it('is true when a line text changed', () => {
    expect(shouldRefitTranslation([L('a'), L('b')], [L('a'), L('B!')])).toBe(true)
  })

  it('ignores pure timing changes', () => {
    const before = [{ startTime: 0, endTime: 1, original: 'a', translation: '' }]
    const after = [{ startTime: 5, endTime: 9, original: 'a', translation: '' }]
    expect(shouldRefitTranslation(before, after)).toBe(false)
  })

  it('is false for two empty line lists', () => {
    expect(shouldRefitTranslation([], [])).toBe(false)
  })
})

// CRITICAL 2 + IMPORTANT 3 regression: the automatic re-fit must never apply a
// failed fit, and must never overwrite a hand-edited pairing.
vi.mock('../../src/lyrics/lineAligner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lyrics/lineAligner')>()
  return { ...actual, smartAttachSecondLanguage: vi.fn() }
})

describe('refitStaleTranslation', () => {
  const meta = { title: 'T', artist: 'A' }
  const primary = (translation: string): TimedLine[] => [
    { startTime: 0, endTime: 1, original: 'a', translation },
    { startTime: 1, endTime: 2, original: 'b', translation },
  ]
  const baseLyrics = (patch: Partial<LyricsData> = {}): LyricsData => ({
    lines: primary('old'),
    sourceLanguage: 'ja',
    translationLanguage: 'en',
    alignmentMode: 'auto',
    translationSource: 'pasted translation',
    ...patch,
  })

  let smartAttachSecondLanguage: ReturnType<typeof vi.fn>
  let refitStaleTranslation: typeof import('../../src/lyrics/translationRefit')['refitStaleTranslation']

  beforeEach(async () => {
    const lineAligner = await import('../../src/lyrics/lineAligner')
    smartAttachSecondLanguage = lineAligner.smartAttachSecondLanguage as unknown as ReturnType<typeof vi.fn>
    smartAttachSecondLanguage.mockReset()
    ;({ refitStaleTranslation } = await import('../../src/lyrics/translationRefit'))
  })

  it('does nothing when the primary text is unchanged (nothing to re-fit)', async () => {
    const lyrics = baseLyrics({ lines: primary('old') })
    const result = await refitStaleTranslation(primary('old'), lyrics, meta)
    expect(result).toBe(lyrics)
    expect(smartAttachSecondLanguage).not.toHaveBeenCalled()
  })

  it('does nothing when the pairing was hand-edited, without even attempting a re-fit', async () => {
    const prev = primary('old').map((l) => ({ ...l, original: 'changed' }))
    const lyrics = baseLyrics({
      translationPairing: { method: 'index', meanConfidence: 1, flaggedLineCount: 0, version: 1, userEdited: true },
    })
    const result = await refitStaleTranslation(prev, lyrics, meta)
    expect(result).toBe(lyrics)
    expect(smartAttachSecondLanguage).not.toHaveBeenCalled()
  })

  it('refuses a re-fit whose result is method:"mismatch" — must leave lyrics untouched', async () => {
    // The exact failure the finding calls out: an embedder timeout returns
    // blind positional pairing under mismatchedBlocks/method 'mismatch'.
    const failedResult: SmartAttachResult = {
      lines: primary('BLIND POSITIONAL GUESS'),
      mismatchedBlocks: [0],
      method: 'mismatch',
    }
    smartAttachSecondLanguage.mockResolvedValue(failedResult)
    const prev = primary('old').map((l) => ({ ...l, original: 'changed' }))
    const lyrics = baseLyrics()
    const result = await refitStaleTranslation(prev, lyrics, meta)
    expect(result).toBe(lyrics)
    expect(result.lines[0].translation).toBe('old')
  })

  it('refuses a re-fit whose mean confidence is below the wrong-song floor', async () => {
    const lowConfResult: SmartAttachResult = {
      lines: primary('low confidence guess'),
      mismatchedBlocks: [],
      method: 'semantic',
      confidence: [0.1, 0.1],
    }
    smartAttachSecondLanguage.mockResolvedValue(lowConfResult)
    const prev = primary('old').map((l) => ({ ...l, original: 'changed' }))
    const lyrics = baseLyrics()
    const result = await refitStaleTranslation(prev, lyrics, meta)
    expect(result).toBe(lyrics)
  })

  it('applies a successful re-fit', async () => {
    const goodResult: SmartAttachResult = {
      lines: primary('a good translation'),
      mismatchedBlocks: [],
      method: 'semantic',
      confidence: [0.9, 0.9],
    }
    smartAttachSecondLanguage.mockResolvedValue(goodResult)
    const prev = primary('old').map((l) => ({ ...l, original: 'changed' }))
    const lyrics = baseLyrics()
    const result = await refitStaleTranslation(prev, lyrics, meta)
    expect(result).not.toBe(lyrics)
    expect(result.lines[0].translation).toBe('a good translation')
  })
})
