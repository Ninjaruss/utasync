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

/**
 * Yields to the event loop so the UI can paint and handle input, WITHOUT waiting
 * for idle.
 *
 * `yieldToMainThread` waits on requestIdleCallback, which browsers throttle hard
 * in a background tab — measured: a loop yielding ~70 times took over 45s hidden
 * versus under a second visible. Auto-align routinely runs while the user is on
 * another tab, so a hot loop that yields per frame-batch needs a primitive that
 * is not timer-clamped. A MessageChannel message is dispatched as an ordinary
 * task and is not subject to the background timer clamp (this is why React's
 * scheduler uses one).
 */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(undefined)
  })
}
