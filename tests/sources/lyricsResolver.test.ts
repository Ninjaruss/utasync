import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/sources/youtubeCaptions', () => ({
  fetchYouTubeCaptionLines: vi.fn(async () => null),
}))

vi.mock('../../src/sources/lrclib', () => ({
  findLyrics: vi.fn(async () => ({ lookup: null, outcome: 'no-entry' })),
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
    vi.mocked(findLyrics).mockResolvedValueOnce({
      lookup: {
        lrc: '[00:01.00]Line',
        synced: true,
        match: { track: 'Song', artist: 'Artist', matchScore: 0.99, matchKind: 'exact' },
      },
      outcome: 'found',
    })
    const result = await resolveLyricsForSong({
      title: 'Song',
      artist: 'Artist',
      videoId: 'vid123',
    })
    expect(result.source).toBe('lrclib-synced')
    expect(result.synced).toBe(true)
    expect(result.match?.track).toBe('Song')
  })

  it('skips YouTube when no video id', async () => {
    vi.mocked(findLyrics).mockResolvedValueOnce({ lookup: { lrc: 'plain', synced: false }, outcome: 'found' })
    const result = await resolveLyricsForSong({ title: 'Song', artist: 'Artist' })
    expect(fetchYouTubeCaptionLines).not.toHaveBeenCalled()
    expect(result.source).toBe('lrclib-plain')
  })
})

describe('resolveLyricsForSong — duration plumbing', () => {
  beforeEach(() => {
    vi.mocked(fetchYouTubeCaptionLines).mockReset()
    vi.mocked(findLyrics).mockReset()
  })

  /**
   * Regression: resolveLyricsForSong passed a literal `undefined` for
   * findLyrics' 4th parameter, so the duration term in lyricsMatchScore
   * (+0.15 within 2s, -0.25 for a big mismatch) never fired on the YouTube or
   * import paths. Nothing about the RETURNED lyrics reveals that, which is why
   * this asserts on the argument rather than the result.
   */
  it('forwards durationSec to findLyrics', async () => {
    await resolveLyricsForSong({ title: 'T', artist: 'A', durationSec: 230 })
    expect(vi.mocked(findLyrics).mock.calls[0][3]).toBe(230)
  })

  it('forwards undefined when no duration is known', async () => {
    await resolveLyricsForSong({ title: 'T', artist: 'A' })
    expect(vi.mocked(findLyrics).mock.calls[0][3]).toBeUndefined()
  })
})
