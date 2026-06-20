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
