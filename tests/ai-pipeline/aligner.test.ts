import { describe, it, expect } from 'vitest'
import { alignTranscriptToLines, sanitizeTranscript, lineWeight, alignLyrics, ensureVisibleLineWindows, type TranscriptWord } from '../../src/ai-pipeline/aligner'
import type { TimedLine } from '../../src/core/types'

const line = (startTime: number, endTime: number, original = 'x'): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})

const plainLines = ['star in the sky', 'waiting in dreams']

const transcriptWords: TranscriptWord[] = [
  { word: 'star', startTime: 1.0, endTime: 1.5 },
  { word: 'in', startTime: 1.5, endTime: 1.7 },
  { word: 'the', startTime: 1.7, endTime: 1.9 },
  { word: 'sky', startTime: 1.9, endTime: 2.4 },
  { word: 'waiting', startTime: 3.0, endTime: 3.6 },
  { word: 'in', startTime: 3.6, endTime: 3.8 },
  { word: 'dreams', startTime: 3.8, endTime: 4.3 },
]

function isMonotonic(lines: TimedLine[]): boolean {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startTime < lines[i - 1].startTime) return false
  }
  return true
}

describe('ensureVisibleLineWindows', () => {
  it('gives a zero-duration interpolated line a visible highlight window', () => {
    // ローリング dropped by Whisper: start coincides with the next line's start.
    const lines = [line(292.8, 299.24, 'A'), line(299.24, 299.24, 'ローリング'), line(299.24, 305.38, 'C')]
    const out = ensureVisibleLineWindows(lines, 0.3)
    expect(out[2].startTime - out[1].startTime).toBeGreaterThanOrEqual(0.3)
    expect(out[1].startTime).toBeLessThan(out[2].startTime)
    expect(out[1].startTime).toBeGreaterThan(out[0].startTime)
  })

  it('keeps starts strictly increasing and never crosses the previous line', () => {
    const lines = [line(0, 5, 'A'), line(5, 5, 'B'), line(5, 5, 'C'), line(5, 10, 'D')]
    const out = ensureVisibleLineWindows(lines, 0.3)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startTime).toBeGreaterThan(out[i - 1].startTime)
    }
  })

  it('leaves well-spaced lines untouched', () => {
    const lines = [line(0, 2), line(3, 5), line(6, 8)]
    expect(ensureVisibleLineWindows(lines, 0.3)).toEqual(lines)
  })
})

