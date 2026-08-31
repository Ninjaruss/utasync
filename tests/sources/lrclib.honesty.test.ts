import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findLyrics, __resetLyricsRequestCache } from '../../src/sources/lrclib'

/**
 * findLyrics used to return `null` for every unsuccessful outcome, so the UI
 * told users "no match in the lyrics database" whether LRCLIB genuinely had
 * nothing, the device was offline, or we had been rate-limited. It also
 * re-fired its whole ~70-request fan-out on every retry, and kept firing even
 * while the service was actively refusing us.
 */
global.fetch = vi.fn()
const respond = (status: number, body: unknown = []) =>
  vi.mocked(fetch).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response)

beforeEach(() => { vi.resetAllMocks(); __resetLyricsRequestCache() })

describe('findLyrics reports WHY it failed', () => {
  it('says no-entry when the service answers but has nothing', async () => {
    respond(404)
    const r = await findLyrics('Some Title', 'Some Artist')
    expect(r.lookup).toBeNull()
    expect(r.outcome).toBe('no-entry')
  })

  it('says rate-limited when the service refuses us', async () => {
    respond(429)
    const r = await findLyrics('Some Title', 'Some Artist')
    expect(r.outcome).toBe('rate-limited')
  })

  it('says offline when the device has no network', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    const r = await findLyrics('Some Title', 'Some Artist')
    expect(r.outcome).toBe('offline')
    vi.unstubAllGlobals()
  })

  it('says found when a match clears the score floor', async () => {
    respond(200, [{
      id: 1, name: 'Some Title', artistName: 'Some Artist', duration: 200,
      syncedLyrics: '[00:01.00]ライン\n[00:03.00]つぎ',
    }])
    const r = await findLyrics('Some Title', 'Some Artist')
    expect(r.outcome).toBe('found')
    expect(r.lookup?.lrc).toContain('[00:01.00]')
  })
})

describe('findLyrics stops hammering the service', () => {
  it('halts the fan-out once rate-limited instead of firing every query', async () => {
    respond(429)
    await findLyrics('Some Long Distinctive Title Here', 'Some Artist')
    const rateLimited = vi.mocked(fetch).mock.calls.length

    vi.resetAllMocks(); __resetLyricsRequestCache()
    respond(404)
    await findLyrics('Some Long Distinctive Title Here', 'Some Artist')
    const notFound = vi.mocked(fetch).mock.calls.length

    expect(rateLimited).toBeLessThan(notFound)
  })

  it('does not re-fire identical requests within a session', async () => {
    respond(404)
    await findLyrics('Some Title', 'Some Artist')
    const first = vi.mocked(fetch).mock.calls.length
    await findLyrics('Some Title', 'Some Artist')
    const total = vi.mocked(fetch).mock.calls.length

    expect(first).toBeGreaterThan(0)
    expect(total, 'the second identical search should be served from cache').toBe(first)
  })
})
