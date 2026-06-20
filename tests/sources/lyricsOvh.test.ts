import { describe, it, expect, vi, beforeEach } from 'vitest'

global.fetch = vi.fn()
const mockFetch = (value: unknown) => vi.mocked(fetch).mockResolvedValue(value as Response)

import { findSecondLanguageInLyricsOvh } from '../../src/sources/lyricsOvh'

describe('findSecondLanguageInLyricsOvh', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('returns English lyrics for a Japanese primary language song', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ lyrics: 'Your eyes only\nIn the night sky' }),
    })
    const result = await findSecondLanguageInLyricsOvh('My Song', 'Test Artist', 'ja')
    expect(result).not.toBeNull()
    expect(result!.lrc).toContain('Your eyes only')
    expect(result!.synced).toBe(false)
  })

  it('skips lyrics in the same language as the primary', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ lyrics: '君の瞳だけ\n夜の中で' }),
    })
    const attempts: Array<{ outcome: string }> = []
    const result = await findSecondLanguageInLyricsOvh(
      'Song',
      'Artist',
      'ja',
      (attempt) => attempts.push(attempt),
    )
    expect(result).toBeNull()
    expect(attempts.some((a) => a.outcome === 'wrong-language')).toBe(true)
  })

  it('reports not-found when the API returns 404', async () => {
    mockFetch({ ok: false, status: 404 })
    const attempts: Array<{ outcome: string }> = []
    await findSecondLanguageInLyricsOvh('Song', 'Artist', 'ja', (attempt) => attempts.push(attempt))
    expect(attempts.some((a) => a.outcome === 'error')).toBe(true)
  })

  it('uses suggest results when the title matches even if the artist differs', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ title: 'Your Affection', artist: { name: 'Shihoko Hirata' } }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ lyrics: 'Every time you look my way\nI feel my heart begin to sway' }),
      } as Response)

    const result = await findSecondLanguageInLyricsOvh('Your Affection', 'Shoji Meguro', 'ja')
    expect(result).not.toBeNull()
    expect(result!.lrc).toContain('Every time you look my way')
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(urls.some((url) => url.includes('Shihoko') && url.includes('Your%20Affection'))).toBe(true)
  })

  it('returns null when artist or title is blank', async () => {
    expect(await findSecondLanguageInLyricsOvh('', 'Artist', 'ja')).toBeNull()
    expect(await findSecondLanguageInLyricsOvh('Song', '  ', 'ja')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
