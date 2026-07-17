/** Translate an exception caught inside an inference worker into a message a
 * user can act on. onnxruntime's WASM backend throws raw NUMBERS for C++
 * exceptions (an exception-pointer address, e.g. `1261431424`) — almost always
 * an out-of-memory abort. Left untranslated, that number was surfaced verbatim
 * as the auto-align error message. */
export function describeWorkerError(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message
  const text = String(err)
  if (typeof err === 'number' || /^\d+$/.test(text.trim())) {
    return (
      `The on-device model crashed (WASM error ${text}) — this usually means `
      + 'the browser ran out of memory. Close other tabs or try again; the app will '
      + 'retry with lighter settings automatically.'
    )
  }
  return fallback ?? text
}

/** Whether a transcription failure is worth retrying with lighter settings
 * (smaller model / segment timestamps): crashes, OOM aborts, and merge
 * timeouts qualify; a user cancellation must not restart work. */
export function isRecoverableTranscriptionError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return !/cancel/i.test(e.message)
}

/** Map an auto-align failure to a message a user can act on, instead of dumping
 * the raw exception text. The raw `e.message` is still surfaced separately (in a
 * collapsible details disclosure) for power users. Three buckets:
 *  - network / model-download / module-load  → connection guidance
 *  - out-of-memory / WASM abort              → memory guidance
 *  - anything else                           → generic "song is saved" reassurance */
export function classifyAlignError(e: unknown): string {
  const GENERIC = 'Something went wrong during auto-align. Your song is saved — try again from Edit mode.'
  const MEMORY = 'Your device ran out of memory during auto-align — close other tabs or apps and try again.'
  const NETWORK = "Couldn't download the speech model — check your connection and try again."

  // onnxruntime's WASM backend throws bare numbers for C++ aborts (almost always
  // OOM); treat those as a memory failure rather than the generic bucket.
  if (!(e instanceof Error)) {
    const text = String(e)
    if (typeof e === 'number' || /^\d+$/.test(text.trim())) return MEMORY
    return GENERIC
  }

  const msg = e.message.toLowerCase()
  if (
    msg.includes('out of memory')
    || msg.includes('out-of-memory')
    || msg.includes('allocation failed')
    || msg.includes('ran out of memory')
    || msg.includes('wasm memory')
  ) {
    return MEMORY
  }
  if (
    msg.includes('fetch')
    || msg.includes('network')
    || msg.includes('failed to load')
    || msg.includes('load model')
    || msg.includes('load module')
    || msg.includes('importscripts')
    || msg.includes('download')
    || msg.includes('err_internet')
    || msg.includes('offline')
  ) {
    return NETWORK
  }
  return GENERIC
}
