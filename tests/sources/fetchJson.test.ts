import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchJson } from '../../src/sources/fetchJson'

/**
 * fetchJson used to return `null` for a 404, a 429, a CORS block, a timeout and
 * an offline device alike, so every caller reported "no match in the lyrics
 * database" — often untrue. These tests pin the distinctions.
 */
const mockFetch = (impl: () => Promise<Response> | never) => {
  vi.stubGlobal('fetch', vi.fn(impl))
}
const res = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status })

afterEach(() => vi.unstubAllGlobals())

describe('fetchJson outcomes', () => {
  it('returns the parsed body on success', async () => {
    mockFetch(async () => res(200, { hello: 'world' }))
    const r = await fetchJson<{ hello: string }>('https://x.test/a')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toEqual({ hello: 'world' })
  })

  it('reports a 404 as not-found, not as a generic failure', async () => {
    mockFetch(async () => res(404))
    const r = await fetchJson('https://x.test/a')
    expect(r).toEqual({ ok: false, reason: 'not-found' })
  })

  it('reports a 429 as rate-limited', async () => {
    mockFetch(async () => res(429))
    const r = await fetchJson('https://x.test/a')
    expect(r).toEqual({ ok: false, reason: 'rate-limited' })
  })

  it('reports a 5xx as server', async () => {
    mockFetch(async () => res(503))
    const r = await fetchJson('https://x.test/a')
    expect(r).toEqual({ ok: false, reason: 'server' })
  })

  it('reports an aborted request as timeout', async () => {
    mockFetch(async () => { throw new DOMException('aborted', 'AbortError') })
    const r = await fetchJson('https://x.test/a')
    expect(r).toEqual({ ok: false, reason: 'timeout' })
  })

  it('reports a network TypeError as offline when the browser says so', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    mockFetch(async () => { throw new TypeError('Failed to fetch') })
    const r = await fetchJson('https://x.test/a')
    expect(r).toEqual({ ok: false, reason: 'offline' })
  })

  it('reports a network TypeError as blocked when the browser is online', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    mockFetch(async () => { throw new TypeError('Failed to fetch') })
    const r = await fetchJson('https://x.test/a')
    expect(r).toEqual({ ok: false, reason: 'blocked' })
  })
})
