import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useModalDialog } from './useModalDialog'
import { useHistoryDismiss } from './useHistoryDismiss'
import { useOutsideDismiss } from './useOutsideDismiss'
import { acquireScrollLock } from './scrollLock'

export type OverlayPlacement = 'sheet' | 'fullscreen' | 'contained' | 'anchored'

interface Props {
  /** REQUIRED, and deliberately not optional: an overlay with no way out is the
   * single most repeated severe defect in this app's history (the tap-through
   * screen with no Back, the offset screen that was a dead end). Making the exit
   * part of the type means a dead-end overlay cannot be constructed. Transient
   * progress layers that genuinely have no exit use <BlockingOverlay> instead —
   * a separate component, so this contract never has to be weakened. */
  onClose: () => void
  children: ReactNode
  placement?: OverlayPlacement
  role?: 'dialog' | 'alertdialog' | 'menu'
  label?: string
  labelledBy?: string
  describedBy?: string
  /** Both `className` and `backdropClassName` land on the same single root
   * element (see the `[ROOT_CLASS[placement], backdropClassName, className]`
   * join below) — there is no separate backdrop element, so the split between
   * them is purely conventional, not structural, and CSS precedence is
   * stylesheet source order rather than attribute order, so their relative
   * position here is also meaningless. For `placement="anchored"` (where
   * `ROOT_CLASS` is `''`) this root *is* the panel, so `className` is the
   * natural choice and matches every anchored migration. For `sheet` /
   * `fullscreen` / `contained`, the root is the backdrop and the visible panel
   * is a caller-supplied child, so every such migration correctly used
   * `backdropClassName` and passes the surface's existing classes verbatim so
   * nothing moves on screen — passing them as `className` instead would have
   * the identical effect today, which is the asymmetry to watch for. Whether
   * to collapse these into one prop, or give sheet/fullscreen/contained a real
   * backdrop element so the split becomes structural, is an open Phase 3
   * question — this is a known asymmetry, not an oversight. */
  className?: string
  /** See `className` above — functionally the same prop today; use this one
   * for `sheet` / `fullscreen` / `contained` placements, where the root
   * element is the backdrop and the panel is a child you render yourself. */
  backdropClassName?: string
  /** For callers that must measure or position the panel themselves. */
  panelRef?: RefObject<HTMLDivElement | null>
  /** `placement="anchored"` dismisses on outside pointerdown by default. Set this
   * to `false` for a surface holding uncommitted state that an outside tap must
   * not silently discard (e.g. a draft only persisted by an explicit "Done").
   * Escape and every other exit still work — this only opts out of the
   * outside-pointerdown path. Ignored for every other placement, which never
   * dismisses on outside pointerdown regardless. */
  dismissOnOutside?: boolean
}

const ROOT_CLASS: Record<OverlayPlacement, string> = {
  sheet: 'fixed inset-0 z-40 flex flex-col justify-end md:justify-center md:items-center md:p-6',
  fullscreen: 'fixed inset-0 z-50 flex flex-col',
  contained: 'absolute inset-0 z-20 flex items-end sm:items-center justify-center p-4',
  anchored: '',
}

export function Overlay({
  onClose,
  children,
  placement = 'sheet',
  role = 'dialog',
  label,
  labelledBy,
  describedBy,
  className = '',
  backdropClassName = '',
  panelRef,
  dismissOnOutside = true,
}: Props) {
  const localRef = useRef<HTMLDivElement>(null)
  const ref = panelRef ?? localRef

  const locksScroll = placement === 'sheet' || placement === 'fullscreen'
  const ownsHistory = locksScroll
  const dismissesOutside = placement === 'anchored' && dismissOnOutside

  useModalDialog(ref, onClose)
  useHistoryDismiss(onClose, ownsHistory)
  useOutsideDismiss(ref, dismissesOutside, onClose)

  useEffect(() => {
    if (!locksScroll) return
    return acquireScrollLock()
  }, [locksScroll])

  return (
    <div
      ref={ref}
      role={role}
      aria-modal={role === 'dialog' || role === 'alertdialog' ? true : undefined}
      tabIndex={-1}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={[ROOT_CLASS[placement], backdropClassName, className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}
