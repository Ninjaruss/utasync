import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'
import {
  linePassPreference,
  scriptCharFractions,
  scopedConfidenceThreshold,
  mergeMixedRefinedAlignments,
  mergeMixedTranscripts,
  refineMixedLanguageAlignment,
} from '../../src/ai-pipeline/mixedLanguageAlign'

const here = dirname(fileURLToPath(import.meta.url))

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})

function fakeRefined(
  lines: TimedLine[],
  quality: ('good' | 'approximate' | 'needs_review')[],
  mode: 'content' | 'proportional' = 'content',
  confidence = 0.5,
): RefinedAlignment {
  return {
    lines,
    phrases: [],
    report: { merged: 0, split: 0, dropped: 0 } as unknown as RefinedAlignment['report'],
    mode,
    confidence,
    anchorSources: lines.map((_, i) => (quality[i] === 'good' ? 'lcs' : 'interpolated')),
    lineAlignmentQuality: quality,
    phraseLayout: 'sheet',
    sheetLinesSnapshot: undefined,
  }
}

describe('linePassPreference / scriptCharFractions', () => {
  it('prefers the JA pass for lines carrying any JA glyph', () => {
    expect(linePassPreference('青空に溶けて')).toBe('ja')
    expect(linePassPreference('You make me happy 青空')).toBe('ja')
    expect(linePassPreference('You make me so happy')).toBe('en')
  })

  it('splits sheet chars by line script', () => {
    const { ja, en } = scriptCharFractions(['あいうえお', 'abcde'])
    expect(ja).toBeCloseTo(0.5)
    expect(en).toBeCloseTo(0.5)
  })

  it('scales the confidence gate by script share, with a noise floor', () => {
    expect(scopedConfidenceThreshold(0.5)).toBeCloseTo(0.25)
    expect(scopedConfidenceThreshold(0.05)).toBeCloseTo(0.08)
  })
})

