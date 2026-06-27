import { describe, it, expect, vi, beforeEach } from 'vitest'

global.fetch = vi.fn()
const mockFetch = (value: unknown) => vi.mocked(fetch).mockResolvedValue(value as Response)

import { fetchYouTubeMeta, extractVideoId, cleanTitle, parseArtistTitle, resolveYouTubeVideoId } from '../../src/sources/youtube'
import type { Song } from '../../src/core/types'

describe('extractVideoId', () => {
  it('extracts from standard URL', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('extracts from short URL', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('extracts from Shorts URL', () => {
    expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('extracts from embed URL', () => {
    expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('returns null for non-YouTube URL', () => {
    expect(extractVideoId('https://spotify.com/track/xyz')).toBeNull()
  })
})

describe('resolveYouTubeVideoId', () => {
  it('reads from sourceUrl', () => {
    const song = {
      sourceUrl: 'https://www.youtube.com/watch?v=abc123',
    } as Song
    expect(resolveYouTubeVideoId(song)).toBe('abc123')
  })

  it('falls back to unified sources when sourceUrl is absent', () => {
    const song = {
      sources: [{ provider: 'youtube', ref: 'xyz789', hasAudio: false }],
    } as Song
    expect(resolveYouTubeVideoId(song)).toBe('xyz789')
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
    expect(meta.thumbnailUrl).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })

  it('throws an actionable message on non-YouTube URL', async () => {
    await expect(fetchYouTubeMeta('https://spotify.com')).rejects.toThrow(/youtube\.com or youtu\.be/)
  })

  it('throws an actionable message when the video is private/embedding-disabled', async () => {
    mockFetch({ ok: false, status: 401 })
    await expect(fetchYouTubeMeta('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .rejects.toThrow(/private or has embedding disabled/)
  })

  it('throws an actionable message when the video is not found', async () => {
    mockFetch({ ok: false, status: 404 })
    await expect(fetchYouTubeMeta('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .rejects.toThrow(/removed or the link is incorrect/)
  })

  it('throws an actionable message on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchYouTubeMeta('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .rejects.toThrow(/check your connection/i)
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
