// tests/sources/songBuilder.test.ts
import { describe, it, expect } from 'vitest'
import { buildSong, linesFromPlainText } from '../../src/sources/songBuilder'

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
