import type { ReactNode } from 'react'

interface Props {
  /** The error message to display. */
  children: ReactNode
  /** Extra classes merged onto the container (e.g. layout hints like `shrink-0`). */
  className?: string
}

/**
 * A filled inline error treatment. The app's brand accent is red-400, which is
 * the exact colour of plain `text-red-400` error text — so bare red error text
 * reads as ordinary accent styling, not a warning. This mirrors the Toast error
 * style (a filled red block with a warning glyph) so inline errors actually
 * signal "error" at a glance.
 *
 * Not interactive — purely presentational, announced via role="alert".
 */
export function InlineError({ children, className }: Props) {
  return (
    <div
      role="alert"
      className={[
        'flex items-start gap-2 bg-red-900/90 border border-red-700/50 text-red-100 rounded-lg px-3 py-2 text-xs',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4 shrink-0 mt-px"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span className="flex-1 text-pretty leading-snug">{children}</span>
    </div>
  )
}
