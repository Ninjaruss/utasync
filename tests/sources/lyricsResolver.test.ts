import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/sources/youtubeCaptions', () => ({
  fetchYouTubeCaptionLines: vi.fn(async () => null),
}))

vi.mock('../../src/sources/lrclib', () => ({
  findLyrics: vi.fn(async () => null),
}))

import { resolveLyricsForSong } from '../../src/sources/lyricsResolver'
import { fetchYouTubeCaptionLines } from '../../src/sources/youtubeCaptions'
import { findLyrics } from '../../src/sources/lrclib'

describe('resolveLyricsForSong', () => {
  beforeEach(() => {
    vi.mocked(fetchYouTubeCaptionLines).mockReset()
    vi.mocked(findLyrics).mockReset()
  })

  it('uses YouTube captions when available', async () => {
    vi.mocked(fetchYouTubeCaptionLines).mockResolvedValueOnce([
      { startTime: 0, endTime: 2, original: 'Caption line', translation: '' },
    ])
    const result = await resolveLyricsForSong({
      title: 'Song',
      artist: 'Artist',
      videoId: 'vid123',
    })
    expect(result.source).toBe('youtube-captions')
    expect(result.synced).toBe(true)
    expect(findLyrics).not.toHaveBeenCalled()
  })

  it('falls back to synced LRCLIB when captions are missing', async () => {
    vi.mocked(fetchYouTubeCaptionLines).mockResolvedValueOnce(null)
    vi.mocked(findLyrics).mockResolvedValueOnce({ lrc: '[00:01.00]Line', synced: true })
    const result = await resolveLyricsForSong({
      title: 'Song',
      artist: 'Artist',
      videoId: 'vid123',
    })
    expect(result.source).toBe('lrclib-synced')
    expect(result.synced).toBe(true)
  })

  it('skips YouTube when no video id', async () => {
    vi.mocked(findLyrics).mockResolvedValueOnce({ lrc: 'plain', synced: false })
    const result = await resolveLyricsForSong({ title: 'Song', artist: 'Artist' })
    expect(fetchYouTubeCaptionLines).not.toHaveBeenCalled()
    expect(result.source).toBe('lrclib-plain')
  })
})
