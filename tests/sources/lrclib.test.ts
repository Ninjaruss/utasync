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

    const result = await findLyrics('Blinding Lghts', 'The Weeknd', undefined, undefined, 'en')
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

  it('uses target duration to disambiguate same-titled results', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/get')) {
        return { ok: false, status: 404 } as Response
      }
      return {
        ok: true,
        json: async () => ([
          { id: 1, name: 'Home', artistName: 'Cover Band', duration: 312, syncedLyrics: '[00:01.00]Wrong cover' },
          { id: 2, name: 'Home', artistName: 'Cover Band', duration: 184, syncedLyrics: '[00:01.00]Right take' },
        ]),
      } as Response
    })

    const result = await findLyrics('Home', 'Cover Band', undefined, 185)
    expect(result?.lrc).toBe('[00:01.00]Right take')
  })

  it('prefers English lyrics for Western songs even when app default is Japanese', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/get')) {
        return { ok: false, status: 404 } as Response
      }
      return {
        ok: true,
        json: async () => ([
          {
            id: 1,
            name: 'Blinding Lights',
            artistName: 'The Weeknd',
            plainLyrics: 'シンデレラみたいに 幻',
          },
          {
            id: 2,
            name: 'Blinding Lights',
            artistName: 'The Weeknd',
            syncedLyrics: '[00:01.00]I been on my own for long enough',
          },
        ]),
      } as Response
    })

    const result = await findLyrics('Blinding Lights', 'The Weeknd')
    expect(result?.lrc).toContain('I been on my own')
    expect(result?.synced).toBe(true)
  })

  it('prefers native Japanese lyrics over romaji for romanized J-pop artist', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/get')) {
        return { ok: false, status: 404 } as Response
      }
      return {
        ok: true,
        json: async () => ([
          {
            id: 1,
            name: 'Veil',
            artistName: 'Keina Suda',
            plainLyrics: 'Kimi no mama de boku wa kimi wo mitsuketa\nSekai wa mou kawaru',
          },
          {
            id: 2,
            name: 'Veil',
            artistName: '須田景瑚',
            plainLyrics: '君のままで 僕は君を見つけた\n世界はもう変わる',
          },
        ]),
      } as Response
    })

    const result = await findLyrics('Veil', 'Keina Suda', undefined, undefined, 'ja')
    expect(result?.lrc).toContain('君のままで')
    expect(result?.match?.artist).toBe('須田景瑚')
  })

  it('searches with Japanese artist alias when romanized name is used', async () => {
    const searchUrls: string[] = []
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/search')) searchUrls.push(url)
      if (url.includes('/api/get')) {
        return { ok: false, status: 404 } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    await findLyrics('Veil', 'Keina Suda')
    expect(searchUrls.some((u) => decodeURIComponent(u).includes('須田景瑚'))).toBe(true)
  })

  it('limits parallel exact-match fetches to avoid LRCLIB rate limits', async () => {
    let inFlight = 0
    let maxInFlight = 0
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (!url.includes('/api/get')) {
        return { ok: true, json: async () => [] } as Response
      }
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { ok: false, status: 404 } as Response
    })

    await findLyrics('Song', 'Asian Kung-Fu Generation')
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('caps fuzzy search queries and prioritizes phrase search', async () => {
    const searchUrls: string[] = []
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/search')) searchUrls.push(url)
      if (url.includes('/api/get')) {
        return { ok: false, status: 404 } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    await findLyrics('Rock n Roll Morning Light Falls Onto You', 'Asian Kung-Fu Generation')
    expect(searchUrls.length).toBeLessThanOrEqual(24)
    expect(searchUrls.some((u) => /Morning\+Light\+Falls/i.test(u))).toBe(true)
  })

  it('finds AKFG rock song when user typo uses Lights plural', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/get')) {
        return { ok: false, status: 404 } as Response
      }
      if (url.includes('Morning+Light+Falls') || url.includes('Morning+Lights+Falls')) {
        return {
          ok: true,
          json: async () => ([{
            id: 1,
            name: "Rockn' Roll, Morning Light Falls on You",
            artistName: 'Asian Kung-Fu Generation',
            syncedLyrics: '[00:01.00]Dekireba sekai o',
          }]),
        } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    const result = await findLyrics(
      'Rockn Roll Morning Lights Falls On You',
      'ASIAN KUNG-FU GENERATION',
    )
    expect(result?.lrc).toContain('Dekireba')
  })

  it('stops launching new searches once a strong match is found', async () => {
    let searchCalls = 0
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/get')) {
        return { ok: false, status: 404 } as Response
      }
      searchCalls++
      if (url.includes('Morning+Light+Falls')) {
        return {
          ok: true,
          json: async () => ([{
            id: 1,
            name: "Rockn' Roll, Morning Light Falls on You",
            artistName: 'Asian Kung-Fu Generation',
            syncedLyrics: '[00:01.00]Dekireba sekai o',
          }]),
        } as Response
      }
      await new Promise((r) => setTimeout(r, 30))
      return { ok: true, json: async () => [] } as Response
    })

    await findLyrics('Rock n Roll Morning Light Falls Onto You', 'Asian Kung-Fu Generation')
    expect(searchCalls).toBeLessThan(10)
  })
})
