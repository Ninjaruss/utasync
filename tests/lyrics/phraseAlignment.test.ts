import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TimedLine } from '../../src/core/types'
import {
  alignPhrasesToTranscript,
  projectPhraseTimingToLines,
  refineAlignmentWithPhrases,
  sheetRowsForAlignment,
} from '../../src/lyrics/phraseAlignment'
import type { LyricsData } from '../../src/core/types'

const line = (
  original: string,
  startTime: number,
  endTime: number,
  translation = '',
): TimedLine => ({ original, translation, startTime, endTime })

const here = dirname(fileURLToPath(import.meta.url))
const SEGMENT_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_segment.json')
const LYRICS = join(here, '../ai-pipeline/fixtures/akfg-user-ja.txt')

describe('sheetRowsForAlignment', () => {
  it('prefers the sheet snapshot over sung display rows', () => {
    const sheet = [line('A', 1, 2)]
    const sung = [line('A part 1', 1, 1.5), line('A part 2', 1.5, 2)]
    const lyrics: LyricsData = {
      lines: sung,
      sheetLinesSnapshot: sheet,
      phraseLayout: 'sung',
      sourceLanguage: 'ja',
      translationLanguage: 'en',
      alignmentMode: 'auto',
    }
    expect(sheetRowsForAlignment(lyrics)).toEqual(sheet)
  })
})

describe('projectPhraseTimingToLines', () => {
  it('distributes a merged phrase across source rows by length', () => {
    const lines = [
      line('何を間違った それさえもわからないんだ', 10, 20),
      line('ローリング ローリング', 20, 22),
    ]
    const phrases = [
      {
        id: 'p-0-1',
        startTime: 100,
        endTime: 110,
        original: '何を間違った それさえもわからないんだ ローリング ローリング',
        translation: '',
        anchorSource: 'lcs' as const,
        sourceLineIndices: [0, 1],
      },
    ]
    const out = projectPhraseTimingToLines(lines, phrases, 'ja')
    expect(out[0].startTime).toBeCloseTo(100, 0)
    expect(out[1].endTime).toBeCloseTo(110, 0)
    expect(out[0].endTime).toBeLessThanOrEqual(out[1].startTime)
    expect(out[1].startTime).toBeGreaterThanOrEqual(out[0].startTime)
  })

  it('copies 1:1 phrase timing onto a single row', () => {
    const lines = [line('歩いて行こう', 0, 0)]
    const phrases = [
      {
        id: 'p-0',
        startTime: 5,
        endTime: 8,
        original: '歩いて行こう',
        translation: '',
        anchorSource: 'lcs' as const,
        sourceLineIndices: [0],
      },
    ]
    const out = projectPhraseTimingToLines(lines, phrases, 'ja')
    expect(out[0].startTime).toBe(5)
    expect(out[0].endTime).toBe(8)
  })
})

