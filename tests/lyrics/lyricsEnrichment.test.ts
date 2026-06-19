import { describe, it, expect } from 'vitest'
import { linesNeedEnrichment, linesNeedAlignment, LYRICS_ENRICHMENT_VERSION } from '../../src/lyrics/lyricsEnrichment'
import type { TimedLine } from '../../src/core/types'

describe('linesNeedEnrichment', () => {
  it('returns true when any non-empty line lacks tokens', () => {
    const lines: TimedLine[] = [{ startTime: 0, endTime: 1, original: '君', translation: 'you' }]
    expect(linesNeedEnrichment(lines)).toBe(true)
  })

  it('returns false when tokens exist and enrichment version matches', () => {
    const lines: TimedLine[] = [{
      startTime: 0, endTime: 1, original: '君', translation: 'you',
      tokens: [{ surface: '君', startIndex: 0, endIndex: 1, alignmentIndices: [0] }],
    }]
    expect(linesNeedEnrichment(lines, LYRICS_ENRICHMENT_VERSION)).toBe(false)
  })
})

describe('linesNeedAlignment', () => {
  it('returns true when tokens exist but no alignable token has alignmentIndices', () => {
    const lines: TimedLine[] = [{
      startTime: 0, endTime: 1, original: '君', translation: 'you',
      tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1 }],
    }]
    expect(linesNeedAlignment(lines)).toBe(true)
  })

  it('returns false when at least one alignable token is aligned', () => {
    const lines: TimedLine[] = [{
      startTime: 0, endTime: 1, original: '君', translation: 'you',
      tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }],
    }]
    expect(linesNeedAlignment(lines)).toBe(false)
  })

  it('returns false for particle-only lines', () => {
    const lines: TimedLine[] = [{
      startTime: 0, endTime: 1, original: 'が', translation: 'subject marker',
      tokens: [{ surface: 'が', pos: '助詞', startIndex: 0, endIndex: 1 }],
    }]
    expect(linesNeedAlignment(lines)).toBe(false)
  })

  it('returns false for multi-line translations', () => {
    const lines: TimedLine[] = [{
      startTime: 0, endTime: 1, original: '君', translation: 'you\nthere',
      tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1 }],
    }]
    expect(linesNeedAlignment(lines)).toBe(false)
  })
})
