import { useState } from 'react'

export type CloseConfirmReason = 'busy' | 'dirty'

/**
 * Gates `onClose` behind a confirmation step while `busy` or `dirty` is true,
 * so an accidental backdrop tap or close button doesn't silently discard
 * in-progress work (an upload, a search, an in-flight fetch) or unsaved
 * input (pasted lyrics, typed metadata). `confirming` carries the reason so
 * callers can pick matching dialog copy; it stays truthy/falsy for callers
 * that only need the boolean.
 */
export function useConfirmedClose(onClose: () => void) {
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState<CloseConfirmReason | false>(false)

  const requestClose = () => {
    if (busy) setConfirming('busy')
    else if (dirty) setConfirming('dirty')
    else onClose()
  }
  const confirm = () => {
    setConfirming(false)
    onClose()
  }
  const cancel = () => setConfirming(false)

  return { busy, setBusy, dirty, setDirty, confirming, requestClose, confirm, cancel }
}
