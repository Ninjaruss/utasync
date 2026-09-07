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
  /** Panel classes. Migrations pass the surface's existing classes verbatim so
   * nothing moves on screen. */
  className?: string
  backdropClassName?: string
  /** For callers that must measure or position the panel themselves. */
  panelRef?: RefObject<HTMLDivElement | null>
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
}: Props) {
  const localRef = useRef<HTMLDivElement>(null)
  const ref = panelRef ?? localRef

  const locksScroll = placement === 'sheet' || placement === 'fullscreen'
  const ownsHistory = locksScroll
  const dismissesOutside = placement === 'anchored'

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
      aria-modal="true"
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
