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

/** Message substrings that mean "the model could not be fetched" rather than
 * "this device ran out of room". Shared by the classifier and by the retry
 * notice, which otherwise blamed a dropped connection on memory. */
const NETWORK_HINTS = [
  'fetch',
  'network',
  'failed to load',
  'load model',
  'load module',
  'importscripts',
  'download',
  'err_internet',
  'offline',
]

const MEMORY_HINTS = [
  'out of memory',
  'out-of-memory',
  'allocation failed',
  'ran out of memory',
  'wasm memory',
]

/** True when a failure looks like a network/model-download problem. The retry
 * ladder recovers from these and from resource failures alike, but they need
 * different copy — telling a user "likely out of memory" when their wifi dropped
 * sends them to close tabs for nothing. */
export function isNetworkFailure(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message.toLowerCase()
  return NETWORK_HINTS.some((hint) => msg.includes(hint))
}

/** Map an auto-align failure to a message a user can act on, instead of dumping
 * the raw exception text. The raw `e.message` is still surfaced separately (in a
 * collapsible details disclosure) for power users. Four buckets:
 *  - out-of-memory / WASM abort              → memory guidance
 *  - timed out                               → the specific, actionable advice
 *  - network / model-download / module-load  → connection guidance
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
  if (MEMORY_HINTS.some((hint) => msg.includes(hint))) {
    return MEMORY
  }
  // The transcription timeout carries advice ("shorter clip / disable vocal
  // separation / tap-sync") that the generic bucket used to bury behind
  // "Technical details", where nobody who needs it would look.
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'Auto-align took too long on this device — try a shorter clip, turn off vocal isolation, or use tap-sync instead.'
  }
  if (NETWORK_HINTS.some((hint) => msg.includes(hint))) {
    return NETWORK
  }
  return GENERIC
}
