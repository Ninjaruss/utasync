import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isDemucsModelAvailable,
  refreshDemucsModelAvailability,
  resetDemucsModelCache,
} from '../../src/ai-pipeline/demucsSeparator'
import { DEMUCS_MODEL_URL } from '../../src/ai-pipeline/demucsModelUrl'

/**
 * The availability probe decides whether the "Isolate vocals first" control is usable.
 *
 * Regression guard for an offline false-negative: the probe issued a HEAD request, but the
 * service worker's model routes are GET-only (workbox-routing defaults a Route's method to
 * "GET" and matches routes by `request.method`), so HEAD matched no route, skipped the cache
 * and hit the network. Offline that rejects — so a device that had already downloaded the
 * 66.8 MB model was told isolation "isn't available right now" and was silently downgraded to
 * transcribing the raw mix, a quality loss with no visible cause.
 */

/** The probe only needs to know whether the Cache API answers a hit. */
function stubCache(hit: boolean | (() => never)) {
  const match = vi.fn(async () => {
    if (typeof hit === 'function') return hit()
    return hit ? ({ cached: true } as unknown as Response) : undefined
  })
  vi.stubGlobal('caches', { match })
  return match
}

const headResponse = (contentType = 'application/octet-stream') =>
  ({ ok: true, headers: { get: () => contentType } }) as unknown as Response

describe('demucs model availability probe', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetDemucsModelCache()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetDemucsModelCache()
  })

  it('reports AVAILABLE from the cache without touching the network, so offline still works', async () => {
    const match = stubCache(true)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch')) // offline

    await expect(isDemucsModelAvailable()).resolves.toBe(true)

    // The point of the fix: no request at all, so network state cannot matter.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(match).toHaveBeenCalledWith(DEMUCS_MODEL_URL)
  })

  it('falls back to the network when nothing is cached, and accepts a real binary', async () => {
    stubCache(false)
    fetchMock.mockResolvedValue(headResponse())

    await expect(isDemucsModelAvailable()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(DEMUCS_MODEL_URL, { method: 'HEAD' })
  })

  it('still rejects a SPA rewrite that answers a missing model with 200 text/html', async () => {
    stubCache(false)
    fetchMock.mockResolvedValue(headResponse('text/html; charset=utf-8'))

    await expect(isDemucsModelAvailable()).resolves.toBe(false)
  })

  it('reports unavailable when offline with nothing cached, and does not re-probe within the backoff', async () => {
    stubCache(false)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(isDemucsModelAvailable()).resolves.toBe(false)
    await expect(isDemucsModelAvailable()).resolves.toBe(false)

    // The negative result is cached, so an offline tap does not retry the network.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('honours force, so a model that becomes available is picked up', async () => {
    stubCache(false)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(isDemucsModelAvailable()).resolves.toBe(false)

    stubCache(true) // e.g. the user installed the model, or it finished caching
    await expect(refreshDemucsModelAvailability()).resolves.toBe(true)
  })

  it('degrades to the network check when the Cache API is missing (non-secure origin)', async () => {
    vi.stubGlobal('caches', undefined)
    fetchMock.mockResolvedValue(headResponse())

    await expect(isDemucsModelAvailable()).resolves.toBe(true)
  })

  it('degrades to the network check when the cache lookup itself throws', async () => {
    stubCache(() => {
      throw new Error('SecurityError')
    })
    fetchMock.mockResolvedValue(headResponse())

    await expect(isDemucsModelAvailable()).resolves.toBe(true)
  })
})
