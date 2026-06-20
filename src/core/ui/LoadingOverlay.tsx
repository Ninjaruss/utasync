import type { ReactNode } from 'react'

interface Props {
  message: string
  detail?: string
  action?: ReactNode
}

/** Full-screen dimmed overlay with spinner — use for short, indeterminate waits only. */
export function LoadingOverlay({ message, detail, action }: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-3 px-6 max-w-xs text-center">
        <div className="w-9 h-9 rounded-full border-2 border-cinnabar-accent border-t-transparent animate-spin" />
        <p className="text-white/80 text-sm font-medium">{message}</p>
        {detail && <p className="text-white/35 text-xs">{detail}</p>}
        {action}
      </div>
    </div>
  )
}
