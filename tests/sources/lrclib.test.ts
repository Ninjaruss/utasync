import { describe, it, expect, vi, beforeEach } from 'vitest'

global.fetch = vi.fn()
const mockFetch = (value: unknown) => vi.mocked(fetch).mockResolvedValue(value as Response)

import { searchLRCLIB, fetchLRCFromLRCLIB, findSecondLanguageInLRCLIB } from '../../src/sources/lrclib'

describe('searchLRCLIB', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('returns parsed TimedLine[] on success', async () => {
    mockFetch({
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
    mockFetch({ ok: false, status: 404 })
    const results = await searchLRCLIB('Unknown', 'Unknown')
    expect(results).toEqual([])
  })
})

describe('findSecondLanguageInLRCLIB', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('picks a result whose script differs from the primary language', async () => {
    mockFetch({
      ok: true,
      json: async () => ([
        { id: 1, name: 'Song', artistName: 'A', syncedLyrics: '[00:01.00]君の瞳' }, // ja
        { id: 2, name: 'Song', artistName: 'A', syncedLyrics: '[00:01.00]Your eyes' }, // en
      ]),
    })
    const result = await findSecondLanguageInLRCLIB('Song', 'A', 'ja')
    expect(result).not.toBeNull()
    expect(result!.lrc).toContain('Your eyes')
    expect(result!.synced).toBe(true)
  })

  it('returns null when every result is the same language as the primary', async () => {
    mockFetch({
      ok: true,
      json: async () => ([
        { id: 1, name: 'Song', artistName: 'A', syncedLyrics: '[00:01.00]君の瞳' },
      ]),
    })
    const result = await findSecondLanguageInLRCLIB('Song', 'A', 'ja')
    expect(result).toBeNull()
  })

  it('skips results whose duration is far from the target', async () => {
    mockFetch({
      ok: true,
      json: async () => ([
        { id: 1, name: 'Song', artistName: 'A', duration: 60, syncedLyrics: 'Wrong song English' },
        { id: 2, name: 'Song', artistName: 'A', duration: 240, syncedLyrics: 'Correct English' },
      ]),
    })
    const result = await findSecondLanguageInLRCLIB('Song', 'A', 'ja', 241)
    expect(result?.lrc).toBe('Correct English')
  })
})

describe('fetchLRCFromLRCLIB', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('returns synced lyrics string', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        syncedLyrics: '[00:01.00]Hello world\n[00:03.00]Goodbye world',
      }),
    })
    const lrc = await fetchLRCFromLRCLIB('Test Song', 'Test Artist')
    expect(lrc).toContain('[00:01.00]')
  })

  it('returns null when no synced lyrics', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ syncedLyrics: null, plainLyrics: 'Hello world' }),
    })
    const lrc = await fetchLRCFromLRCLIB('Test Song', 'Test Artist')
    expect(lrc).toBeNull()
  })
})
