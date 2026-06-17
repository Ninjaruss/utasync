import { describe, it, expect } from 'vitest'
import {
  detectLanguage, attachSecondLanguage, isSameText, pairsToTimedLines,
  hasVisibleTranslation, stripNonLyricLines, extractSecondLanguageBlocks,
} from '../../src/lyrics/bilingual'
import type { TimedLine } from '../../src/core/types'

const line = (original: string, startTime = 0, endTime = 0, translation = ''): TimedLine =>
  ({ original, startTime, endTime, translation })

describe('detectLanguage', () => {
  it('detects Japanese from kana', () => {
    expect(detectLanguage('きみだけのまなざし')).toBe('ja')
  })
  it('detects Japanese from kanji', () => {
    expect(detectLanguage('君の瞳')).toBe('ja')
  })
  it('treats Latin-only text as other', () => {
    expect(detectLanguage('My Eyes Only')).toBe('other')
  })
  it('treats mixed JP+Latin as Japanese (kana present)', () => {
    expect(detectLanguage('君のeyes only')).toBe('ja')
  })
  it('treats empty as other', () => {
    expect(detectLanguage('   ')).toBe('other')
  })
})

describe('stripNonLyricLines', () => {
  it('removes bracketed and parenthesized headers', () => {
    expect(stripNonLyricLines(['[Chorus]', 'Real line', '(x2)', 'Another line']))
      .toEqual(['Real line', 'Another line'])
  })
  it('removes bare section labels', () => {
    expect(stripNonLyricLines(['Verse 1', 'A line', 'Chorus', 'Bridge:', 'Last line']))
      .toEqual(['A line', 'Last line'])
  })
  it('leaves real lyrics alone', () => {
    expect(stripNonLyricLines(['Your eyes', 'In the night'])).toEqual(['Your eyes', 'In the night'])
  })
})

describe('extractSecondLanguageBlocks', () => {
  it('groups plain text into blank-line-delimited blocks, stripping headers per block', () => {
    const text = '[Verse 1]\nYour eyes\nIn the night\n\n[Chorus]\nShine on\nForever'
    expect(extractSecondLanguageBlocks(text)).toEqual([
      ['Your eyes', 'In the night'],
      ['Shine on', 'Forever'],
    ])
  })
  it('collapses multiple consecutive blank lines into one separator', () => {
    const text = 'A\nB\n\n\n\nC\nD'
    expect(extractSecondLanguageBlocks(text)).toEqual([['A', 'B'], ['C', 'D']])
  })
  it('treats an LRC block as a single block', () => {
    const lrc = '[00:01.00]Your eyes\n[00:03.00]In the night'
    expect(extractSecondLanguageBlocks(lrc)).toEqual([['Your eyes', 'In the night']])
  })
})

describe('attachSecondLanguage', () => {
  const primary: TimedLine[] = [line('君の瞳', 1, 3), line('夜の中', 3, 5)]

  it('pairs plain second-language text by index', () => {
    const result = attachSecondLanguage(primary, 'Your eyes\nIn the night')
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
    expect(result.lines[0].original).toBe('君の瞳')
    expect(result.lines[0].startTime).toBe(1)
    expect(result.mismatchedBlocks).toEqual([])
  })

  it('pairs a synced second-language LRC by timestamp', () => {
    const lrc = '[00:01.00]Your eyes\n[00:03.00]In the night'
    const result = attachSecondLanguage(primary, lrc)
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
    expect(result.mismatchedBlocks).toEqual([])
  })

  it('flags a single whole-song mismatch when line counts differ and no block structure is detected', () => {
    const result = attachSecondLanguage(primary, 'Only one line')
    expect(result.mismatchedBlocks).toEqual([0])
    expect(result.lines.length).toBe(primary.length)
  })

  it('ignores blank lines in the pasted block when counts already match', () => {
    const result = attachSecondLanguage(primary, 'Your eyes\n\n\nIn the night\n')
    expect(result.mismatchedBlocks).toEqual([])
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
  })

  it('strips header lines before counting, turning a false mismatch into a clean match', () => {
    const result = attachSecondLanguage(primary, '[Verse]\nYour eyes\nIn the night')
    expect(result.mismatchedBlocks).toEqual([])
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
  })

  it('scopes a mismatch to one stanza block when both sides have matching multi-block structure', () => {
    // Primary: two stanzas with a >4s gap between them (stanza boundary).
    const multiStanzaPrimary: TimedLine[] = [
      line('一行目', 0, 2), line('二行目', 2, 4),
      line('三行目', 10, 12), line('四行目', 12, 14),
    ]
    // Secondary: stanza 1 matches (2 lines), stanza 2 is merged into one line.
    const secondary = 'Line one\nLine two\n\nLines three and four merged'
    const result = attachSecondLanguage(multiStanzaPrimary, secondary)
    expect(result.mismatchedBlocks).toEqual([1])
    expect(result.lines[0].translation).toBe('Line one')
    expect(result.lines[1].translation).toBe('Line two')
  })
})

describe('isSameText', () => {
  it('matches identical text', () => {
    expect(isSameText('Hello world', 'Hello world')).toBe(true)
  })
  it('ignores case and surrounding/inner whitespace', () => {
    expect(isSameText('  Hello   World ', 'hello world')).toBe(true)
  })
  it('treats distinct text as different', () => {
    expect(isSameText('Your eyes', '君の瞳')).toBe(false)
  })
  it('returns false when either side is empty or undefined', () => {
    expect(isSameText('', 'x')).toBe(false)
    expect(isSameText('x', undefined)).toBe(false)
    expect(isSameText(undefined, undefined)).toBe(false)
  })
})

describe('hasVisibleTranslation', () => {
  it('is true for a distinct translation', () => {
    expect(hasVisibleTranslation({ original: '君の瞳', translation: 'Your eyes' })).toBe(true)
  })
  it('is false when the translation duplicates the original', () => {
    expect(hasVisibleTranslation({ original: 'Hello', translation: 'hello' })).toBe(false)
  })
  it('is false when there is no translation', () => {
    expect(hasVisibleTranslation({ original: 'Hello', translation: '' })).toBe(false)
    expect(hasVisibleTranslation({ original: 'Hello' })).toBe(false)
  })
})

describe('pairsToTimedLines', () => {
  it('overlays original/translation by index, preserving existing timing', () => {
    const existing: TimedLine[] = [
      { original: '君の瞳', startTime: 1, endTime: 3, translation: '' },
      { original: '夜の中', startTime: 3, endTime: 5, translation: '' },
    ]
    const pairs = [
      { original: '君の瞳', translation: 'Your eyes' },
      { original: '夜の中', translation: 'In the night' },
    ]
    const result = pairsToTimedLines(existing, pairs)
    expect(result).toEqual([
      { original: '君の瞳', startTime: 1, endTime: 3, translation: 'Your eyes' },
      { original: '夜の中', startTime: 3, endTime: 5, translation: 'In the night' },
    ])
  })

  it('falls back to existing text when a pair is missing', () => {
    const existing: TimedLine[] = [{ original: 'a', startTime: 0, endTime: 1, translation: 'x' }]
    expect(pairsToTimedLines(existing, [])).toEqual([
      { original: 'a', startTime: 0, endTime: 1, translation: 'x' },
    ])
  })
})
