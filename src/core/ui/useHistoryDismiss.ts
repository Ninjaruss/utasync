import { useEffect, useRef } from 'react'

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
 */
export function useHistoryDismiss(onDismiss: () => void, enabled = true): void {
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  useEffect(() => {
    if (!enabled) return
    // Same URL — this entry exists only to be popped. The app's hash router
    // therefore sees no route change and stays out of the way.
    window.history.pushState({ utasyncOverlay: true }, '')

    let poppedByUser = false
    const onPop = () => {
      poppedByUser = true
      onDismissRef.current()
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      // Closed by the ✕, the backdrop or Escape instead. Drop the entry we
      // added so Back doesn't have to be pressed twice to leave the app — the
      // listener is already detached, so this can't re-enter onDismiss.
      if (!poppedByUser) window.history.back()
    }
  }, [enabled])
}
