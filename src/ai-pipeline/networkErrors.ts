const RETRYABLE = /error in input stream|network error|failed to fetch|load failed|aborted|decoding failed|connection|content-length header.*exceeds/i

/**
 * The one failure signature that proves the bytes already on disk are unusable:
 * a stored body shorter than the Content-Length it was stored with. Everything
 * else — a dead network, a flaky one, a driver that refuses WebGPU — says nothing
 * about the cached model, and treating it as corruption is what deleted a healthy
 * ~240 MB Whisper cache and told the user to "tap Try again" while offline.
 */
const CORRUPT_CACHE =
  /content-length header.*exceeds|unexpected end of (?:file|input|stream)|invalid (?:model|onnx|protobuf|file)|protobuf|corrupt|truncat/i

/** Why a model load ultimately failed, which decides both the purge and the copy. */
export type ModelLoadFailure = 'offline' | 'corrupt' | 'interrupted' | 'other'

/** Device-level offline signal — the same one `fetchJson` uses to tell a dead
 * device from a refused request (see src/sources/fetchJson.ts). */
export function isDeviceOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function classifyModelLoadFailure(err: unknown): ModelLoadFailure {
  const msg = err instanceof Error ? err.message : String(err)
  // Corrupt bytes are worth repairing even while offline: a truncated entry keeps
  // failing forever, so dropping it costs the user nothing they had.
  if (CORRUPT_CACHE.test(msg)) return 'corrupt'
  // Everything that reaches here as a bare fetch failure while the device reports
  // no network is missing bytes we cannot fetch — not bad bytes we already have.
  if (isDeviceOffline()) return 'offline'
  if (RETRYABLE.test(msg)) return 'interrupted'
  return 'other'
}

export function isRetryableNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return RETRYABLE.test(msg)
}

/**
 * User-facing copy for a model load failure.
 *
 * `failure` is passed in by the caller that already decided what to purge, so the
 * message can never contradict what actually happened to the cache.
 */
export function friendlyModelLoadError(err: unknown, failure?: ModelLoadFailure): Error {
  const msg = err instanceof Error ? err.message : String(err)
  const kind = failure ?? classifyModelLoadFailure(err)

  if (kind === 'offline') {
    // Nothing was purged and nothing can be downloaded: never claim a cache was
    // cleared, and never imply a retry alone will work.
    return new Error(
      "You're offline — the speech model's remaining files can't be downloaded right now. Everything already downloaded is still cached. Reconnect, then tap Try again.",
      { cause: err },
    )
  }

  if (kind === 'corrupt') {
    return new Error(
      'A cached speech model file was incomplete and has been discarded. Tap Try again to re-download it — reconnect first if you are offline. If it keeps failing, Settings → Clear AI model cache and reload the page.',
      { cause: err },
    )
  }

  if (/error in input stream|network error|failed to fetch|load failed|content-length header.*exceeds/i.test(msg)) {
    return new Error(
      'Speech model download was interrupted. Tap Try again — incomplete cached files are cleared automatically. If it keeps failing, Settings → Clear AI model cache and reload the page.',
      { cause: err },
    )
  }
  if (/unsupported model type/i.test(msg)) {
    return new Error(
      'Speech model runtime failed to initialize. Clear the AI model cache in Settings, reload, and try again.',
      { cause: err },
    )
  }
  if (/unsupported model ir|failed to load|onnx/i.test(msg)) {
    return new Error(
      `Speech model could not start (${msg}). Try clearing the AI model cache in Settings.`,
      { cause: err },
    )
  }
  return err instanceof Error ? err : new Error(msg)
}

export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  attempts = 5,
  delayMs = 2000,
  onRetry?: (attempt: number) => void | Promise<void>,
): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (!isRetryableNetworkError(err) || i === attempts - 1) throw err
      await onRetry?.(i + 1)
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw last
}
