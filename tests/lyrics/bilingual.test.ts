import { describe, it, expect } from 'vitest'
import { detectLanguage, attachSecondLanguage, isSameText } from '../../src/lyrics/bilingual'
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

describe('attachSecondLanguage', () => {
  const primary: TimedLine[] = [line('君の瞳', 1, 3), line('夜の中', 3, 5)]

  it('pairs plain second-language text by index', () => {
    const result = attachSecondLanguage(primary, 'Your eyes\nIn the night')
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
    // primary timing/text preserved
    expect(result.lines[0].original).toBe('君の瞳')
    expect(result.lines[0].startTime).toBe(1)
    expect(result.needsAlignment).toBe(false)
  })

  it('pairs a synced second-language LRC by timestamp', () => {
    const lrc = '[00:01.00]Your eyes\n[00:03.00]In the night'
    const result = attachSecondLanguage(primary, lrc)
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
    expect(result.needsAlignment).toBe(false)
  })

  it('signals needsAlignment when line counts differ', () => {
    const result = attachSecondLanguage(primary, 'Only one line')
    expect(result.needsAlignment).toBe(true)
    // still returns a best-effort pairing for the editor to start from
    expect(result.lines.length).toBe(primary.length)
  })

  it('ignores blank lines in the pasted block', () => {
    const result = attachSecondLanguage(primary, 'Your eyes\n\n\nIn the night\n')
    expect(result.needsAlignment).toBe(false)
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
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
