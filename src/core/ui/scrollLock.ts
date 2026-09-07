/**
 * Body scroll lock, reference-counted because overlays stack (a ConfirmDialog
 * over a sheet, a popover over the player). A naive lock/unlock pair would let
 * the inner overlay's unmount unlock the page while the outer one is still open.
 *
 * The pre-lock value is captured on the FIRST acquire and restored on the LAST
 * release, so a page that was deliberately `overflow: scroll` gets that back
 * rather than an empty string.
 */
let holders = 0
let previousOverflow = ''

export function acquireScrollLock(): () => void {
  if (holders === 0) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  holders += 1

  let released = false
  return () => {
    // Guard: make this release function idempotent. If invoked more than once
    // (by an explicit close handler and an unmount cleanup, for example), a
    // second release would decrement for a hold that no longer exists and
    // unlock the page under a still-open outer overlay.
    if (released) return
    released = true
    holders -= 1
    if (holders === 0) document.body.style.overflow = previousOverflow
  }
}

/** Test-only: drop all holds. */
export function resetScrollLock(): void {
  holders = 0
  previousOverflow = ''
}