describe('alignTranscriptToLines', () => {
  it('anchors the first line to the first transcript word and stays monotonic', () => {
    const result = alignTranscriptToLines(plainLines, transcriptWords)
    expect(result).toHaveLength(2)
    expect(result[0].startTime).toBeCloseTo(1.0)
    expect(isMonotonic(result)).toBe(true)
    // Second line starts later than the first and within the transcript span.
    expect(result[1].startTime).toBeGreaterThan(result[0].startTime)
    expect(result[1].startTime).toBeLessThanOrEqual(4.3)
    // A line ends at its own last sung word and never overlaps the next line;
    // an instrumental gap between them is left as a rest (endTime < next start).
    expect(result[0].endTime).toBeGreaterThanOrEqual(result[0].startTime)
    expect(result[0].endTime).toBeLessThanOrEqual(result[1].startTime)
  })

  it('preserves original and translation text', () => {
    const existingLines: TimedLine[] = [
      { startTime: 0, endTime: 0, original: '星に願いを', translation: 'Star in the sky' },
      { startTime: 0, endTime: 0, original: '夢の中で待ってる', translation: 'Waiting in dreams' },
    ]
    const result = alignTranscriptToLines(
      existingLines.map((l) => l.original),
      transcriptWords,
      existingLines
    )
    expect(result[0].original).toBe('星に願いを')
    expect(result[0].translation).toBe('Star in the sky')
  })

  it('spreads spaceless (Japanese) lines across the whole transcript span', () => {
    // 5 Japanese lines (no spaces), 30 word-chunks spanning ~2s..60s.
    const lines = ['星空に願いをこめて', '夜の街を駆け抜ける', '君の声が聞こえる', '光の中で踊ろう', '明日へと続く道']
    const words: TranscriptWord[] = Array.from({ length: 30 }, (_, i) => ({
      word: `語${i}`,
      startTime: 2 + i * 2,
      endTime: 2 + i * 2 + 1.5,
    }))
    const result = alignTranscriptToLines(lines, words)

    expect(result).toHaveLength(5)
    expect(isMonotonic(result)).toBe(true)
    expect(result[0].startTime).toBeCloseTo(2, 0)
    // The last line must land in the back half of the song, not bunched at 0.
    expect(result[4].startTime).toBeGreaterThan(30)
    // The final line ends at (or near) the end of the transcript.
    expect(result[4].endTime).toBeGreaterThan(55)
  })

  it('weights a sung-English line by word count, not letter count, vs Japanese', () => {
    // A pure-English sung line (6 words) and a Japanese line (6 mora-chars).
    // Whisper emits ~1 token per English WORD but ~1 per Japanese char, so the
    // two lines occupy similar token counts and should split the transcript
    // near the midpoint. Counting English letters (22) would make line 0 hog
    // ~3/4 of the timeline and shove line 1 late.
    const lines = ['You always make me so happy', 'あおにとけて']
    const words: TranscriptWord[] = Array.from({ length: 12 }, (_, i) => ({
      word: `w${i}`,
      startTime: i,
      endTime: i + 0.9,
    }))
    const result = alignTranscriptToLines(lines, words, undefined, 'ja')
    // Line 1 starts near the midpoint (~6s), not pushed toward ~9s.
    expect(result[1].startTime).toBeGreaterThan(4.5)
    expect(result[1].startTime).toBeLessThan(7.5)
  })

  it('weights inline-bilingual lines by their sung (Japanese) content, not the translation', () => {
    // Two lines with the SAME Japanese (4 sung chars each) but the first also
    // carries a long English translation inline. Only the Japanese is in the
    // audio, so both lines should claim a similar slice of the transcript — if
    // the English were counted, line 1 would balloon and shove line 2 late.
    const lines = ['You always make me so happy 青空に溶け', '青空に溶ける']
    const words: TranscriptWord[] = Array.from({ length: 20 }, (_, i) => ({
      word: `語${i}`,
      startTime: i,
      endTime: i + 0.9,
    }))
    const result = alignTranscriptToLines(lines, words, undefined, 'ja')

    // Line 2 should start near the midpoint (~10s), not be pushed toward the end.
    expect(result[1].startTime).toBeGreaterThan(7)
    expect(result[1].startTime).toBeLessThan(13)
  })

  it('handles an empty transcript without crashing', () => {
    const result = alignTranscriptToLines(plainLines, [])
    expect(result).toHaveLength(2)
    expect(result.every((l) => l.startTime === 0 && l.endTime === 0)).toBe(true)
  })

  it('handles more lines than transcript words and stays monotonic', () => {
    const lines = ['a', 'b', 'c', 'd', 'e']
    const words: TranscriptWord[] = [
      { word: 'x', startTime: 1, endTime: 2 },
      { word: 'y', startTime: 3, endTime: 4 },
    ]
    const result = alignTranscriptToLines(lines, words)
    expect(result).toHaveLength(5)
    expect(isMonotonic(result)).toBe(true)
  })

  it('leaves a rest at an instrumental gap instead of stretching the line across it', () => {
    // Two lines; the transcript has a 20s instrumental gap between them.
    const lines = ['ねえ', 'いつも']
    const words: TranscriptWord[] = [
      { word: 'ねえ', startTime: 1, endTime: 2 },
      { word: 'いつも', startTime: 22, endTime: 23 },
    ]
    const result = alignTranscriptToLines(lines, words)
    // Line 0 ends at its own last word (~2s), not stretched to line 1's start.
    expect(result[0].endTime).toBeCloseTo(2)
    expect(result[1].startTime).toBeCloseTo(22)
    // The gap between them is a rest, not covered by line 0.
    expect(result[1].startTime - result[0].endTime).toBeGreaterThan(15)
  })

  it('ignores hallucinated repetition in a gap so the next line keeps its real onset', () => {
    // A real word, then a Whisper silence-loop, then the real second line.
    const lines = ['星空', '夜空']
    const words: TranscriptWord[] = [
      { word: '星空', startTime: 1, endTime: 2 },
      ...Array.from({ length: 8 }, (_, i) => ({ word: 'のののの', startTime: 5 + i, endTime: 5.5 + i })),
      { word: '夜空', startTime: 30, endTime: 31 },
    ]
    const result = alignTranscriptToLines(lines, words)
    // Without filtering, the 8 phantom words would pull line 2's start toward
    // the gap; sanitized, line 2 anchors at its real 30s onset.
    expect(result[1].startTime).toBeGreaterThan(20)
  })
})

