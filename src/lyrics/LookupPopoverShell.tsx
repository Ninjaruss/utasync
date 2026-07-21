import { useEffect, useRef } from 'react'

export interface ExternalLink { href: string; label: string }

interface Props {
  ariaLabel: string
  anchorRect: DOMRect | null
  externalLink: ExternalLink
  onClose: () => void
  children: React.ReactNode
}

const CARD_WIDTH = 288
const CARD_EST_HEIGHT = 160

/** Shared chrome for tap-lookup cards: positioning, outside-tap dismissal,
 * close button, and the external dictionary link. Body-agnostic. */
export function LookupPopoverShell({ ariaLabel, anchorRect, externalLink, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Dismiss on outside pointerdown (capture) + swallow the completing click so
  // it doesn't seek the lyric row underneath. One-shot; self-removes on a timer.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      let timer = 0
      function remove() { document.removeEventListener('click', swallow, true); window.clearTimeout(timer) }
      function swallow(ce: MouseEvent) { ce.stopPropagation(); ce.preventDefault(); remove() }
      document.addEventListener('click', swallow, true)
      timer = window.setTimeout(remove, 400)
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose])

  const narrow = window.innerWidth < 640
  const anchored = !narrow && anchorRect !== null
  const fitsBelow = anchorRect !== null && anchorRect.bottom + 8 + CARD_EST_HEIGHT <= window.innerHeight
  const style = anchored
    ? {
        left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - CARD_WIDTH - 8)),
        ...(fitsBelow ? { top: anchorRect.bottom + 8 } : { bottom: window.innerHeight - anchorRect.top + 8 }),
      }
    : { bottom: 'calc(var(--player-dock-height, 96px) + 12px)' }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      style={style}
      className={[
        anchored ? 'fixed w-72' : 'fixed inset-x-3 mx-auto max-w-sm',
        'z-30 rounded-xl border border-cinnabar-accent/60 bg-cinnabar-900 p-3 space-y-1.5 shadow-xl text-left',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-0 right-0 w-11 h-11 flex items-center justify-center text-white/40 hover:text-white/80 touch-manipulation transition-colors duration-150 ease-out"
      >
        <span aria-hidden className="text-sm leading-none">✕</span>
      </button>
      {children}
      <a
        href={externalLink.href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-cinnabar-accent underline underline-offset-2 touch-manipulation"
      >
        {externalLink.label}
      </a>
    </div>
  )
}
