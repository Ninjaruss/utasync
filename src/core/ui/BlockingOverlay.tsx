import { useEffect, type ReactNode } from 'react'
import { acquireScrollLock } from './scrollLock'

interface Props {
  children: ReactNode
  /** Accessible name for the busy state, e.g. "Loading AI tools". */
  label: string
  className?: string
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
export function BlockingOverlay({ children, label, className = '' }: Props) {
  useEffect(() => acquireScrollLock(), [])

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      className={['fixed inset-0 z-[60] flex items-center justify-center bg-black/80', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}
