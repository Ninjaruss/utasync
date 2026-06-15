// tests/lyrics/subtitle-parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseSubtitle } from '../../src/lyrics/subtitle-parser'

describe('parseSubtitle', () => {
  it('parses SRT (comma ms, strips cue index)', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,500\nHello world\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line'
    const lines = parseSubtitle(srt, 'lyrics.srt')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ startTime: 1, endTime: 3.5, original: 'Hello world', translation: '' })
    expect(lines[1].startTime).toBe(4)
  })

  it('parses VTT (dot ms, WEBVTT header, inline tags)', () => {
    const vtt = 'WEBVTT\n\n00:00:02.000 --> 00:00:05.000\n<v Singer>Konnichiwa</v>'
    const lines = parseSubtitle(vtt, 'cap.vtt')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ startTime: 2, endTime: 5, original: 'Konnichiwa' })
  })

  it('collapses multi-line cues into one line', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nline a\nline b'
    expect(parseSubtitle(srt, 'x.srt')[0].original).toBe('line a line b')
  })

  it('delegates .lrc to parseLRC', () => {
    const lrc = '[00:01.00]Hello\n[00:03.00]World'
    const lines = parseSubtitle(lrc, 'song.lrc')
    expect(lines[0]).toMatchObject({ startTime: 1, original: 'Hello' })
  })

  it('falls back to plain text for unknown extensions', () => {
    const lines = parseSubtitle('raw line one\nraw line two', 'notes.txt')
    expect(lines).toEqual([
      { startTime: 0, endTime: 0, original: 'raw line one', translation: '' },
      { startTime: 0, endTime: 0, original: 'raw line two', translation: '' },
    ])
  })
})
