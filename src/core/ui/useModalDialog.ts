import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Every dialog currently mounted. Used to work out which one owns a keystroke
 * when overlays are stacked (a confirm over a sheet, say). */
const openDialogs: RefObject<HTMLElement | null>[] = []

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  )
}

/** The dialog a keystroke belongs to: the deepest one containing focus, or —
 * when focus has been lost to the page — the most recently opened.
 *
 * Deliberately derived from the DOM rather than from mount order, because
 * effects run children-first: a ConfirmDialog rendered inside a sheet registers
 * BEFORE the sheet does, so "last registered" would hand Escape to the sheet and
 * dismiss the whole thing when the user only meant to dismiss the confirm. */
function ownerOfKeystroke(): HTMLElement | null {
  const panels = openDialogs.map((r) => r.current).filter((el): el is HTMLElement => !!el)
  if (panels.length === 0) return null
  const containing = panels.filter((p) => p.contains(document.activeElement))
  if (containing.length > 0) return containing.reduce((a, b) => (a.contains(b) ? b : a))
  return panels[panels.length - 1]
}

/**
 * Makes a container behave like a real modal dialog: focus moves into it on
 * open, Tab cycles inside it instead of reaching the page behind, Escape closes
 * it, and focus returns to whatever opened it.
 *
 * The container needs `role="dialog"` (or `alertdialog`), `aria-modal="true"`
 * and `tabIndex={-1}` so it can hold focus when it contains no controls.
 *
 * `onClose` is read through a ref, so callers can pass an inline arrow without
 * the trap tearing down and stealing focus back on every render.
 */
export function useModalDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true,
): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!enabled) return
    const panel = ref.current
    if (!panel) return

    const opener = document.activeElement as HTMLElement | null
    openDialogs.push(ref)
    ;(focusableWithin(panel)[0] ?? panel).focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Tab') return
      const el = ref.current
      if (!el || ownerOfKeystroke() !== el) return

      if (e.key === 'Escape') {
        e.preventDefault()
        // Stop here so a global shortcut handler (the player's Space/Arrow keys,
        // for one) can't also act on a keystroke aimed at this dialog.
        e.stopPropagation()
        onCloseRef.current()
        return
      }

      const items = focusableWithin(el)
      if (items.length === 0) {
        e.preventDefault()
        el.focus()
        return
      }
      const active = document.activeElement as HTMLElement | null
      const index = active ? items.indexOf(active) : -1
      if (index === -1) {
        // Focus is outside the dialog (or on the panel itself) — pull it back to
        // the appropriate end rather than letting Tab walk the page behind.
        e.preventDefault()
        ;(e.shiftKey ? items[items.length - 1] : items[0]).focus()
        return
      }
      if (e.shiftKey && index === 0) {
        e.preventDefault()
        items[items.length - 1].focus()
      } else if (!e.shiftKey && index === items.length - 1) {
        e.preventDefault()
        items[0].focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const i = openDialogs.indexOf(ref)
      if (i !== -1) openDialogs.splice(i, 1)
      // Only take focus back if the opener is still on the page — deleting a
      // song from a sheet, for instance, removes the row that opened it.
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [ref, enabled])
}
