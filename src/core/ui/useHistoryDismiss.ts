import { useEffect, useRef } from 'react'

/** Marks the history entry an overlay parks on, so it is never pushed twice. */
const OVERLAY_STATE = { utasyncOverlay: true }

function isOverlayEntry(): boolean {
  return !!(window.history.state as { utasyncOverlay?: boolean } | null)?.utasyncOverlay
}

/**
 * Makes the system Back gesture close an overlay instead of leaving the app.
 *
 * On Android — and on an iOS edge-swipe — Back is the universal "close this
 * sheet" gesture. Without an entry of its own, an open sheet is invisible to
 * history, so Back navigated away from the app entirely and took any unsaved
 * work (pasted lyrics, a chosen file) with it.
 *
 * The overlay owns this rather than the app shell, because the overlay is what
 * knows whether closing needs a confirmation — point `onDismiss` at the same
 * guarded close the ✕ uses and Back inherits it.
 *
 * Deliberately does NOT pop its entry back off when the sheet is closed some
 * other way. An earlier version did, and the pop it requested was delivered a
 * task later — by which time StrictMode (mount → cleanup → mount) had already
 * remounted the hook, whose listener read that pop as a user Back and dismissed
 * the sheet the instant it opened. There is no reliable way to tell your own
 * late pop from the user's. Parking on a tagged entry and refusing to push a
 * second one keeps history from growing instead: the cost is that after closing
 * with the ✕, one Back press is absorbed doing nothing, once.
 */
export function useHistoryDismiss(onDismiss: () => void, enabled = true): void {
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  useEffect(() => {
    if (!enabled) return
    // Same URL — this entry exists only to be popped, so the app's hash router
    // sees no route change and stays out of the way.
    if (!isOverlayEntry()) window.history.pushState(OVERLAY_STATE, '')

    const onPop = () => onDismissRef.current()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [enabled])
}
