import { describe, it, expect } from 'vitest'
import type { TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'
import { capUnanchoredGapFillTails } from '../../src/lyrics/phraseAlignment'
import { expectedLineDuration } from '../../src/lyrics/lineDegeneracy'

// A JA lyric line long enough that its plausible sung length (0.25s/char) is
// well under the slab it is handed. 20 chars → expectedLineDuration ≈ 5.0s.
const LONG_JA = '錆ひとつない触らせやしない媚びる気はない'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})

/** Per-char transcript words spread evenly over [start, end] — fills the slab
 * the way a forced-language pass's hallucination does. */
function fill(text: string, start: number, end: number): TranscriptWord[] {
  const chars = [...text.replace(/\s+/g, '')]
  const step = (end - start) / chars.length
  return chars.map((word, i) => ({
    word,
    startTime: start + step * i,
    endTime: start + step * (i + 1),
  }))
}

describe('capUnanchoredGapFillTails', () => {
  it('caps an over-long, gap-defined, unanchored tail to expectedLineDuration', () => {
    const lines = [line(LONG_JA, 10, 20), line('次の行', 20.1, 22)]
    // Transcript over the target row is unrelated katakana/hiragana soup → cov 0.
    const words = fill('らりるれろわをんぱぴぷぺぽ', 10, 20)
    const out = capUnanchoredGapFillTails(lines, words, lines.map((l) => l.original), 'mixed')
    const expected = expectedLineDuration(LONG_JA, 'mixed')
    expect(expected).toBeCloseTo(5.0, 1)
    expect(out[0].endTime).toBeCloseTo(10 + expected, 5)
    // Only the end moved; start and the next line are untouched.
    expect(out[0].startTime).toBe(10)
    expect(out[1].startTime).toBe(20.1)
    expect(out[1].endTime).toBe(22)
  })

  it('never touches a line with real matched-span coverage (>= 0.15)', () => {
    const lines = [line(LONG_JA, 10, 20), line('次の行', 20.1, 22)]
    // Transcript IS the line's own text → coverage ~1.0, so the long tail is
    // evidenced (mirrors an extendValidatedLineTails-stretched high-cov row).
    const words = fill(LONG_JA, 10, 20)
    const out = capUnanchoredGapFillTails(lines, words, lines.map((l) => l.original), 'mixed')
    expect(out[0].endTime).toBe(20)
  })

  it('never caps when the end is not gap-defined (a real sung offset precedes the next start)', () => {
    // Same unanchored soup, but the next line starts 5s after this end — the
    // offset is not pinned by the successor, so it is not a projected gap-fill.
    const lines = [line(LONG_JA, 10, 20), line('次の行', 25, 27)]
    const words = fill('らりるれろわをんぱぴぷぺぽ', 10, 20)
    const out = capUnanchoredGapFillTails(lines, words, lines.map((l) => l.original), 'mixed')
    expect(out[0].endTime).toBe(20)
  })

  it('never caps a held-vowel / interjection line', () => {
    const lines = [line('ああ', 10, 20), line('次の行', 20.1, 22)]
    const words = fill('らりるれろ', 10, 20)
    const out = capUnanchoredGapFillTails(lines, words, lines.map((l) => l.original), 'mixed')
    expect(out[0].endTime).toBe(20)
  })

  it('never caps a line that is not over-long relative to its expected duration', () => {
    // dur 6.0 with expected ~5.0 → within the +1.5s margin, left alone.
    const lines = [line(LONG_JA, 10, 16), line('次の行', 16.1, 18)]
    const words = fill('らりるれろわをんぱぴぷぺぽ', 10, 16)
    const out = capUnanchoredGapFillTails(lines, words, lines.map((l) => l.original), 'mixed')
    expect(out[0].endTime).toBe(16)
  })

  it('never caps the last line (no successor pins its end)', () => {
    const lines = [line('前の行', 0, 9.9), line(LONG_JA, 10, 20)]
    const words = fill('らりるれろわをんぱぴぷぺぽ', 10, 20)
    const out = capUnanchoredGapFillTails(lines, words, lines.map((l) => l.original), 'mixed')
    expect(out[1].endTime).toBe(20)
  })

  it('never lowers a capped duration below the display floor (MIN_HIGHLIGHT_S)', () => {
    // A short line (expected 0.8s) still keeps >= 1.2s after capping.
    const lines = [line('あか', 10, 18), line('次の行', 18.1, 20)]
    // 'あか' is a two-char non-repeated word → not an interjection.
    const words = fill('らりるれろわをん', 10, 18)
    const out = capUnanchoredGapFillTails(lines, words, lines.map((l) => l.original), 'mixed')
    expect(out[0].endTime - out[0].startTime).toBeGreaterThanOrEqual(1.2 - 1e-9)
  })
})