describe('sanitizeTranscript', () => {
  it('drops zero/negative and subdivides segment-length slots', () => {
    const words: TranscriptWord[] = [
      { word: 'ok', startTime: 1, endTime: 2 },
      { word: 'zero', startTime: 3, endTime: 3 },
      { word: 'neg', startTime: 5, endTime: 4 },
      { word: 'phrase', startTime: 6, endTime: 20 },
      { word: 'loop', startTime: 30, endTime: 65 },
    ]
    const result = sanitizeTranscript(words)
    expect(result[0].word).toBe('ok')
    expect(result.length).toBeGreaterThan(4)
    expect(result.every((w) => w.endTime - w.startTime <= 10)).toBe(true)
    expect(result.some((w) => w.word === 'p')).toBe(true)
    expect(result.every((w) => w.word !== 'loop')).toBe(true)
  })

  it('drops out-of-order words with a large rewind (chunk-merge artifact)', () => {
    const words: TranscriptWord[] = [
      { word: 'a', startTime: 50, endTime: 51 },
      { word: 'b', startTime: 2, endTime: 3 },
      { word: 'c', startTime: 52, endTime: 53 },
    ]
    expect(sanitizeTranscript(words).map((w) => w.word)).toEqual(['a', 'c'])
  })

  it('collapses a consecutive repetition loop to a single token', () => {
    const loop: TranscriptWord[] = Array.from({ length: 6 }, (_, i) => ({
      word: 'la',
      startTime: i,
      endTime: i + 0.5,
    }))
    // The whole consecutive run collapses to its first occurrence.
    const result = sanitizeTranscript(loop)
    expect(result).toHaveLength(1)
    expect(result[0].startTime).toBe(0)
  })

  it('only collapses CONSECUTIVE duplicates, not repeats split by other words', () => {
    const words: TranscriptWord[] = [
      { word: 'ねえ', startTime: 1, endTime: 2 },
      { word: 'いつか', startTime: 3, endTime: 4 },
      { word: 'ねえ', startTime: 5, endTime: 6 },
      { word: 'いつも', startTime: 7, endTime: 8 },
    ]
    // Genuine refrain repeats (non-adjacent) are preserved.
    expect(sanitizeTranscript(words)).toHaveLength(4)
  })

  it('drops music-symbol and punctuation-only tokens', () => {
    const words: TranscriptWord[] = [
      { word: '♪', startTime: 20, endTime: 20.5 },
      { word: '~', startTime: 20.5, endTime: 24 },
      { word: '届', startTime: 25, endTime: 26 },
    ]
    expect(sanitizeTranscript(words).map((w) => w.word)).toEqual(['届'])
  })

  it('clips an overstamped Japanese segment instead of dropping it', () => {
    const words: TranscriptWord[] = [{ word: '明日を♪', startTime: 228, endTime: 262.52 }]
    const result = sanitizeTranscript(words)
    expect(result).toHaveLength(1)
    expect(result[0].startTime).toBe(228)
    expect(result[0].endTime).toBeLessThan(232)
    expect(result[0].endTime - result[0].startTime).toBeLessThanOrEqual(10)
  })
})

describe('lineWeight', () => {
  it('counts Japanese by character and English by word', () => {
    expect(lineWeight('青空に溶けて', 'ja')).toBe(6)            // 6 kana/kanji
    expect(lineWeight('You always make me so happy', 'ja')).toBe(6) // 6 words
    expect(lineWeight('青空に溶けて', 'ja')).toBeGreaterThan(0)
  })
})

describe('alignLyrics', () => {
  it('uses content mode when the transcript matches the lyrics', () => {
    const lines = ['あおぞら', 'ゆきがふる']
    const words: TranscriptWord[] = [
      { word: 'あおぞら', startTime: 1, endTime: 2 },
      { word: 'ゆきがふる', startTime: 10, endTime: 11 },
    ]
    const r = alignLyrics(lines, words, undefined, 'ja')
    expect(r.mode).toBe('content')
    expect(r.confidence).toBeGreaterThan(0.5)
    expect(r.lines[1].startTime).toBeGreaterThanOrEqual(10)
  })

  it('falls back to proportional when nothing matches', () => {
    const lines = ['あおぞら', 'ゆきがふる']
    const words: TranscriptWord[] = [
      { word: 'xxxxx', startTime: 1, endTime: 2 },
      { word: 'yyyyy', startTime: 10, endTime: 11 },
    ]
    const r = alignLyrics(lines, words, undefined, 'ja')
    expect(r.mode).toBe('proportional')
    expect(r.confidence).toBeLessThan(0.5)
    expect(r.lines).toHaveLength(2)
  })
})

describe('sanitizeTranscript: overlapping vocalists', () => {
  const w = (word: string, startTime: number, endTime: number) => ({ word, startTime, endTime })

  it('keeps a second interleaved stream with slightly-backward timestamps, sorted', () => {
    const words = [
      w('Ill', 143.06, 143.3), w('find', 143.32, 143.62), w('a', 143.62, 143.92), w('place', 143.92, 144.58),
      w('Find', 143.38, 143.68), w('a', 143.68, 143.9), w('face', 143.9, 144.8),
      w('That', 145.32, 145.68), w('I', 145.68, 145.88),
    ]
    const clean = sanitizeTranscript(words)
    expect(clean.map((x) => x.word)).toContain('face')
    for (let i = 1; i < clean.length; i++) {
      expect(clean[i].startTime).toBeGreaterThanOrEqual(clean[i - 1].startTime)
    }
  })

  it('still drops large rewinds (chunk-merge artifacts)', () => {
    const words = [
      w('one', 100, 100.5), w('two', 101, 101.5),
      w('ghost', 60, 60.5),
      w('three', 102, 102.5),
    ]
    const clean = sanitizeTranscript(words)
    expect(clean.map((x) => x.word)).toEqual(['one', 'two', 'three'])
  })
})
