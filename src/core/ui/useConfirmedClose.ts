import { useState } from 'react'

/**
 * Gates `onClose` behind a confirmation step while `busy` is true, so an
 * accidental backdrop tap or close button doesn't silently discard
 * in-progress work (an upload, a search, an in-flight fetch).
 */
export function useConfirmedClose(onClose: () => void) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const requestClose = () => {
    if (busy) setConfirming(true)
    else onClose()
  }
  const confirm = () => {
    setConfirming(false)
    onClose()
  }
  const cancel = () => setConfirming(false)

  return { busy, setBusy, confirming, requestClose, confirm, cancel }
}
