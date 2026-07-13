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
