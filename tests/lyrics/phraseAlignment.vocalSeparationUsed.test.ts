import { describe, it, expect } from 'vitest'
import { applyRefinedAlignment } from '../../src/lyrics/phraseAlignment'
import type { LyricsData } from '../../src/core/types'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'

const baseLyrics = (patch: Partial<LyricsData>): LyricsData => ({
  lines: [], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'auto', ...patch,
})
const refined = (): RefinedAlignment => ({
  lines: [], phrases: [], phraseLayout: 'sheet', anchorSources: [], lineAlignmentQuality: [], confidence: 1,
} as RefinedAlignment)

describe('applyRefinedAlignment preserves vocalSeparationUsed', () => {
  it('carries a true flag through from the input lyrics', () => {
    expect(applyRefinedAlignment(baseLyrics({ vocalSeparationUsed: true }), refined()).vocalSeparationUsed).toBe(true)
  })
  it('carries a false flag through', () => {
    expect(applyRefinedAlignment(baseLyrics({ vocalSeparationUsed: false }), refined()).vocalSeparationUsed).toBe(false)
  })
  it('leaves it undefined when the input has none (legacy songs)', () => {
    expect(applyRefinedAlignment(baseLyrics({}), refined()).vocalSeparationUsed).toBeUndefined()
  })
})
