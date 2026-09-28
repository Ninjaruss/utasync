import { describe, it, expect } from 'vitest'
import { exportLRC, exportSRT, lineHasTiming } from '../../src/lyrics/exporter'
import { parseLRC } from '../../src/lyrics/lrc-parser'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 12.5, endTime: 15.2, original: '星に願いを', translation: 'Wish upon a star' },
  { startTime: 15.2, endTime: 18.9, original: '夢の中で', translation: 'In my dreams' },
]

/** Exactly what TapSyncEditor stores for a line the user never tapped. */
const untimed = (text: string): TimedLine => ({ startTime: 0, endTime: 0, original: text, translation: '' })

describe('lineHasTiming', () => {
  it('treats { 0, 0 } as untimed and keeps a first line that starts at 0 but ends later', () => {
    expect(lineHasTiming(untimed('x'))).toBe(false)
    expect(lineHasTiming({ startTime: 0, endTime: 30, original: 'x', translation: '' })).toBe(true)
    expect(lineHasTiming({ startTime: 12, endTime: 12, original: 'x', translation: '' })).toBe(true)
  })
})

describe('exportLRC', () => {
  it('produces valid LRC format', () => {
    const lrc = exportLRC(lines)
    expect(lrc).toContain('[00:12.50]')
    expect(lrc).toContain('星に願いを')
  })

  it('can export translation instead of original', () => {
    const lrc = exportLRC(lines, 'translation')
    expect(lrc).toContain('Wish upon a star')
  })
})

describe('exportLRC untimed lines', () => {
  // A 3-of-20 tap-through (TapSyncEditor "Save timing for 3 of 20") used to
  // export 20 lines, 17 of them stamped [00:00.00] — a file that looks valid,
  // loses the real order, and re-imports through our own parser as timing.
  it('omits untimed lines instead of stamping them [00:00.00]', () => {
    const tapped = [untimed('never tapped'), untimed('also never'), lines[0], untimed('third')]
    expect(exportLRC(tapped)).toBe('[00:12.50]星に願いを')
  })

  it('exports only the tapped lines of a mostly untimed song', () => {
    const tapped = [
      untimed('untimed one'),
      { startTime: 1, endTime: 2, original: 'tapped one', translation: '' },
      untimed('untimed two'),
      { startTime: 4, endTime: 5, original: 'tapped two', translation: '' },
      untimed('untimed three'),
      { startTime: 7, endTime: 8, original: 'tapped three', translation: '' },
    ]
    const lrc = exportLRC(tapped)
    expect(lrc.split('\n')).toHaveLength(3)
    expect(lrc).not.toContain('untimed')
    expect(lrc).not.toContain('[00:00.00]')
    // Round-trips through the app's own parser at the real times, no t=0 pile-up.
    expect(parseLRC(lrc).map((l) => l.startTime)).toEqual([1, 4, 7])
  })

  it('still exports a genuinely timed first line that starts at 0', () => {
    expect(exportLRC([{ startTime: 0, endTime: 30, original: 'first', translation: '' }])).toBe(
      '[00:00.00]first',
    )
  })

  it('returns an empty string when no line has timing at all', () => {
    expect(exportLRC([untimed('one'), untimed('two')])).toBe('')
  })
})

describe('exportSRT', () => {
  it('produces valid SRT format', () => {
    const srt = exportSRT(lines)
    expect(srt).toContain('1\n')
    expect(srt).toContain('00:00:12,500 --> 00:00:15,200')
    expect(srt).toContain('星に願いを')
  })

  it('omits untimed lines and numbers the cues that remain', () => {
    const srt = exportSRT([untimed('never tapped'), lines[0], untimed('also never'), lines[1]])
    expect(srt).not.toContain('00:00:00,000 --> 00:00:00,000')
    expect(srt).not.toContain('never tapped')
    expect(srt.startsWith('1\n00:00:12,500 --> 00:00:15,200')).toBe(true)
    expect(srt).toContain('2\n00:00:15,200 --> 00:00:18,900')
  })

  it('returns an empty string when no line has timing at all', () => {
    expect(exportSRT([untimed('one')])).toBe('')
  })
})

describe('timestamp rounding', () => {
  // The fraction fields are fixed-width by spec: a centisecond value of 100
  // (or a millisecond value of 1000) is not just ugly, it re-imports wrong —
  // lrc-parser reads the fraction by digit count, so ".100" meant 100 ms and
  // landed 0.899s early, and subtitle-parser only matches exactly 3 digits.
  const x = (startTime: number, endTime: number): TimedLine => ({
    startTime, endTime, original: 'x', translation: '',
  })

  it('carries a rounding centisecond into the seconds field', () => {
    expect(exportLRC([x(59.999, 61)])).toBe('[01:00.00]x')
    expect(exportLRC([x(12.9996, 14)])).toBe('[00:13.00]x')
    expect(exportLRC([x(100.999, 102)])).toBe('[01:41.00]x')
  })

  it('never writes a three-digit LRC fraction, and re-imports at the right time', () => {
    const lrc = exportLRC([x(59.999, 61)])
    expect(lrc).not.toMatch(/\.\d{3}\]/)
    expect(parseLRC(lrc)[0].startTime).toBe(60)
    // The value the old rounding produced, for contrast: 2 digits = hundredths.
    expect(parseLRC('[00:59.100]x')[0].startTime).toBe(59.1)
  })

  it('carries a rounding millisecond into the seconds field', () => {
    expect(exportSRT([x(0, 1.9996)])).toContain('00:00:00,000 --> 00:00:02,000')
    expect(exportSRT([x(59.999, 61)])).toContain('00:00:59,999 --> 00:01:01,000')
    expect(exportSRT([x(12.9996, 14)])).toContain('00:00:13,000 --> 00:00:14,000')
    expect(exportSRT([x(100.999, 102)])).toContain('00:01:40,999 --> 00:01:42,000')
  })

  it('never writes a ,1000 millisecond field', () => {
    for (const t of [59.999, 12.9996, 100.999]) {
      const srt = exportSRT([x(t, t + 1)])
      expect(srt).not.toContain(',1000')
      expect(srt).toMatch(/-->\s\d{2}:\d{2}:\d{2},\d{3}/)
    }
  })
})
