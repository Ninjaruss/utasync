import type { ReactNode } from 'react'

export type BannerSeverity = 'info' | 'warning' | 'error' | 'action'

export interface BannerAction {
  label: string
  onClick: () => void
  busy?: boolean
  variant?: 'primary' | 'ghost'
}

// Severity is encoded in a left rail colour + text tone so an error, an action
// prompt, and an informational note are distinguishable at a glance (and to a
// screen reader via role) instead of every notice being the same grey strip.
const railTone: Record<BannerSeverity, string> = {
  info: 'bg-white/15',
  warning: 'bg-amber-400/70',
  error: 'bg-red-400/80',
  action: 'bg-cinnabar-accent',
}
const textTone: Record<BannerSeverity, string> = {
  info: 'text-white/55',
  warning: 'text-amber-400/85',
  error: 'text-red-300',
  action: 'text-white/70',
}

const primaryBtn =
  'shrink-0 self-start min-h-11 px-3 py-1.5 rounded-lg bg-cinnabar-accent text-cinnabar-950 text-[11px] font-semibold touch-manipulation transition-[background-color,transform] duration-150 ease-out active:scale-[0.96] disabled:opacity-60 inline-flex items-center gap-1.5'
const ghostBtn =
  'shrink-0 self-start min-h-11 px-3 py-1.5 rounded-lg border border-cinnabar-700 text-white/70 hover:text-white text-[11px] font-semibold touch-manipulation transition-colors disabled:opacity-60 inline-flex items-center gap-1.5'

/**
 * The one notice-strip primitive. Replaces the hand-rolled
 * `shrink-0 px-3 … border-b … bg-cinnabar-950/80` + `text-[11px] text-white/70`
 * strips scattered across Play/Edit/add-song, which had no shared shell and no
 * severity distinction. Always `text-xs` (the legibility floor). One optional
 * action and one optional dismiss.
 */
export function Banner({
  severity = 'info',
  role,
  children,
  action,
  actionSlot,
  onDismiss,
}: {
  severity?: BannerSeverity
  /** Defaults to 'alert' for error/warning, 'status' otherwise. */
  role?: 'alert' | 'status'
  children: ReactNode
  action?: BannerAction
  /** Custom trailing control (e.g. a file-input label) when `action` is too plain. */
  actionSlot?: ReactNode
  onDismiss?: () => void
}) {
  const resolvedRole = role ?? (severity === 'error' || severity === 'warning' ? 'alert' : 'status')
  return (
    <div
      role={resolvedRole}
      className="relative shrink-0 flex items-center gap-3 px-3 sm:px-4 py-2.5 border-b border-cinnabar-900/80 bg-cinnabar-950/80"
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-0.5 ${railTone[severity]}`} />
      <p className={`flex-1 min-w-0 text-xs text-pretty leading-snug ${textTone[severity]}`}>{children}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.busy}
          className={action.variant === 'primary' ? primaryBtn : ghostBtn}
        >
          {action.busy && (
            <span aria-hidden="true" className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
          )}
          {action.label}
        </button>
      )}
      {actionSlot}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 self-start min-h-8 px-1 text-white/60 hover:text-white/70 text-xs touch-manipulation"
        >
          ✕
        </button>
      )}
    </div>
  )
}
