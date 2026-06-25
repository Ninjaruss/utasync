/** Run work when the browser is idle — avoids competing with playback/UI on open. */
export function runWhenIdle(work: () => void, timeoutMs = 5000): () => void {
  let cancelled = false
  const run = () => {
    if (!cancelled) work()
  }

  if (typeof requestIdleCallback !== 'undefined') {
    const id = requestIdleCallback(run, { timeout: timeoutMs })
    return () => {
      cancelled = true
      cancelIdleCallback(id)
    }
  }

  const timer = setTimeout(run, 150)
  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}

/** Yields so the UI can paint and handle input between heavy alignment batches. */
export function yieldToMainThread(minDelayMs = 0): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      if (minDelayMs <= 0) resolve()
      else setTimeout(resolve, minDelayMs)
    }
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(finish, { timeout: Math.max(minDelayMs, 32) })
    } else {
      setTimeout(finish, Math.max(minDelayMs, 0))
    }
  })
}
