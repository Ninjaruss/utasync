import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TimedLine } from '../../src/core/types'
import {
  alignPhrasesToTranscript,
  enforceLineDisplayFloor,
  expandSquashedLineHighlights,
  projectPhraseTimingToLines,
  refineAlignmentWithPhrases,
  sheetRowsForAlignment,
  validateAndRetryLineTimings,
} from '../../src/lyrics/phraseAlignment'
import type { LyricsData } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

const line = (
  original: string,
  startTime: number,
  endTime: number,
  translation = '',
): TimedLine => ({ original, translation, startTime, endTime })

const here = dirname(fileURLToPath(import.meta.url))
const SEGMENT_CACHE = join(here, '../../.cache/auto-align-audit/AKFG_FirstTake_segment.json')
const LYRICS = join(here, '../ai-pipeline/fixtures/akfg-user-ja.txt')

describe('validateAndRetryLineTimings — repeated-line partial match', () => {
  it('does not jump a weak repeated row onto a later occurrence', () => {
    // Row 0 is a repeated chorus line whose own audio is garbled; the same line
    // is sung again later (25s). The partial-match retry must stay in row 0's
    // window and not latch onto the later occurrence (which would push the row
    // past row 1 and collapse it under monotonicity).
    const lines: TimedLine[] = [
      line('ローリング ローリング', 10, 12),
      line('次の行です', 20, 22),
    ]
    const words: TranscriptWord[] = [
      { word: 'ノイズ', startTime: 8, endTime: 12 },
      { word: '次の行です', startTime: 20, endTime: 22 },
      { word: 'ローリング', startTime: 25, endTime: 27 },
    ]
    const { lines: out } = validateAndRetryLineTimings(lines, words, 'ja')
    expect(out[0].startTime).toBeLessThan(out[1].startTime)
    expect(out[0].startTime).toBeLessThan(20)
  })
})

describe('expandSquashedLineHighlights — float-tolerant floor guard', () => {
  // Round 6 (diagnosis H3): float addition makes the room check miss its own
  // floor by ~1e-14 (247.03999999999996 + 1.2 − start = 1.1999999999999886),
  // so exactly the rows the pass exists to fix were skipped.
  it('expands a zero-span final row despite float dust in the synthetic room', () => {
    const lines = [line('a line of text', 240, 245), line('final row', 247.03999999999996, 247.03999999999996)]
    const out = expandSquashedLineHighlights(lines)
    expect(out[1].endTime - out[1].startTime).toBeGreaterThanOrEqual(1.2 - 1e-6)
  })

  it('expands a sub-floor row whose successor leaves floor-minus-epsilon room', () => {
    const lines = [
      line('a line of text', 240, 245),
      line('squashed row', 247.03999999999996, 247.1),
      line('next row', 248.23999999999995, 250),
    ]
    const out = expandSquashedLineHighlights(lines)
    expect(out[1].endTime - out[1].startTime).toBeGreaterThanOrEqual(1.2 - 1e-6)
    expect(out[1].endTime).toBeLessThanOrEqual(out[2].startTime)
  })
})

