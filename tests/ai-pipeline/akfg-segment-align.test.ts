import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alignLyrics, sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { refineAlignmentWithPhrases, realignSection } from '../../src/lyrics/phraseAlignment'

const here = dirname(fileURLToPath(import.meta.url))
const SEGMENT_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_segment.json')
const LYRICS = join(here, 'fixtures/akfg-user-ja.txt')

describe.skipIf(!existsSync(SEGMENT_CACHE))('AKFG First Take segment transcript', () => {
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

  it('keeps 赤い car lines anchored after the bridge', () => {
    const { lines, anchorSources } = alignLyrics(lineTexts, words, undefined, 'ja')
    const red = lines.find((l) => l.original.includes('赤い 赤い'))
    const corner = lines.find((l) => l.original.includes('角を曲が'))
    expect(red?.startTime).toBeGreaterThan(255)
    expect(red?.startTime).toBeLessThan(270)
    expect(red?.endTime! - red!.startTime).toBeLessThan(12)
    expect(corner?.startTime).toBeGreaterThan(red!.startTime)
    const redIdx = lineTexts.findIndex((t) => t.includes('赤い 赤い'))
    expect(anchorSources?.[redIdx]).toBe('lcs')
  })

  it('anchors あの丘 line at the sung phrase onset', () => {
    const { lines } = alignLyrics(lineTexts, words, undefined, 'ja')
    const hill = lines.find((l) => l.original.includes('あの丘'))
    expect(hill?.startTime).toBeGreaterThan(215)
    expect(hill?.startTime).toBeLessThan(218)
    expect(hill?.endTime! - hill!.startTime).toBeLessThan(6)
  })

  it('covers the full bridge line through 朝だ despite Whisper mishearing', () => {
    const { lines, anchorSources } = alignLyrics(lineTexts, words, undefined, 'ja')
    const bridgeIdx = lineTexts.findIndex((t) => t.includes('君の孤独も全て暴き出す朝だ'))
    const redIdx = lineTexts.findIndex((t) => t.includes('赤い 赤い'))
    const bridge = lines[bridgeIdx]
    const red = lines[redIdx]
    expect(anchorSources?.[bridgeIdx]).toBe('lcs')
    expect(bridge.endTime).toBeGreaterThan(228)
    expect(bridge.endTime).toBeLessThan(235)
    expect(red.startTime).toBeGreaterThan(255)
    expect(red.startTime).toBeLessThan(270)
    expect(red.startTime).toBeGreaterThan(bridge.endTime + 20)
  })

  it('refine keeps pasted sheet layout with all 30 rows', () => {
    const sheetRows = lineTexts.map((original) => ({
      original,
      translation: '',
      startTime: 0,
      endTime: 0,
    }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    expect(refined.phraseLayout).toBe('sheet')
    expect(refined.lines).toHaveLength(30)
    expect(refined.lineAlignmentQuality).toHaveLength(30)
  })

  it('refine keeps red-car block monotonic with full corner tail', () => {
    const sheetRows = lineTexts.map((original) => ({
      original,
      translation: '',
      startTime: 0,
      endTime: 0,
    }))
    const { lines } = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const redIdx = lineTexts.findIndex((t) => t.includes('赤い 赤い'))
    const cornerIdx = lineTexts.findIndex((t) => t.includes('角を曲が'))
    const goneIdx = lineTexts.findIndex((t) => t.includes('此処から'))
    const red = lines[redIdx]
    const corner = lines[cornerIdx]
    const gone = lines[goneIdx]
    expect(red.startTime).toBeGreaterThan(255)
    expect(red.startTime).toBeLessThan(270)
    expect(corner.startTime).toBeGreaterThan(red.startTime)
    expect(corner.endTime).toBeGreaterThan(279.5)
    expect(gone.startTime).toBeGreaterThanOrEqual(corner.endTime - 0.25)
    expect(gone.startTime).toBeGreaterThan(280)
  })

  it('re-sync keeps second-chorus clause + rolling pair split', () => {
    const sheetRows = lineTexts.map((original) => ({
      original,
      translation: '',
      startTime: 0,
      endTime: 0,
    }))
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const clauseIdx = lineTexts.findIndex((t) => t.includes('何をなくした'))
    const rollingIdx = clauseIdx + 1
    const resynced = realignSection(
      refined.lines,
      rollingIdx,
      words,
      refined.lineAlignmentQuality!,
      'ja',
      refined.anchorSources,
    )
    const clause = resynced.lines[clauseIdx]
    const rolling = resynced.lines[rollingIdx]
    expect(clause.endTime - clause.startTime).toBeGreaterThan(3.5)
    expect(rolling.endTime - rolling.startTime).toBeGreaterThan(1.8)
    expect(rolling.startTime).toBeGreaterThan(clause.endTime - 0.15)
    expect(rolling.endTime).toBeLessThanOrEqual(resynced.lines[rollingIdx + 1].startTime + 0.05)
  })

  it('refine splits second-chorus pair like the first (わからないんだ + rolling)', () => {
    const sheetRows = lineTexts.map((original) => ({
      original,
      translation: '',
      startTime: 0,
      endTime: 0,
    }))
    const { lines } = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const firstClauseIdx = lineTexts.findIndex((t) => t.includes('何を間違った'))
    const secondClauseIdx = lineTexts.findIndex((t) => t.includes('何をなくした'))
    const firstRollingIdx = firstClauseIdx + 1
    const secondRollingIdx = secondClauseIdx + 1

    const refClause = lines[firstClauseIdx]
    const refRolling = lines[firstRollingIdx]
    const clause = lines[secondClauseIdx]
    const rolling = lines[secondRollingIdx]

    const refClauseSpan = refClause.endTime - refClause.startTime
    const refRollingSpan = refRolling.endTime - refRolling.startTime
    const clauseSpan = clause.endTime - clause.startTime
    const rollingSpan = rolling.endTime - rolling.startTime

    expect(clauseSpan).toBeGreaterThan(refClauseSpan * 0.85)
    expect(rollingSpan).toBeGreaterThan(refRollingSpan * 0.85)
    expect(clause.endTime).toBeGreaterThan(296.5)
    expect(rolling.startTime).toBeGreaterThan(296.5)
    expect(rolling.startTime).toBeLessThan(297.5)
    expect(rolling.endTime - rolling.startTime).toBeGreaterThan(1.8)
  })

  it('refine splits final chorus run from rolling line and spans 走り出した', () => {
    const sheetRows = lineTexts.map((original) => ({
      original,
      translation: '',
      startTime: 0,
      endTime: 0,
    }))
    const { lines } = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const finalIdx = lineTexts.findIndex((t) => t.includes('凍てつく世界'))
    const entwinedIdx = finalIdx - 1
    const entwined = lines[entwinedIdx]
    const finalRun = lines[finalIdx]
    expect(finalRun.startTime).toBeLessThanOrEqual(entwined.endTime + 0.15)
    expect(finalRun.startTime).toBeLessThanOrEqual(312.5)
    expect(finalRun.endTime).toBeGreaterThan(322)
    expect(finalRun.endTime - finalRun.startTime).toBeGreaterThan(2.5)
  })
})
