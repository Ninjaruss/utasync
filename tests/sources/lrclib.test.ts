import { describe, it, expect, vi, beforeEach } from 'vitest'

global.fetch = vi.fn()
const mockFetch = (value: unknown) => vi.mocked(fetch).mockResolvedValue(value as Response)

import { searchLRCLIB, fetchLRCFromLRCLIB, findSecondLanguageInLRCLIB, findLyrics } from '../../src/sources/lrclib'

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

describe('findLyrics', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('picks the best fuzzy title match from search results', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/get')) {
        return { ok: false, status: 404 } as Response
      }
      return {
        ok: true,
        json: async () => ([
          { id: 1, name: 'Totally Different', artistName: 'Other', syncedLyrics: '[00:01.00]Wrong' },
          { id: 2, name: 'Blinding Lights', artistName: 'The Weeknd', syncedLyrics: '[00:01.00]Right song' },
        ]),
      } as Response
    })

    const result = await findLyrics('Blinding Lghts', 'The Weeknd')
    expect(result?.lrc).toContain('Right song')
    expect(result?.synced).toBe(true)
    expect(result?.match?.track).toBe('Blinding Lights')
    expect(result?.match?.artist).toBe('The Weeknd')
    expect(result?.match?.matchKind).toBe('fuzzy')
  })

  it('tries cleaned title variants when exact metadata fails', async () => {
    const searchUrls: string[] = []
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/search')) searchUrls.push(url)
      if (url.includes('/api/get')) {
        return { ok: false, status: 404 } as Response
      }
      return {
        ok: true,
        json: async () => ([
          { id: 1, name: 'My Song', artistName: 'Artist', syncedLyrics: '[00:01.00]Found' },
        ]),
      } as Response
    })

    await findLyrics('My Song (Official Video)', 'Artist')
    expect(searchUrls.some((u) => u.includes('track_name=My+Song'))).toBe(true)
  })

  it('finds a typo rock title via distinctive phrase search', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/get')) {
        return { ok: false, status: 404 } as Response
      }
      if (url.includes('Morning+Light+Falls') || url.includes('morning+light+falls')) {
        return {
          ok: true,
          json: async () => ([{
            id: 1,
            name: "Rockn' Roll, Morning Light Falls on You",
            artistName: 'ASIAN KUNG-FU GENERATION',
            syncedLyrics: '[00:01.00]Dekireba sekai o',
          }]),
        } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    const result = await findLyrics('Rock n Roll Morning Light Falls Onto You', 'Asian Kung-Fu Generation')
    expect(result?.lrc).toContain('Dekireba')
    expect(result?.synced).toBe(true)
  })
})
