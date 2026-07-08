import { describe, it, expect } from 'vitest'
import { findRepeatedStanzas, realignRepeatedStanzaOccurrences } from '../../src/lyrics/repeatedStanzaAlignment'
import type { TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

describe('findRepeatedStanzas', () => {
  it('finds a 4-line chorus that repeats', () => {
    const lines = [
      'A', 'B', 'C', 'D',
      'x', 'y',
      'A', 'B', 'C', 'D',
    ]
    const stanzas = findRepeatedStanzas(lines)
    expect(stanzas.some((s) => s.lines.join() === 'A,B,C,D' && s.occurrences.length === 2)).toBe(true)
  })

  it('prefers longer non-overlapping stanzas', () => {
    const lines = ['ローリング ローリング', 'a', 'ローリング ローリング', 'b']
    const stanzas = findRepeatedStanzas(lines)
    expect(stanzas.length).toBeGreaterThan(0)
    expect(stanzas[0].lines[0]).toBe('ローリング ローリング')
  })
})

describe('realignRepeatedStanzaOccurrences', () => {
  it('uses reference timing for a weak third occurrence', () => {
    const lineTexts = [
      'ローリング ローリング',
      'tail one',
      'ローリング ローリング',
      'tail two',
      'ローリング ローリング',
      'tail three',
    ]
    const lines: TimedLine[] = lineTexts.map((original, i) => ({
      original,
      translation: '',
      startTime: i === 0 ? 10 : i === 1 ? 12 : i === 2 ? 30 : i === 3 ? 32 : i === 4 ? 50 : 52,
      endTime: i === 0 ? 12 : i === 1 ? 14 : i === 2 ? 31 : i === 3 ? 33 : i === 4 ? 51 : 53,
    }))
    const words: TranscriptWord[] = [
      { word: 'ローリング', startTime: 10, endTime: 12 },
      { word: 'tail', startTime: 12, endTime: 14 },
      { word: 'noise', startTime: 28, endTime: 29 },
      { word: 'tail', startTime: 34, endTime: 36 },
      { word: 'noise', startTime: 48, endTime: 49 },
      { word: 'tail', startTime: 54, endTime: 56 },
    ]
    const out = realignRepeatedStanzaOccurrences(lines, words, lineTexts, 'ja')
    expect(out[4].endTime - out[4].startTime).toBeGreaterThan(0.8)
    expect(out[4].startTime).toBeGreaterThanOrEqual(out[3].endTime - 0.1)
  })
})

describe('findRepeatedStanzas — fuzzy variants', () => {
  it('groups a chorus whose repeat differs only by parenthetical ad-libs', () => {
    const sheet = [
      'I found a place that I can call home',
      'Tested my fate, took all my pain and made a weapon',
      'Stranger than heaven',
      'bridge line one',
      'bridge line two',
      'I found a place that I can call home (Ah)',
      'Tested my fate (Tested my fate), took all my pain and made a weapon',
      'Stranger than heaven',
    ]
    const stanzas = findRepeatedStanzas(sheet)
    const chorus = stanzas.find((s) => s.occurrences.includes(0))
    expect(chorus).toBeDefined()
    expect(chorus!.occurrences).toEqual([0, 5])
    expect(chorus!.lines.length).toBe(3)
  })

  it('does not group genuinely different lines', () => {
    const sheet = [
      'I found a place that I can call home',
      'a completely different lyric line here',
      'I found a place that I can call home',
      'nothing like the second line at all',
    ]
    const stanzas = findRepeatedStanzas(sheet)
    // Only the identical single line repeats; the 2-line block must NOT match.
    for (const s of stanzas) expect(s.lines.length).toBe(1)
  })

  it('keeps verbatim detection unchanged', () => {
    const sheet = ['la la la', 'chorus a', 'chorus b', 'verse', 'chorus a', 'chorus b']
    const stanzas = findRepeatedStanzas(sheet)
    const block = stanzas.find((s) => s.lines.length === 2)
    expect(block?.occurrences).toEqual([1, 4])
  })

  it('does not group different pure-ad-lib lines that strip to empty', () => {
    const sheet = [
      '(Hey)',
      'verse line one here',
      'verse line two here',
      '(Woo)',
      'verse line three different',
    ]
    const stanzas = findRepeatedStanzas(sheet)
    expect(stanzas.find((s) => s.occurrences.includes(0) && s.occurrences.includes(3))).toBeUndefined()
  })

  it('still groups identical pure-ad-lib lines', () => {
    const sheet = ['(Hey)', 'verse line one here', '(Hey)', 'verse line two here']
    const stanzas = findRepeatedStanzas(sheet)
    expect(stanzas.find((s) => s.occurrences.includes(0) && s.occurrences.includes(2))).toBeDefined()
  })

  it('requires exact match for short lines (one-kana JA variants stay distinct)', () => {
    const sheet = ['きらきらひ', 'verse line one here', 'きらきらほ', 'verse line two here']
    const stanzas = findRepeatedStanzas(sheet)
    expect(stanzas.find((s) => s.occurrences.includes(0) && s.occurrences.includes(2))).toBeUndefined()
  })
})
