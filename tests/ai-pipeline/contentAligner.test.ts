import { describe, it, expect } from 'vitest'
import { normalizeForMatch, alignByContent } from '../../src/ai-pipeline/contentAligner'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

describe('normalizeForMatch', () => {
  it('keeps lowercase latin and Japanese, drops spaces/punctuation', () => {
    expect(normalizeForMatch('You always make me')).toBe('youalwaysmakeme')
    expect(normalizeForMatch('「どうした？」なんて')).toBe('どうしたなんて')
    expect(normalizeForMatch('I promise, for my eyes only!')).toBe('ipromiseformyeyesonly')
  })
})

describe('alignByContent (exact match)', () => {
  it('anchors each line to the real timestamp of its matched words', () => {
    const lines = ['あおぞら', 'ゆきがふる']
    const words: TranscriptWord[] = [
      { word: 'あ', startTime: 1, endTime: 1.4 },
      { word: 'お', startTime: 1.4, endTime: 1.8 },
      { word: 'ぞ', startTime: 1.8, endTime: 2.2 },
      { word: 'ら', startTime: 2.2, endTime: 2.6 },
      { word: 'ゆ', startTime: 10, endTime: 10.4 },
      { word: 'き', startTime: 10.4, endTime: 10.8 },
      { word: 'が', startTime: 10.8, endTime: 11.2 },
      { word: 'ふ', startTime: 11.2, endTime: 11.6 },
      { word: 'る', startTime: 11.6, endTime: 12 },
    ]
    const { lines: out, confidence } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBeGreaterThanOrEqual(1)
    expect(out[0].startTime).toBeLessThan(2)
    expect(out[1].startTime).toBeGreaterThanOrEqual(10)
    expect(out[1].startTime).toBeLessThan(11)
    expect(confidence).toBeGreaterThan(0.9)
  })

  it('reports low confidence when nothing matches', () => {
    const lines = ['あおぞら']
    const words: TranscriptWord[] = [{ word: 'zzz', startTime: 1, endTime: 2 }]
    const { confidence } = alignByContent(lines, words, undefined, 'ja')
    expect(confidence).toBeLessThan(0.2)
  })
})

describe('alignByContent (spurious single-char matches)', () => {
  it('does not anchor a line to an isolated single-character coincidence', () => {
    // Line 1 is a single common particle with nothing else around it in the
    // lyric — any match for it is, by definition, a 1-character coincidence,
    // not real evidence of where it's sung. Line 2's real words appear later,
    // together, at 30s. Pre-fix, anchorsByLine took *any* matched char as the
    // line's anchor, so line 1 would pin to wherever 'は' happened to LCS-match
    // (here, the earliest occurrence at 2s) — implying the line starts playing
    // during unrelated audio. It should instead have no reliable anchor and
    // fall back to interpolation (0, since it's the leading unanchored line).
    const lines = ['は', 'ねこ']
    const words: TranscriptWord[] = [
      { word: 'は', startTime: 2, endTime: 2.4 }, // coincidental, not line 1's real audio
      { word: 'ねこ', startTime: 30, endTime: 30.8 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[0].startTime).toBe(0)
    expect(out[1].startTime).toBeGreaterThanOrEqual(30)
  })

  it('still anchors a short line when its match is a contiguous multi-char run', () => {
    const lines = ['は', 'ねこは']
    const words: TranscriptWord[] = [
      { word: 'は', startTime: 2, endTime: 2.4 }, // coincidental, ignored
      { word: 'ねこ', startTime: 30, endTime: 30.8 },
      { word: 'は', startTime: 30.8, endTime: 31.2 }, // contiguous with 'ねこ' above — real run
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    expect(out[1].startTime).toBeGreaterThanOrEqual(30)
  })
})

describe('alignByContent (repeated lines)', () => {
  it('does not place a later repeated line earlier than a previous line', () => {
    // "ねえ" appears 3 times; the transcript has them at 5s, 50s, 90s.
    const lines = ['ねえ', 'そら', 'ねえ', 'うみ', 'ねえ']
    const words: TranscriptWord[] = [
      { word: 'ねえ', startTime: 5, endTime: 6 },
      { word: 'そら', startTime: 20, endTime: 21 },
      { word: 'ねえ', startTime: 50, endTime: 51 },
      { word: 'うみ', startTime: 70, endTime: 71 },
      { word: 'ねえ', startTime: 90, endTime: 91 },
    ]
    const { lines: out } = alignByContent(lines, words, undefined, 'ja')
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    }
    expect(out[4].startTime).toBeGreaterThan(out[3].startTime)
  })
})
