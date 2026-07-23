// tests/sources/songBuilder.test.ts
import { describe, it, expect } from 'vitest'
import { buildSong, linesFromPlainText, linesFromPaste, pastedLrcTimedLines } from '../../src/sources/songBuilder'

describe('buildSong', () => {
  it('applies defaults and passes through fields', () => {
    const song = buildSong({ title: 'T', artist: 'A', lines: [] })
    expect(song.title).toBe('T')
    expect(song.artist).toBe('A')
    expect(song.lyrics.alignmentMode).toBe('manual')
    expect(song.lyrics.sourceLanguage).toBe('ja')
    expect(song.lyrics.translationLanguage).toBe('en')
    expect(typeof song.id).toBe('string')
    expect(song.createdAt).toBeInstanceOf(Date)
  })

  it('reuses a provided id', () => {
    const song = buildSong({ id: 'fixed-id', title: 'T', artist: 'A', lines: [], audioStoredPath: 'songs/fixed-id.mp3' })
    expect(song.id).toBe('fixed-id')
    expect(song.audioStoredPath).toBe('songs/fixed-id.mp3')
  })

  it('passes through albumArtUrl', () => {
    const song = buildSong({
      title: 'T',
      artist: 'A',
      lines: [],
      albumArtUrl: 'https://example.com/cover.jpg',
    })
    expect(song.albumArtUrl).toBe('https://example.com/cover.jpg')
  })
})

describe('linesFromPlainText', () => {
  it('splits, trims, drops blanks, yields untimed lines', () => {
    const lines = linesFromPlainText('  hello \n\n  world  \n')
    expect(lines).toEqual([
      { startTime: 0, endTime: 0, original: 'hello', translation: '' },
      { startTime: 0, endTime: 0, original: 'world', translation: '' },
    ])
  })
})

describe('linesFromPaste', () => {
  const lrc = '[00:03.72](Giga, TeddyLoid)\n[00:06.76]Transforming\n[00:10.08]ゼロ戻り'

  it('uses the LRC times when the paste is timed', () => {
    const lines = linesFromPaste(lrc)
    expect(lines.map((l) => l.original)).toEqual(['(Giga, TeddyLoid)', 'Transforming', 'ゼロ戻り'])
    expect(lines[0].startTime).toBeCloseTo(3.72)
    expect(lines[1].startTime).toBeCloseTo(6.76)
    expect(lines.every((l) => l.startTime > 0)).toBe(true)
  })

  it('falls back to plain text (t=0) when the paste is not timed', () => {
    const lines = linesFromPaste('first line\nsecond line')
    expect(lines.map((l) => l.original)).toEqual(['first line', 'second line'])
    expect(lines.every((l) => l.startTime === 0)).toBe(true)
  })

  it('honors ignoreLrcTimings by resolving a timed paste as plain text', () => {
    const lines = linesFromPaste(lrc, { ignoreLrcTimings: true })
    expect(lines.every((l) => l.startTime === 0)).toBe(true)
    expect(lines.map((l) => l.original)).toEqual(['(Giga, TeddyLoid)', 'Transforming', 'ゼロ戻り'])
  })

  it('falls back to plain text when timing is only partial (fewer timed than plain lines)', () => {
    const partial = '[00:01.00]intro\n[00:02.00]hook\nplain three\nplain four\nplain five'
    const lines = linesFromPaste(partial)
    expect(lines.length).toBe(5)
    expect(lines.every((l) => l.startTime === 0)).toBe(true)
  })
})

describe('pastedLrcTimedLines', () => {
  it('returns the timed lines for a fully timed LRC', () => {
    const lines = pastedLrcTimedLines('[00:03.72]a\n[00:06.76]b\n[00:10.08]c')
    expect(lines?.map((l) => l.original)).toEqual(['a', 'b', 'c'])
    expect(lines?.every((l) => l.startTime > 0)).toBe(true)
  })
  it('returns null for plain text', () => {
    expect(pastedLrcTimedLines('one\ntwo\nthree')).toBeNull()
  })
  it('returns null when timing is only partial (would fall back to plain text)', () => {
    expect(pastedLrcTimedLines('[00:01.00]intro\n[00:02.00]hook\nplain three\nplain four\nplain five')).toBeNull()
  })
  it('strips inline furigana on the timed path (consistent with plain text)', () => {
    const lines = pastedLrcTimedLines('[00:01.00]君(きみ)の名前\n[00:02.00]普通の歌詞')
    expect(lines?.map((l) => l.original)).toEqual(['君の名前', '普通の歌詞'])
  })
})
