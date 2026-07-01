import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { refineAlignmentWithPhrases, realignSection } from '../../src/lyrics/phraseAlignment'
import type { LineAlignmentQuality, TimedLine } from '../../src/core/types'

const here = dirname(fileURLToPath(import.meta.url))
const SEGMENT_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_segment.json')
const LYRICS = join(here, '../ai-pipeline/fixtures/akfg-user-ja.txt')

describe.skipIf(!existsSync(SEGMENT_CACHE))('realignSection merged-segment split', () => {
  const lineTexts = readFileSync(LYRICS, 'utf8').trim().split('\n')
  const words = sanitizeTranscript(
    JSON.parse(readFileSync(SEGMENT_CACHE, 'utf8')).chunks.flatMap(
      (c: { text?: string; timestamp?: number[] }) => {
        const [start, end] = c.timestamp ?? []
        const word = c.text?.trim()
        if (!word || !Number.isFinite(start)) return []
        return [{ word, startTime: start, endTime: end }]
      },
    ),
  )

  it('keeps full corner-line tail when re-syncing between good anchors', () => {
    const sheetRows: TimedLine[] = lineTexts.map((original) => ({
      original,
      translation: '',
      startTime: 0,
      endTime: 0,
    }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const cornerIdx = lineTexts.findIndex((t) => t.includes('角を曲が'))
    const goneIdx = lineTexts.findIndex((t) => t.includes('此処から'))
    expect(cornerIdx).toBeGreaterThan(0)
    expect(goneIdx).toBe(cornerIdx + 1)

    const baselineSpan = refined.lines[cornerIdx].endTime - refined.lines[cornerIdx].startTime
    expect(baselineSpan).toBeGreaterThan(6)

    const qualities: LineAlignmentQuality[] = [...(refined.lineAlignmentQuality ?? [])]
    qualities[cornerIdx] = 'needs_review'
    const realigned = realignSection(
      refined.lines,
      cornerIdx,
      words,
      qualities,
      'ja',
      refined.anchorSources,
    )

    const corner = realigned.lines[cornerIdx]
    const gone = realigned.lines[goneIdx]
    const span = corner.endTime - corner.startTime
    expect(span).toBeGreaterThan(6)
    expect(span).toBeGreaterThanOrEqual(baselineSpan - 0.5)
    expect(corner.endTime).toBeGreaterThanOrEqual(gone.startTime - 0.25)
    expect(gone.startTime).toBe(refined.lines[goneIdx].startTime)
    expect(gone.endTime).toBe(refined.lines[goneIdx].endTime)
  })
})

describe('realignSection stable-output (synthetic)', () => {
  it('returns timing within 0.3 s when both lines are approximate and already proportionally split', () => {
    // Simulates the 角を曲がって + 此処からは case: both lines approximate (no good anchor
    // between them), already split correctly by the refine pass at ~proportional boundary.
    // The PlayerView no-improvement guard relies on realignSection returning near-identical
    // timing in this case so it can bail out without corrupting the refine pass result.
    const lines: TimedLine[] = [
      { original: 'anchor', translation: '', startTime: 5, endTime: 12 },
      { original: 'とおくのかどをまがって', translation: '', startTime: 12, endTime: 19 }, // 7 s span
      { original: 'ここからはみえなくなった', translation: '', startTime: 19, endTime: 24 }, // already split
      { original: 'anchor2', translation: '', startTime: 25, endTime: 28 },
    ]
    const words = sanitizeTranscript([
      { word: 'とおくのかどをまがって', startTime: 12, endTime: 19 },
      { word: 'ここからはみえなくなった', startTime: 19, endTime: 24 },
    ])
    const qualities: LineAlignmentQuality[] = ['good', 'approximate', 'approximate', 'good']
    const out = realignSection(lines, 1, words, qualities, 'ja')
    expect(Math.abs(out.lines[1].startTime - 12)).toBeLessThan(0.3)
    expect(Math.abs(out.lines[1].endTime - 19)).toBeLessThan(0.3)
  })
})

describe('realignSection neighbor context (synthetic)', () => {
  it('includes the next anchor row for orphan-gap split without moving it', () => {
    const lines: TimedLine[] = [
      { original: 'anchor one', translation: '', startTime: 10, endTime: 12 },
      { original: 'とおくのかどをまがって', translation: '', startTime: 12, endTime: 14 },
      { original: 'ここからみえない', translation: '', startTime: 19, endTime: 24 },
    ]
    const words = sanitizeTranscript([
      { word: 'とおくのかどをまげてここからみえない', startTime: 12, endTime: 24 },
    ])
    const qualities: LineAlignmentQuality[] = ['good', 'needs_review', 'good']
    const out = realignSection(lines, 1, words, qualities, 'ja')
    expect(out.lines[2].startTime).toBe(19)
    expect(out.lines[2].endTime).toBe(24)
    const span = out.lines[1].endTime - out.lines[1].startTime
    expect(span).toBeGreaterThan(5)
    expect(span).toBeGreaterThan(lines[1].endTime - lines[1].startTime + 3)
    expect(out.lines[1].endTime).toBeGreaterThan(17)
  })
})
