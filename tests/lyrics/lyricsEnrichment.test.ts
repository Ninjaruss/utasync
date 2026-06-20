import { describe, it, expect } from 'vitest'
import { linesNeedEnrichment, linesNeedAlignment, enrichmentMadeProgress, LYRICS_ENRICHMENT_VERSION } from '../../src/lyrics/lyricsEnrichment'
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

  it('returns true when alignment indices are stale or out of display range', () => {
    const lines: TimedLine[] = [{
      startTime: 0,
      endTime: 1,
      original: 'You always make me so happy 青空に溶けて',
      translation: 'You always make me so happy\nMelt into the blue sky',
      tokens: [{
        surface: '青空',
        pos: '名詞',
        startIndex: 28,
        endIndex: 30,
        alignmentIndices: [0],
      }],
    }]
    expect(linesNeedAlignment(lines)).toBe(true)
  })

  it('returns false for particle-only lines', () => {
    const lines: TimedLine[] = [{
      startTime: 0, endTime: 1, original: 'が', translation: 'subject marker',
      tokens: [{ surface: 'が', pos: '助詞', startIndex: 0, endIndex: 1 }],
    }]
    expect(linesNeedAlignment(lines)).toBe(false)
  })

  it('returns true for multi-line translations when alignment is missing', () => {
    const lines: TimedLine[] = [{
      startTime: 0, endTime: 1, original: '君', translation: 'you\nthere',
      tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1 }],
    }]
    expect(linesNeedAlignment(lines)).toBe(true)
  })
})

describe('enrichmentMadeProgress', () => {
  it('returns true when alignment indices are added', () => {
    const before: TimedLine[] = [{
      startTime: 0, endTime: 1, original: '君', translation: 'you',
      tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1 }],
    }]
    const after: TimedLine[] = [{
      ...before[0],
      tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }],
    }]
    expect(enrichmentMadeProgress(before, after)).toBe(true)
  })

  it('returns false when alignment still missing after a no-op pass', () => {
    const lines: TimedLine[] = [{
      startTime: 0, endTime: 1, original: '君', translation: 'you',
      tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1 }],
    }]
    expect(enrichmentMadeProgress(lines, lines)).toBe(false)
  })
})
