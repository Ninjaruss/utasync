import { useEffect, type ReactNode } from 'react'
import { acquireScrollLock } from './scrollLock'

interface Props {
  children: ReactNode
  /** Accessible name for the busy state, e.g. "Loading AI tools". */
  label: string
  className?: string
  /**
   * Whether to announce this region as a live region (default true).
   * Set to false when an inner child already provides the detailed live-region
   * announcement (e.g., ProcessProgress with its own role="status").
   * When false, the root uses role="presentation" to avoid competing announcements.
   */
  announce?: boolean
  /**
   * Optional aria-labelledby to point to an element that provides the accessible name.
   * Useful when the visible content should be the sole source of the accessible name
   * (e.g., LoadingOverlay where the message is visible as a <p> child).
   * When provided, aria-label is omitted even when announce=true.
   */
  'aria-labelledby'?: string
}

/**
 * A transient layer that covers the app while work finishes, and that
 * deliberately has NO exit — the work ending is what dismisses it.
 *
 * Separate from <Overlay> on purpose. <Overlay> requires a non-optional
 * `onClose` so a dead-end surface cannot be built; progress layers are the one
 * legitimate exception, and giving them their own component keeps that
 * exception visible, greppable and lint-allowlistable instead of weakening the
 * contract every other surface depends on.
 *
 * It is a `status`, not a `dialog`: it takes no focus, traps nothing, and has
 * no controls, so announcing it as a dialog would strand a screen-reader user
 * inside something they cannot act on or leave.
 */
export function BlockingOverlay({
  children,
  label,
  className = '',
  announce = true,
  'aria-labelledby': ariaLabelledby,
}: Props) {
  useEffect(() => acquireScrollLock(), [])

  return (
    <div
      role={announce ? 'status' : 'presentation'}
      aria-live={announce ? 'polite' : undefined}
      aria-busy={announce ? 'true' : undefined}
      aria-label={ariaLabelledby ? undefined : announce ? label : undefined}
      aria-labelledby={ariaLabelledby}
      className={['fixed inset-0 z-[60] flex items-center justify-center bg-black/80', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}