describe('mergeMixedRefinedAlignments', () => {
  const texts = ['青空に溶けていく', 'You make me so happy', '君の声が聞こえる']

  it('takes each line from the pass that anchored it better', () => {
    // JA pass: good on JA lines, garbage (interpolated) on the EN line.
    const ja = fakeRefined(
      [line(texts[0], 10, 13), line(texts[1], 13, 14), line(texts[2], 20, 23)],
      ['good', 'needs_review', 'good'],
    )
    // EN pass: good on the EN line, garbage elsewhere.
    const en = fakeRefined(
      [line(texts[0], 0, 2), line(texts[1], 15, 18), line(texts[2], 18, 19)],
      ['needs_review', 'good', 'needs_review'],
    )
    const { refined, pickedFrom } = mergeMixedRefinedAlignments(ja, en, texts)
    expect(pickedFrom).toEqual(['ja', 'en', 'ja'])
    expect(refined.lines.map((l) => l.startTime)).toEqual([10, 15, 20])
    // End clamped to next start (18 → but own end 18 ≤ 20) stays.
    expect(refined.lines[1].endTime).toBe(18)
    expect(refined.lineAlignmentQuality).toEqual(['good', 'good', 'good'])
  })

  it('breaks quality ties by the line’s own script', () => {
    const ja = fakeRefined(
      [line(texts[0], 10, 13), line(texts[1], 13, 14), line(texts[2], 20, 23)],
      ['good', 'good', 'good'],
    )
    const en = fakeRefined(
      [line(texts[0], 11, 12), line(texts[1], 15, 18), line(texts[2], 21, 22)],
      ['good', 'good', 'good'],
    )
    const { pickedFrom } = mergeMixedRefinedAlignments(ja, en, texts)
    expect(pickedFrom).toEqual(['ja', 'en', 'ja'])
  })

  it('never takes lines from a proportional-fallback pass when the other is content mode', () => {
    const ja = fakeRefined(
      [line(texts[0], 10, 13), line(texts[1], 14, 17), line(texts[2], 20, 23)],
      ['good', 'approximate', 'good'],
    )
    const en = fakeRefined(
      [line(texts[0], 1, 2), line(texts[1], 2, 3), line(texts[2], 3, 4)],
      ['good', 'good', 'good'],
      'proportional',
    )
    const { pickedFrom } = mergeMixedRefinedAlignments(ja, en, texts)
    expect(pickedFrom).toEqual(['ja', 'ja', 'ja'])
  })

  it('repairs a backward cross-pass jump by preferring the pass that keeps order', () => {
    const ja = fakeRefined(
      [line(texts[0], 10, 13), line(texts[1], 14, 16), line(texts[2], 20, 23)],
      ['good', 'approximate', 'good'],
    )
    // EN pass anchored the EN line to an EARLIER reprise (before line 0's start).
    const en = fakeRefined(
      [line(texts[0], 0, 1), line(texts[1], 4, 6), line(texts[2], 6, 7)],
      ['needs_review', 'good', 'needs_review'],
    )
    const { refined, pickedFrom } = mergeMixedRefinedAlignments(ja, en, texts)
    expect(pickedFrom[1]).toBe('ja')
    const starts = refined.lines.map((l) => l.startTime)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('sums the two near-disjoint pass confidences', () => {
    const ja = fakeRefined([line(texts[0], 0, 1), line(texts[1], 1, 2), line(texts[2], 2, 3)], ['good', 'good', 'good'], 'content', 0.5)
    const en = fakeRefined([line(texts[0], 0, 1), line(texts[1], 1, 2), line(texts[2], 2, 3)], ['good', 'good', 'good'], 'content', 0.4)
    const { refined } = mergeMixedRefinedAlignments(ja, en, texts)
    expect(refined.confidence).toBeCloseTo(0.9)
    expect(refined.mode).toBe('content')
  })
})

describe('mergeMixedTranscripts', () => {
  it('uses EN-pass words inside EN-picked lines and JA-pass words elsewhere', () => {
    const jaWords: TranscriptWord[] = [
      { word: '青空', startTime: 0, endTime: 1 },
      { word: 'ユーメイクミー', startTime: 5, endTime: 7 }, // katakana soup over the EN line
    ]
    const enWords: TranscriptWord[] = [
      { word: 'aozora', startTime: 0, endTime: 1 }, // romaji soup over the JA line
      { word: 'you', startTime: 5, endTime: 5.5 },
      { word: 'make', startTime: 5.5, endTime: 6 },
    ]
    const lines = [line('青空に', 0, 4), line('You make me', 5, 8)]
    const merged = mergeMixedTranscripts(jaWords, enWords, lines, ['ja', 'en'])
    expect(merged.map((w) => w.word)).toEqual(['青空', 'you', 'make'])
  })
})

describe('refineMixedLanguageAlignment (integration)', () => {
  // Synthetic mixed song: JA verse (0–20s), EN verse (25–45s), JA outro (50–70s).
  const sheet = [
    '星空に願いをこめて',
    '夜の街を駆け抜ける',
    'You always make me so happy',
    'Running through the endless night',
    '君の声が聞こえるまで',
    '光の中で踊りだす',
  ]

  const perChar = (text: string, start: number, dur: number): TranscriptWord[] => {
    const chars = [...text.replace(/\s+/g, '')]
    return chars.map((ch, i) => ({
      word: ch,
      startTime: start + (dur * i) / chars.length,
      endTime: start + (dur * (i + 1)) / chars.length,
    }))
  }
  const perWord = (text: string, start: number, dur: number): TranscriptWord[] => {
    const words = text.split(/\s+/)
    return words.map((w, i) => ({
      word: w,
      startTime: start + (dur * i) / words.length,
      endTime: start + (dur * (i + 1)) / words.length,
    }))
  }

  // JA-forced pass: real JA + katakana soup where English is sung.
  const jaWords: TranscriptWord[] = [
    ...perChar(sheet[0], 0, 6),
    ...perChar(sheet[1], 8, 6),
    ...perChar('ユーオールウェイズメイクミーソー', 25, 6),
    ...perChar('ランニングスルージエンドレス', 33, 6),
    ...perChar(sheet[4], 50, 6),
    ...perChar(sheet[5], 58, 6),
  ]
  // EN-forced pass: romaji soup where Japanese is sung + real English.
  const enWords: TranscriptWord[] = [
    ...perWord('hoshizora ni negai wo komete', 0, 6),
    ...perWord('yoru no machi wo kakenukeru', 8, 6),
    ...perWord(sheet[2], 25, 6),
    ...perWord(sheet[3], 33, 6),
    ...perWord('kimi no koe ga kikoeru made', 50, 6),
    ...perWord('hikari no naka de odoridasu', 58, 6),
  ]

  const sheetRows = sheet.map((original) => ({ original, translation: '', startTime: 0, endTime: 0 }))

  it('anchors every line near its sung time and stays content mode', () => {
    const { refined, pickedFrom } = refineMixedLanguageAlignment(sheetRows, jaWords, enWords)
    expect(refined.mode).toBe('content')
    const starts = refined.lines.map((l) => l.startTime)
    const truth = [0, 8, 25, 33, 50, 58]
    for (let i = 0; i < truth.length; i++) {
      expect(Math.abs(starts[i] - truth[i])).toBeLessThan(3)
    }
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    // The EN lines come from the EN pass, JA lines from the JA pass.
    expect(pickedFrom[2]).toBe('en')
    expect(pickedFrom[3]).toBe('en')
    expect(pickedFrom[0]).toBe('ja')
    expect(pickedFrom[5]).toBe('ja')
  })

  it('stored transcript keeps JA words for JA lines and EN words for EN lines', () => {
    const { transcriptWords } = refineMixedLanguageAlignment(sheetRows, jaWords, enWords)
    const inEnVerse = transcriptWords.filter((w) => w.startTime >= 24.5 && w.endTime <= 45)
    expect(inEnVerse.length).toBeGreaterThan(0)
    expect(inEnVerse.every((w) => /^[A-Za-z]/.test(w.word))).toBe(true)
    const inJaVerse = transcriptWords.filter((w) => w.endTime <= 20)
    expect(inJaVerse.length).toBeGreaterThan(0)
    expect(inJaVerse.every((w) => !/^[a-z]+$/i.test(w.word))).toBe(true)
  })
})

// Round 6 (diagnosis H3): the merge stitch (end = min(ownEnd, next.start)) runs
// AFTER each pass's display-floor expansion and re-created zero-duration rows —
// stranger row 45 ('Once you come here…') shipped as 183.5–183.5, quality
// 'good', in both word and segment modes.
describe('refineMixedLanguageAlignment — post-merge display floor (fixtures)', () => {
  const FIXTURES = join(here, 'fixtures/stranger-than-heaven')

  function loadWords(path: string): TranscriptWord[] {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const arr: TranscriptWord[] = Array.isArray(raw)
      ? raw.map((w: { word?: string; startTime?: number; endTime?: number }) => ({
          word: (w.word ?? '').trim(),
          startTime: w.startTime as number,
          endTime: w.endTime as number,
        }))
      : (raw.chunks ?? []).map((c: { text?: string; timestamp?: number[] }) => ({
          word: (c.text ?? '').trim(),
          startTime: c.timestamp?.[0] as number,
          endTime: c.timestamp?.[1] as number,
        }))
    return arr.filter((w) => w.word && Number.isFinite(w.startTime) && Number.isFinite(w.endTime))
  }

  const lineTexts = readFileSync(join(FIXTURES, 'lyrics.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const sheetRows: TimedLine[] = lineTexts.map((original) => ({
    original,
    translation: '',
    startTime: 0,
    endTime: 0,
  }))
  const enWords = loadWords(join(FIXTURES, 'transcript.segment.forced-en.json'))

  for (const mode of ['word', 'segment'] as const) {
    it(`${mode} mode ships no zero-duration rows and floors the co-started row`, { timeout: 60_000 }, () => {
      const jaWords = loadWords(join(FIXTURES, `transcript.${mode}.json`))
      const { refined } = refineMixedLanguageAlignment(sheetRows, jaWords, enWords)
      for (let i = 0; i < refined.lines.length; i++) {
        const l = refined.lines[i]
        expect(l.endTime, `row ${i} "${l.original.slice(0, 24)}" duration`).toBeGreaterThan(l.startTime)
        if (i > 0) {
          expect(l.startTime, `row ${i} monotonicity`).toBeGreaterThanOrEqual(refined.lines[i - 1].startTime)
        }
        if (i + 1 < refined.lines.length) {
          expect(l.endTime, `row ${i} end vs next start`).toBeLessThanOrEqual(
            refined.lines[i + 1].startTime + 1e-6,
          )
        }
      }
      const row45 = refined.lines.findIndex((l) => l.original.startsWith('Once you come here'))
      expect(row45).toBeGreaterThanOrEqual(0)
      const dur = refined.lines[row45].endTime - refined.lines[row45].startTime
      expect(dur, 'row 45 display floor').toBeGreaterThanOrEqual(1.2 - 1e-6)
    })
  }
})