describe('alignPhrasesToTranscript', () => {
  it('re-anchors phrase text as one sung unit', () => {
    const phrases = [
      {
        id: 'p',
        startTime: 50,
        endTime: 55,
        original: 'ローリング ローリング',
        translation: '',
        anchorSource: 'interpolated' as const,
        sourceLineIndices: [0, 1],
      },
    ]
    const words = [
      { word: 'ローリング', startTime: 146, endTime: 146.8 },
      { word: 'ローリング', startTime: 146.8, endTime: 147.6 },
    ]
    const out = alignPhrasesToTranscript(phrases, words, 'ja')
    expect(out[0].startTime).toBeGreaterThan(140)
    expect(out[0].startTime).toBeLessThan(148)
  })

  it('does not bleed an earlier segment into 心絡まって when Whisper mishears the chorus', () => {
    const phrases = [
      {
        id: 'prev',
        startTime: 154,
        endTime: 157,
        original: '僕らはきっとこの先も',
        translation: '',
        anchorSource: 'lcs' as const,
        sourceLineIndices: [10],
      },
      {
        id: 'entwined1',
        startTime: 158,
        endTime: 159.7,
        original: '心絡まって ローリング ローリング',
        translation: '',
        anchorSource: 'lcs' as const,
        sourceLineIndices: [11],
      },
      {
        id: 'next',
        startTime: 159.7,
        endTime: 169,
        original: '凍てつく地面を転がるように走り出した',
        translation: '',
        anchorSource: 'lcs' as const,
        sourceLineIndices: [12],
      },
    ]
    const words = [
      { word: '初めから持ってないのに胸が痛んだ', startTime: 147, endTime: 154 },
      { word: '僕らはきっとこの先も', startTime: 154, endTime: 157 },
      { word: 'どころから待ってロリーロリー', startTime: 157, endTime: 160 },
      { word: '傷つく地面の体のように', startTime: 160, endTime: 164 },
    ]
    const out = alignPhrasesToTranscript(phrases, words, 'ja')
    const entwined = out.find((p) => p.id === 'entwined1')!
    expect(entwined.startTime).toBeGreaterThanOrEqual(157)
    expect(entwined.startTime).toBeLessThan(159)
    expect(entwined.endTime - entwined.startTime).toBeGreaterThan(2.5)
  })

  it('anchors repeated phrases to distinct later vocal occurrences', () => {
    const phrases = [
      {
        id: 'p0',
        startTime: 140,
        endTime: 150,
        original: 'ローリング ローリング',
        translation: '',
        anchorSource: 'lcs' as const,
        sourceLineIndices: [0],
      },
      {
        id: 'p1',
        startTime: 280,
        endTime: 290,
        original: 'ローリング ローリング',
        translation: '',
        anchorSource: 'lcs' as const,
        sourceLineIndices: [1],
      },
    ]
    const words = [
      { word: 'ロリーロリー', startTime: 146, endTime: 147 },
      { word: 'ローリング', startTime: 147, endTime: 148 },
      { word: 'ローリング', startTime: 148, endTime: 149 },
      { word: 'ローリング', startTime: 298, endTime: 299 },
      { word: 'ローリング', startTime: 299, endTime: 300 },
    ]
    const out = alignPhrasesToTranscript(phrases, words, 'ja')
    expect(out[0].startTime).toBeLessThan(160)
    expect(out[1].startTime).toBeGreaterThan(250)
    expect(out[1].startTime - out[0].startTime).toBeGreaterThan(100)
  })
})

describe.skipIf(!existsSync(SEGMENT_CACHE))('refineAlignmentWithPhrases — AKFG segment', () => {
  const sheetRows = readFileSync(LYRICS, 'utf8').trim().split('\n').map((original) => line(original, 0, 0))
  const words = JSON.parse(readFileSync(SEGMENT_CACHE, 'utf8')).chunks.flatMap(
    (c: { text?: string; timestamp?: number[] }) => {
      const [start, end] = c.timestamp ?? []
      const text = c.text?.trim()
      if (!text || !Number.isFinite(start)) return []
      return [{ word: text, startTime: start, endTime: end ?? start }]
    },
  )

  it('uses sung layout when sheet rows merge into shared phrases', () => {
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    expect(refined.phraseLayout).toBe('sung')
    expect(refined.lines.length).toBeLessThan(sheetRows.length)
    expect(refined.sheetLinesSnapshot?.length).toBe(sheetRows.length)
  })

  it('anchors rolling phrases at distinct chorus occurrences', () => {
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const rolling = refined.lines.filter((l) => l.original.includes('ローリング'))
    expect(rolling.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < rolling.length; i++) {
      expect(rolling[i].startTime).toBeGreaterThan(rolling[i - 1].startTime + 5)
    }
  })

  it('anchors the bridge line before the red car block', () => {
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const bridge = refined.lines.find((l) => l.original.includes('君の孤独も全て暴き出す朝だ'))
    const red = refined.lines.find((l) => l.original.includes('赤い 赤い'))
    expect(bridge?.startTime).toBeGreaterThan(220)
    expect(bridge?.endTime).toBeLessThan(235)
    expect(red?.startTime).toBeGreaterThan(255)
    expect(red!.startTime).toBeGreaterThan(bridge!.endTime + 20)
  })

  it('gives 心絡まって enough duration to cover the sung phrase', () => {
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    const entwined = refined.lines.filter((l) => l.original.includes('心絡まって'))
    for (const row of entwined) {
      expect(row.endTime - row.startTime).toBeGreaterThan(2.5)
    }
  })
})

