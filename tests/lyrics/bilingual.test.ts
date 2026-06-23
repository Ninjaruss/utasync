import { describe, it, expect } from 'vitest'
import {
  detectLanguage, attachSecondLanguage, isSameText, pairsToTimedLines,
  hasVisibleTranslation, stripNonLyricLines, extractSecondLanguageBlocks,
  normalizeTranslationLines, mergeTimedTracks, extractTranslationsForAttach,
  buildSecondaryTimedFromPairing, mergeSecondLanguageTimeline,
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

describe('extractTranslationsForAttach', () => {
  it('preserves blank-line stanza blocks instead of flattening to one list', () => {
    const text = 'Line A1\nLine A2\n\nLine B1\nLine B2'
    expect(extractTranslationsForAttach(text, 10)).toEqual(['Line A1', 'Line A2', 'Line B1', 'Line B2'])
  })
})

describe('normalizeTranslationLines', () => {
  it('splits a single pasted paragraph into sentences when primary has many lines', () => {
    const block = [
      "If possible, I'd like to repaint the world. It's nothing outrageous like ending wars. Rolling, rolling.",
    ]
    const lines = normalizeTranslationLines(block, 12)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('repaint the world')
    expect(lines[2]).toBe('Rolling, rolling.')
  })

  it('flattens embedded newlines inside one pasted row', () => {
    expect(normalizeTranslationLines(['Line one\nLine two'], 5)).toEqual(['Line one', 'Line two'])
  })

  it('leaves already-split lines unchanged', () => {
    const lines = ['A', 'B', 'C']
    expect(normalizeTranslationLines(lines, 3)).toEqual(lines)
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

  it('times plain translation to primary song timestamps when line counts match', () => {
    const result = attachSecondLanguage(primary, 'Your eyes\nIn the night')
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
    expect(result.lines[0].original).toBe('君の瞳')
    expect(result.lines[0].startTime).toBe(1)
    expect(result.mismatchedBlocks).toEqual([])
  })

  it('pairs mixed-script primaries to two translation lines per row when timed', () => {
    const mixed: TimedLine[] = [
      { original: 'You always make me so happy 青空に溶けて', startTime: 1, endTime: 5, translation: '' },
      { original: 'ねえ いつか', startTime: 5, endTime: 7, translation: '' },
    ]
    const secondary = 'You always make me so happy\nMelt into the blue sky\nHey, someday'
    const result = attachSecondLanguage(mixed, secondary)
    expect(result.mismatchedBlocks).toEqual([])
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].translation).toBe('You always make me so happy\nMelt into the blue sky')
    expect(result.lines[0].startTime).toBe(1)
    expect(result.lines[1].translation).toBe('Hey, someday')
  })

  it('merges synced LRC by song timeline, not primary line index', () => {
    const lrc = '[00:01.00]Your eyes\n[00:03.00]In the night'
    const result = attachSecondLanguage(primary, lrc)
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
    expect(result.mismatchedBlocks).toEqual([])
  })

  it('times plain translation across the song span when primary is timed and counts differ', () => {
    const result = attachSecondLanguage(primary, 'Only one line')
    expect(result.mismatchedBlocks).toEqual([])
    expect(result.lines.some((l) => l.translation === 'Only one line')).toBe(true)
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

  it('merges independently timed tracks when breakpoints differ', () => {
    const primary: TimedLine[] = [line('君の瞳', 1, 3), line('夜の中', 5, 7)]
    const secondary: TimedLine[] = [
      { original: '', translation: 'Your eyes', startTime: 1, endTime: 4 },
      { original: '', translation: 'In the night', startTime: 4, endTime: 7 },
    ]
    const merged = mergeTimedTracks(primary, secondary)
    expect(merged.some((l) => l.original === '君の瞳' && l.translation === 'Your eyes')).toBe(true)
    expect(merged.some((l) => l.original === '夜の中' && l.translation === 'In the night')).toBe(true)
  })

  it('does not repeat one translation on every primary breakpoint', () => {
    const primary: TimedLine[] = [line('君の瞳', 1, 3), line('夜の中', 3, 5)]
    const secondary: TimedLine[] = [
      { original: '', translation: 'Only one line', startTime: 1, endTime: 5 },
    ]
    const merged = mergeTimedTracks(primary, secondary)
    expect(merged.filter((l) => l.translation === 'Only one line')).toHaveLength(1)
  })

  it('collapses consecutive rows that repeat the same primary line', () => {
    const primary: TimedLine[] = [line('君の孤独も全て暴き出す朝だ', 10, 40)]
    const secondary: TimedLine[] = [
      { original: '', translation: 'Line A', startTime: 10, endTime: 15 },
      { original: '', translation: 'Line B', startTime: 15, endTime: 20 },
      { original: '', translation: 'Line C', startTime: 20, endTime: 25 },
    ]
    const merged = mergeTimedTracks(primary, secondary)
    expect(merged.filter((l) => l.original === '君の孤独も全て暴き出す朝だ')).toHaveLength(1)
    expect(merged[0].translation).toBe('Line A')
  })

  it('keeps row layout when timed primary and translation counts match', () => {
    const result = attachSecondLanguage(primary, 'Your eyes\nIn the night')
    expect(result.lines).toHaveLength(2)
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
  })

  it('flags mismatch only when primary is untimed and line counts differ', () => {
    const untimed: TimedLine[] = [line('君の瞳'), line('夜の中')]
    const result = attachSecondLanguage(untimed, 'Only one line')
    expect(result.mismatchedBlocks).toEqual([0])
    expect(result.lines.length).toBe(untimed.length)
  })
})

describe('buildSecondaryTimedFromPairing', () => {
  it('assigns each paired translation the primary row timestamps', () => {
    const primary: TimedLine[] = [
      line('君の瞳', 1, 3),
      line('夜の中', 3, 5),
    ]
    const paired: TimedLine[] = [
      { ...primary[0], translation: 'Your eyes' },
      { ...primary[1], translation: 'In the night' },
    ]
    const timed = buildSecondaryTimedFromPairing(primary, paired)
    expect(timed).toEqual([
      { startTime: 1, endTime: 3, original: '', translation: 'Your eyes' },
      { startTime: 3, endTime: 5, original: '', translation: 'In the night' },
    ])
  })

  it('preserves newline-joined slot translations on one timed row', () => {
    const primary: TimedLine[] = [line('mixed', 1, 5)]
    const paired: TimedLine[] = [{
      ...primary[0],
      translation: 'English half\nJapanese half',
    }]
    expect(buildSecondaryTimedFromPairing(primary, paired)[0].translation)
      .toBe('English half\nJapanese half')
  })
})

describe('mergeSecondLanguageTimeline', () => {
  it('union-merges timed primary with proportionally timed plain text when pairing is untrusted', () => {
    const primary: TimedLine[] = [line('君の瞳', 1, 3), line('夜の中', 3, 5)]
    const paired = primary.map((l) => ({ ...l, translation: '' }))
    const merged = mergeSecondLanguageTimeline(primary, 'Only one line', paired, ['Only one line'], [], false)
    expect(merged.some((l) => l.translation === 'Only one line')).toBe(true)
    expect(merged.some((l) => l.original === '君の瞳')).toBe(true)
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

  it('clears tokens when translation changes so word-pair coloring re-runs', () => {
    const existing: TimedLine[] = [{
      original: '君',
      startTime: 0,
      endTime: 1,
      translation: '',
      tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }],
    }]
    const result = pairsToTimedLines(existing, [{ original: '君', translation: 'you' }])
    expect(result[0].translation).toBe('you')
    expect(result[0].tokens).toBeUndefined()
  })
})
