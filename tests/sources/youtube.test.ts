import { describe, it, expect, vi, beforeEach } from 'vitest'

global.fetch = vi.fn()
const mockFetch = (value: unknown) => vi.mocked(fetch).mockResolvedValue(value as Response)

import { fetchYouTubeMeta, extractVideoId, cleanTitle, parseArtistTitle } from '../../src/sources/youtube'

describe('extractVideoId', () => {
  it('extracts from standard URL', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('extracts from short URL', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('returns null for non-YouTube URL', () => {
    expect(extractVideoId('https://spotify.com/track/xyz')).toBeNull()
  })
})

describe('fetchYouTubeMeta', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('parses artist and cleaned title from "Artist - Title" videos', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)', author_name: 'RickAstleyVEVO' }),
    })
    const meta = await fetchYouTubeMeta('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(meta.title).toBe('Never Gonna Give You Up')
    expect(meta.artist).toBe('Rick Astley')
    expect(meta.rawTitle).toBe('Rick Astley - Never Gonna Give You Up (Official Music Video)')
  })

  it('throws on non-YouTube URL', async () => {
    await expect(fetchYouTubeMeta('https://spotify.com')).rejects.toThrow('Not a YouTube URL')
  })
})

describe('cleanTitle', () => {
  it('strips official/video/lyric noise', () => {
    expect(cleanTitle('Song Name (Official Video)')).toBe('Song Name')
    expect(cleanTitle('Song Name [MV]')).toBe('Song Name')
    expect(cleanTitle('Song Name (Lyrics)')).toBe('Song Name')
    expect(cleanTitle('Song Name (Official Music Video) [4K]')).toBe('Song Name')
  })
})

describe('parseArtistTitle', () => {
  it('splits on the first dash', () => {
    expect(parseArtistTitle('YOASOBI - 群青 (Official)', 'Ayase'))
      .toEqual({ artist: 'YOASOBI', title: '群青' })
  })
  it('falls back to channel name when no dash, stripping VEVO/Topic', () => {
    expect(parseArtistTitle('群青', 'YOASOBI - Topic'))
      .toEqual({ artist: 'YOASOBI', title: '群青' })
    expect(parseArtistTitle('Some Song', 'ArtistVEVO'))
      .toEqual({ artist: 'Artist', title: 'Some Song' })
  })
})
