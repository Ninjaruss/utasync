const RETRYABLE = /error in input stream|network error|failed to fetch|load failed|aborted|decoding failed|connection|content-length header.*exceeds/i

export function isRetryableNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return RETRYABLE.test(msg)
}

export function friendlyModelLoadError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)
  if (/error in input stream|network error|failed to fetch|load failed|content-length header.*exceeds/i.test(msg)) {
    return new Error(
      'Speech model download was interrupted or a cached file was incomplete. Tap Try again — corrupt cache entries are cleared automatically. If it keeps failing, Settings → Clear AI model cache and reload the page.',
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