const USER_ROCKROLL_CACHE = join(
  here,
  '../../.cache/auto-align-audit/UserRockRoll_segment.json',
)

describe.skipIf(!existsSync(USER_ROCKROLL_CACHE))(
  'refineAlignmentWithPhrases — UserRockRoll segment',
  () => {
    const sheetRows = readFileSync(LYRICS, 'utf8')
      .trim()
      .split('\n')
      .map((original) => line(original, 0, 0))
    const words = JSON.parse(readFileSync(USER_ROCKROLL_CACHE, 'utf8')).chunks.flatMap(
      (c: { text?: string; timestamp?: number[] }) => {
        const [start, end] = c.timestamp ?? []
        const text = c.text?.trim()
        if (!text || !Number.isFinite(start)) return []
        return [{ word: text, startTime: start, endTime: end ?? start }]
      },
    )

    it('covers 初めから持ってないのに at the first chorus (not skipped)', () => {
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      const first = refined.lines.find((l) => l.original.includes('初めから持って'))
      expect(first?.startTime).toBeLessThan(150)
      expect(first!.endTime - first!.startTime).toBeGreaterThan(5)
    })

    it('covers 凍てつく地面を転がるように through 走り出した', () => {
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      const ground = refined.lines.find((l) => l.original.includes('凍てつく地面'))
      expect(ground?.startTime).toBeGreaterThan(158)
      expect(ground?.startTime).toBeLessThan(165)
      expect(ground!.endTime - ground!.startTime).toBeGreaterThan(5)
    })

    it('covers 凍てつく世界を転がるように at the final chorus', () => {
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      const world = refined.lines.find((l) => l.original.includes('凍てつく世界'))
      expect(world?.startTime).toBeGreaterThan(308)
      expect(world!.endTime - world!.startTime).toBeGreaterThan(5)
    })

    it('covers 泣けやしないから with a full vocal span (not skipped)', () => {
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      const cry = refined.lines.find((l) => l.original.includes('泣けやしないから'))
      expect(cry?.startTime).toBeGreaterThan(180)
      expect(cry?.startTime).toBeLessThan(186)
      expect(cry!.endTime - cry!.startTime).toBeGreaterThan(5)
    })

    it('anchors the second-chorus 何をなくした merge before 初めから', () => {
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      const lost = refined.lines.find((l) =>
        l.original.includes('何をなくした') && l.original.includes('ローリング'),
      )
      const firstPain = refined.lines.find(
        (l) =>
          l.original.includes('初めから持って') &&
          (l.startTime ?? 0) > 290,
      )
      expect(lost?.startTime).toBeLessThan(295)
      expect(lost!.endTime - lost!.startTime).toBeGreaterThan(5)
      expect(firstPain!.startTime).toBeGreaterThanOrEqual(lost!.endTime - 0.5)
    })

    it('gives every sung row at least 2s except sigh rows', () => {
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      for (const row of refined.lines) {
        const dur = row.endTime - row.startTime
        if (/^(嗚呼|うーん|あー)/.test(row.original.trim())) continue
        expect(dur).toBeGreaterThan(2)
      }
    })

    it('keeps consecutive rows monotonic without large overlaps', () => {
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      for (let i = 1; i < refined.lines.length; i++) {
        expect(refined.lines[i].startTime).toBeGreaterThanOrEqual(
          refined.lines[i - 1].startTime - 0.01,
        )
        expect(refined.lines[i].startTime).toBeGreaterThanOrEqual(
          refined.lines[i - 1].endTime - 0.35,
        )
      }
    })
  },
)
