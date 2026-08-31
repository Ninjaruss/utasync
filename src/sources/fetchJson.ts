/** Why a lyrics/network request did not produce a body. */
export type FetchFailure =
  /** The service answered: there is no such entry (404). */
  | 'not-found'
  /** The service is refusing us for now (429). Do NOT retry immediately. */
  | 'rate-limited'
  /** The service is broken (5xx). Transient; a single retry is reasonable. */
  | 'server'
  /** Our own abort timer fired. Transient. */
  | 'timeout'
  /** The device has no network. */
  | 'offline'
  /** Reachable network but the request was refused before a response (CORS, DNS). */
  | 'blocked'

export type FetchResult<T> = { ok: true; data: T } | { ok: false; reason: FetchFailure }

/**
 * JSON fetch with an abort timeout so slow lyric scrapers cannot hang the UI.
 *
 * Returns a REASON on failure rather than a bare null. Collapsing every failure
 * into null is what made the UI tell users "no match in the lyrics database"
 * when they were merely offline or rate-limited.
 */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 12_000,
): Promise<FetchResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) {
      if (res.status === 404) return { ok: false, reason: 'not-found' }
      if (res.status === 429) return { ok: false, reason: 'rate-limited' }
      if (res.status >= 500) return { ok: false, reason: 'server' }
      return { ok: false, reason: 'blocked' }
    }
    return { ok: true, data: (await res.json()) as T }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout' }
    }
    // A fetch TypeError means the request never completed. Distinguish a dead
    // device from a refused request, because only one is the user's to fix.
    const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false
    return { ok: false, reason: online ? 'blocked' : 'offline' }
  } finally {
    clearTimeout(timer)
  }
}
