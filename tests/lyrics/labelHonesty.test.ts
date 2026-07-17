import { describe, it, expect } from 'vitest'
import type { TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'
import { applyLabelHonesty } from '../../src/lyrics/labelHonesty'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})

/** Per-char transcript words spread evenly over [start, end]. */
function fill(text: string, start: number, end: number): TranscriptWord[] {
  const chars = [...text.replace(/\s+/g, '')]
  const step = (end - start) / chars.length
  return chars.map((word, i) => ({
    word,
    startTime: start + step * i,
    endTime: start + step * (i + 1),
  }))
}

const JA_A = '笑えない日々を辿ったって'
const JA_B = '誰にも気づかれないまま'
const JA_C = '遠く向こうの角を曲がって'

describe('applyLabelHonesty', () => {
  it('caps every good label at approximate in proportional mode', () => {
    const lines = [line(JA_A, 0, 3), line(JA_B, 3, 6)]
    const out = applyLabelHonesty({
      lines,
      lineTexts: lines.map((l) => l.original),
      quality: ['good', 'needs_review'],
      words: fill(JA_A, 0, 3),
      mode: 'proportional',
    })
    expect(out).toEqual(['approximate', 'needs_review'])
  })

  it('downgrades good members of a shared multi-line transcript chunk (segment mode)', () => {
    // One 9s chunk covers both lines: per-line boundaries inside it are
    // interpolated, so neither line's timing is verifiable to 'good'.
    const lines = [line(JA_A, 10, 14), line(JA_B, 14, 19)]
    const chunk: TranscriptWord[] = [{ word: JA_A + JA_B, startTime: 10, endTime: 19 }]
    const out = applyLabelHonesty({
      lines,
      lineTexts: lines.map((l) => l.original),
      quality: ['good', 'good'],
      words: chunk,
      mode: 'content',
    })
    expect(out).toEqual(['approximate', 'approximate'])
  })

  it('leaves a good line alone when its chunk covers only itself', () => {
    const lines = [line(JA_A, 10, 14), line(JA_B, 14.5, 19)]
    const words: TranscriptWord[] = [
      { word: JA_A, startTime: 10, endTime: 14 },
      { word: JA_B, startTime: 14.5, endTime: 19 },
    ]
    const out = applyLabelHonesty({
      lines,
      lineTexts: lines.map((l) => l.original),
      quality: ['good', 'good'],
      words,
      mode: 'content',
    })
    expect(out).toEqual(['good', 'good'])
  })

  it('downgrades a good line whose matched evidence extends well past its end (clipped tail)', () => {
    // Line highlight ends at 13 but its own text keeps matching until 15.2 and
    // the next line's evidence starts later — the tail is clipped.
    const lines = [line(JA_A, 10, 13), line(JA_B, 16, 19)]
    const words = [...fill(JA_A, 10, 15.2), ...fill(JA_B, 16, 19)]
    const out = applyLabelHonesty({
      lines,
      lineTexts: lines.map((l) => l.original),
      quality: ['good', 'good'],
      words,
      mode: 'content',
    })
    expect(out[0]).toBe('approximate')
    expect(out[1]).toBe('good')
  })

  it('keeps good when the apparent overhang collides with the next line evidence (attribution noise)', () => {
    // The next line's own evidence begins where the overhang would be — the
    // overhang is shared/ambiguous audio, not a provably clipped tail.
    const lines = [line(JA_A, 10, 13), line(JA_B, 13, 16)]
    const words = [...fill(JA_A, 10, 14.4), ...fill(JA_B, 13.9, 16)]
    const out = applyLabelHonesty({
      lines,
      lineTexts: lines.map((l) => l.original),
      quality: ['good', 'good'],
      words,
      mode: 'content',
    })
    expect(out[0]).toBe('good')
  })

  it('downgrades a mid-sheet repeated line that stole a sibling occurrence next to an evidence desert', () => {
    // The hook repeats 3x in the sheet but the transcript only carries two sung
    // occurrences — the last one was never transcribed (hole). The middle claim
    // (#3) sits 'good' on the second sung occurrence, which by sheet order
    // should belong to the LAST sibling; its neighbours are an evidence desert.
    // Order-consistent first claims keep good; the contested middle one reads
    // approximate. Mirrors stranger-than-heaven #51 (labeled good, 38s off).
    const HOOK = 'ストレンジャーザンヘブンよ'
    const lines = [
      line(HOOK, 10, 13), // #0 first occurrence: claims earliest evidence -> keeps good
      line(JA_B, 14, 15), // desert (needs_review)
      line(JA_C, 15, 16), // desert (needs_review)
      line(HOOK, 40, 43), // #3 middle occurrence: claims the 40s occurrence -> contested
      line(JA_A, 50, 55), // anchored unique line
      line(HOOK, 56, 58), // #5 last occurrence: its true audio was never transcribed
    ]
    const words = [
      ...fill(HOOK, 10, 13),
      ...fill(HOOK, 40, 43),
      ...fill(JA_A, 50, 55),
    ]
    const out = applyLabelHonesty({
      lines,
      lineTexts: lines.map((l) => l.original),
      quality: ['good', 'needs_review', 'needs_review', 'good', 'good', 'needs_review'],
      words,
      mode: 'content',
    })
    expect(out[0]).toBe('good')
    expect(out[3]).toBe('approximate')
    expect(out[4]).toBe('good')
    expect(out[5]).toBe('needs_review')
  })

  it('never upgrades and never touches needs_review or approximate labels', () => {
    const lines = [line(JA_A, 0, 2), line(JA_B, 2, 4), line(JA_C, 4, 6)]
    const out = applyLabelHonesty({
      lines,
      lineTexts: lines.map((l) => l.original),
      quality: ['needs_review', 'approximate', 'needs_review'],
      words: [{ word: JA_A + JA_B + JA_C, startTime: 0, endTime: 6 }],
      mode: 'proportional',
    })
    expect(out).toEqual(['needs_review', 'approximate', 'needs_review'])
  })
})
