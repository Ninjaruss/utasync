import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alignLyrics, sanitizeTranscript } from '../../src/ai-pipeline/aligner'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

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
    // 赤い…乗せて is a long, slowly-sung line (262.5–275 s); it should fill its
    // transcript chunk without bleeding across the following 遠く line.
    expect(red?.endTime! - red!.startTime).toBeLessThan(13.5)
    expect(red?.endTime! - red!.startTime).toBeGreaterThan(9)
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
    expect(finalRun.startTime).toBeLessThanOrEqual(314)
    expect(finalRun.endTime).toBeGreaterThan(322)
    expect(finalRun.endTime - finalRun.startTime).toBeGreaterThan(2.5)
  })

  // YouTube ground-truth: timestamps from the official video captions (seconds).
  // Tolerance is ±2 s unless noted — Whisper's segment transcript introduces up to
  // ~1 s of drift and phrase-boundary estimation adds another ~1 s.
  it('refine aligns verse lines within 2 s of YouTube captions', () => {
    const sheetRows = lineTexts.map((original) => ({
      original,
      translation: '',
      startTime: 0,
      endTime: 0,
    }))
    const { lines } = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const gt: Array<{ text: string; ytStart: number; tol?: number }> = [
      { text: '出来れば世界を', ytStart: 98 },
      { text: '戦争をなくすような', ytStart: 104 },
      { text: 'だけどちょっと', ytStart: 111 },
      { text: '俳優や映画スターには', ytStart: 118 },
      { text: 'それどころか', ytStart: 122 },
      { text: 'そんな僕に術はないよな', ytStart: 131 },
      { text: '何を間違った', ytStart: 141 },
      { text: '初めから持ってないのに胸が痛んだ', ytStart: 148 },
      { text: '僕らはきっとこの先も', ytStart: 154 },
      { text: '凍てつく地面を', ytStart: 161, tol: 2 },
      { text: '理由もないのに', ytStart: 177 },
      { text: '泣けやしないから', ytStart: 183 },
      { text: 'そんな夜を', ytStart: 190 },
      { text: '岩は転がって', ytStart: 203 },
      { text: '固い地面を分けて', ytStart: 210 },
      { text: 'あの丘を越えた', ytStart: 217 },
      { text: '君の孤独も', ytStart: 223, tol: 3 },
    ]
    for (const { text, ytStart, tol = 2 } of gt) {
      const line = lines.find((l) => l.original.includes(text))
      expect(line, `no line for "${text}"`).toBeDefined()
      expect(line!.startTime, `"${text}" should start within ${tol}s of YT ${ytStart}s`).toBeGreaterThan(ytStart - tol)
      expect(line!.startTime, `"${text}" should start within ${tol}s of YT ${ytStart}s`).toBeLessThan(ytStart + tol)
    }
  })

  it('refine aligns second-verse / second-chorus lines within 2 s of YouTube captions', () => {
    const sheetRows = lineTexts.map((original) => ({
      original,
      translation: '',
      startTime: 0,
      endTime: 0,
    }))
    const { lines } = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    // For repeated lines (初めから, 僕らは) use the second occurrence (after 250 s)
    const gt: Array<{ text: string; ytStart: number; tol?: number; afterS?: number }> = [
      { text: '赤い 赤い小さな車は', ytStart: 262 },
      { text: '遠く向こうの角を', ytStart: 275 },
      { text: '此処からは見えなくなった', ytStart: 282 },
      { text: '何をなくした', ytStart: 292 },
      { text: '初めから持ってないのに胸が痛んだ', ytStart: 299, afterS: 250 },
      { text: '僕らはきっとこの先も', ytStart: 306, afterS: 250 },
      { text: '凍てつく世界を転がるように走り出した', ytStart: 312, tol: 2 },
    ]
    for (const { text, ytStart, tol = 2, afterS } of gt) {
      const line = afterS
        ? lines.find((l) => l.original.includes(text) && l.startTime > afterS)
        : lines.find((l) => l.original.includes(text))
      expect(line, `no line for "${text}"`).toBeDefined()
      expect(line!.startTime, `"${text}" should start within ${tol}s of YT ${ytStart}s`).toBeGreaterThan(ytStart - tol)
      expect(line!.startTime, `"${text}" should start within ${tol}s of YT ${ytStart}s`).toBeLessThan(ytStart + tol)
    }
  })

  it('refine places 心絡まって correctly between 僕らは and 凍てつく世界を', () => {
    const sheetRows = lineTexts.map((original) => ({
      original,
      translation: '',
      startTime: 0,
      endTime: 0,
    }))
    const { lines } = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const surelyIdx = lineTexts.findIndex((t) => t.includes('僕らはきっとこの先も') && lineTexts.indexOf(t) > 20)
    // second chorus only: after 300 s
    const surelyLine = lines.slice(20).find((l) => l.original.includes('僕らはきっとこの先も') && l.startTime > 300)
    const entwinedLine = lines.find((l) => l.original.includes('心絡まって') && l.startTime > 300)
    const finalRunLine = lines.find((l) => l.original.includes('凍てつく世界') && l.startTime > 300)
    expect(surelyLine, 'second 僕らは').toBeDefined()
    expect(entwinedLine, '心絡まって').toBeDefined()
    expect(finalRunLine, '凍てつく世界').toBeDefined()
    // 心絡まって sits between 僕らは and 凍てつく世界
    expect(entwinedLine!.startTime).toBeGreaterThan(surelyLine!.startTime)
    expect(entwinedLine!.startTime).toBeLessThan(finalRunLine!.startTime)
    // spans at least 1.5 s
    expect(entwinedLine!.endTime - entwinedLine!.startTime).toBeGreaterThan(1.5)
    // within 3 s of the window anchors
    expect(entwinedLine!.startTime).toBeGreaterThan(305)
    expect(entwinedLine!.endTime).toBeLessThan(314)
  })
})
