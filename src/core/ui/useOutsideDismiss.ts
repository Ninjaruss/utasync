import { useEffect, type RefObject } from 'react'

/** Calls `onDismiss` on the first pointerdown outside `ref`'s element while `active` is true. */
export function useOutsideDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!active) return
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [active, ref, onDismiss])
}
