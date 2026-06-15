import { describe, it, expect, vi, beforeEach } from 'vitest'

global.fetch = vi.fn()

import { fetchYouTubeMeta, extractVideoId } from '../../src/sources/youtube'

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

  it('returns title and author from oEmbed', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ title: 'Rick Astley - Never Gonna Give You Up', author_name: 'RickAstleyVEVO' }),
    })
    const meta = await fetchYouTubeMeta('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(meta.title).toBe('Rick Astley - Never Gonna Give You Up')
    expect(meta.artist).toBe('RickAstleyVEVO')
  })

  it('throws on non-YouTube URL', async () => {
    await expect(fetchYouTubeMeta('https://spotify.com')).rejects.toThrow('Not a YouTube URL')
  })
})