describe('enforceLineDisplayFloor — co-start reclaim', () => {
  const FLOOR = 1.2

  // Shared invariants: the reclaim must never break ordering and must never
  // pay for one row's floor by dropping a neighbour below the floor itself.
  function assertWellFormed(out: TimedLine[]) {
    for (let i = 0; i < out.length; i++) {
      expect(out[i].endTime, `row ${i} width`).toBeGreaterThanOrEqual(out[i].startTime)
      if (i > 0) {
        expect(out[i].startTime, `row ${i} monotonicity`).toBeGreaterThanOrEqual(out[i - 1].startTime)
        expect(out[i - 1].endTime, `row ${i - 1} end vs next start`).toBeLessThanOrEqual(
          out[i].startTime + 1e-6,
        )
      }
    }
  }

  it('takes nothing from a predecessor that is already sub-floor', () => {
    // prev is pinned at t=0 (no free space before it) and sub-floor: the
    // zero-width row must be fed from the successor's surplus only.
    const lines = [line('prev', 0, 0.8), line('cur', 0.8, 0.8), line('next', 0.8, 5)]
    const out = enforceLineDisplayFloor(lines)
    expect(out[0]).toMatchObject({ startTime: 0, endTime: 0.8 }) // untouched
    expect(out[1].endTime - out[1].startTime).toBeGreaterThanOrEqual(FLOOR - 1e-6)
    expect(out[2].startTime).toBeCloseTo(0.8 + FLOOR, 6) // pushed by exactly the floor
    expect(out[2].endTime - out[2].startTime).toBeGreaterThanOrEqual(FLOOR - 1e-6)
    assertWellFormed(out)
  })

  it('reclaims from a comfortable predecessor tail without touching the successor', () => {
    const lines = [line('prev', 10, 14), line('cur', 14, 14), line('next', 14, 18)]
    const out = enforceLineDisplayFloor(lines)
    expect(out[2].startTime).toBe(14) // pullback-only: successor never moved
    expect(out[1].startTime).toBeCloseTo(14 - FLOOR, 6)
    expect(out[1].endTime - out[1].startTime).toBeGreaterThanOrEqual(FLOOR - 1e-6)
    expect(out[0].endTime - out[0].startTime).toBeGreaterThanOrEqual(FLOOR - 1e-6) // prev keeps its floor
    assertWellFormed(out)
  })

  it('caps the successor push at zero when the successor has no surplus', () => {
    // Neither neighbour has anything to give: the zero-width row stays (the
    // guarded residual) rather than robbing the exactly-at-floor successor.
    const lines = [line('prev', 0, 0.8), line('cur', 0.8, 0.8), line('next', 0.8, 0.8 + FLOOR)]
    const out = enforceLineDisplayFloor(lines)
    expect(out[0]).toMatchObject({ startTime: 0, endTime: 0.8 })
    expect(out[2]).toMatchObject({ startTime: 0.8, endTime: 0.8 + FLOOR }) // never robbed
    expect(out[1]).toMatchObject({ startTime: 0.8, endTime: 0.8 }) // honest residual
    assertWellFormed(out)
  })

  it('resolves a 3-deep co-start pile without cascading anyone below the floor', () => {
    // Row a pulls back into prev's tail, row b pushes into c's surplus — each
    // reclaim is bounded by the neighbour's own floor, so nothing cascades.
    const lines = [line('prev', 0, 10), line('a', 10, 10), line('b', 10, 10), line('c', 10, 18)]
    const out = enforceLineDisplayFloor(lines)
    for (let i = 0; i < out.length; i++) {
      expect(out[i].endTime - out[i].startTime, `row ${i} floor`).toBeGreaterThanOrEqual(FLOOR - 1e-6)
    }
    assertWellFormed(out)
  })
})

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

  it('keeps the sheet row layout (sung phrasing is opt-in via the player UI)', () => {
    const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
    expect(refined.phraseLayout).toBe('sheet')
    expect(refined.lines.length).toBe(sheetRows.length)
    expect(refined.sheetLinesSnapshot).toBeUndefined()
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

    it('anchors the second-chorus 何をなくした row before the second 初めから', () => {
      // Sheet layout keeps the rows separate (no merge), so assert the row-level
      // anchoring: 何をなくした sits at the second chorus and resolves before the
      // second 初めから持って row, each with a real vocal span.
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      expect(refined.phraseLayout).toBe('sheet')
      const lost = refined.lines.find((l) => l.original.includes('何をなくした'))
      const firstPain = refined.lines.find(
        (l) =>
          l.original.includes('初めから持って') &&
          (l.startTime ?? 0) > 290,
      )
      expect(lost?.startTime).toBeGreaterThan(290)
      expect(lost?.startTime).toBeLessThan(295)
      expect(lost!.endTime - lost!.startTime).toBeGreaterThan(3)
      expect(firstPain!.startTime).toBeGreaterThanOrEqual(lost!.endTime - 0.5)
    })

    it('gives every sung row at least 2s except sigh and short-repetition rows', () => {
      const refined = refineAlignmentWithPhrases(sheetRows, words, 'ja')
      for (const row of refined.lines) {
        const dur = row.endTime - row.startTime
        // Sighs and short repetition lines (ローリング ローリング) are genuinely brief —
        // ~1.6 s — once the preceding clause reclaims its own わからないんだ tail.
        if (/^(嗚呼|うーん|あー|ローリング)/.test(row.original.trim())) continue
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

// ─── helpers ──────────────────────────────────────────────────────────────────

