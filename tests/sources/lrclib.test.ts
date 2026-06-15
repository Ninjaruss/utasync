import { describe, it, expect, vi, beforeEach } from 'vitest'

global.fetch = vi.fn()

import { searchLRCLIB, fetchLRCFromLRCLIB } from '../../src/sources/lrclib'

describe('searchLRCLIB', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('returns parsed TimedLine[] on success', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ([{
        id: 1,
        name: 'Test Song',
        artistName: 'Test Artist',
        syncedLyrics: '[00:01.00]Hello world\n[00:03.00]Goodbye world',
      }]),
    })
    const results = await searchLRCLIB('Test Song', 'Test Artist')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].syncedLyrics).toContain('[00:01.00]')
  })

  it('returns empty array on fetch error', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 404 })
    const results = await searchLRCLIB('Unknown', 'Unknown')
    expect(results).toEqual([])
  })
})

describe('fetchLRCFromLRCLIB', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('returns synced lyrics string', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        syncedLyrics: '[00:01.00]Hello world\n[00:03.00]Goodbye world',
      }),
    })
    const lrc = await fetchLRCFromLRCLIB('Test Song', 'Test Artist')
    expect(lrc).toContain('[00:01.00]')
  })

  it('returns null when no synced lyrics', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ syncedLyrics: null, plainLyrics: 'Hello world' }),
    })
    const lrc = await fetchLRCFromLRCLIB('Test Song', 'Test Artist')
    expect(lrc).toBeNull()
  })
})
