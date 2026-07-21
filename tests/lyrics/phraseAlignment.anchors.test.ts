import { it, expect } from 'vitest'
import type { LyricsData, TimedLine } from '../../src/core/types'
import { applyRefinedAlignment, type RefinedAlignment } from '../../src/lyrics/phraseAlignment'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original, translation: '', startTime, endTime,
})

it('re-fits fresh alignment around a surviving user anchor (sticky)', () => {
  const lyrics = {
    lines: [line('a', 0, 1), line('b', 1, 2), line('c', 2, 3)],
    sourceLanguage: 'en',
    translationLanguage: 'en',
    alignmentMode: 'auto',
    timingAnchors: [{ lineIndex: 1, time: 30, source: 'user' as const }],
  } as unknown as LyricsData
  const refined = {
    lines: [line('a', 10, 11), line('b', 11, 12), line('c', 12, 13)],
    phrases: [],
    report: { merged: 0, split: 0, dropped: 0 },
    mode: 'content',
    confidence: 0.9,
    anchorSources: ['lcs', 'lcs', 'lcs'],
    lineAlignmentQuality: ['good', 'good', 'good'],
    phraseLayout: 'sheet',
    sheetLinesSnapshot: undefined,
  } as unknown as RefinedAlignment
  const next = applyRefinedAlignment(lyrics, refined)
  expect(next.lines[1].startTime).toBe(30)
  expect(next.timingAnchors?.some((a) => a.lineIndex === 1 && a.time === 30 && a.source === 'user')).toBe(true)
})

it('leaves lines untouched when there are no user anchors', () => {
  const lyrics = {
    lines: [line('a', 0, 1)],
    sourceLanguage: 'en',
    translationLanguage: 'en',
    alignmentMode: 'auto',
  } as unknown as LyricsData
  const refined = {
    lines: [line('a', 10, 11)],
    phrases: [],
    report: { merged: 0, split: 0, dropped: 0 },
    mode: 'content',
    confidence: 0.9,
    anchorSources: ['lcs'],
    lineAlignmentQuality: ['good'],
    phraseLayout: 'sheet',
    sheetLinesSnapshot: undefined,
  } as unknown as RefinedAlignment
  const next = applyRefinedAlignment(lyrics, refined)
  expect(next.lines[0].startTime).toBe(10)
  expect(next.timingAnchors).toBeUndefined()
})
