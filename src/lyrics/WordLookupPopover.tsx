import { useEffect, useRef, useState } from 'react'
import type { Token } from '../core/types'
import { lookupWord, jishoSearchUrl, type WordLookupResult } from '../language/japanese/wordLookup'

interface Props {
  token: Token
  /** Bounding rect of the tapped span; null falls back to the bottom-card layout. */
  anchorRect: DOMRect | null
  onClose: () => void
}

const CARD_WIDTH = 288 // w-72, for clamping the anchored position on-screen
const CARD_EST_HEIGHT = 160 // rough card height, for deciding when to flip above the word

/**
 * Compact tap-to-look-up dictionary card. Anchored under the tapped word on
 * wide viewports; a fixed bottom card on narrow ones so it never fights the
 * user's thumb. Playback keeps running; dismissed by tapping outside.
 */
export function WordLookupPopover({ token, anchorRect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Keyed by token so a new tap derives back to the loading state without a
  // synchronous setState inside the effect.
  const [resolved, setResolved] = useState<{ token: Token; result: WordLookupResult | null } | null>(null)
  const result: WordLookupResult | null | 'loading' =
    resolved && resolved.token === token ? resolved.result : 'loading'

  useEffect(() => {
    let cancelled = false
    void lookupWord(token).then((r) => { if (!cancelled) setResolved({ token, result: r }) })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [onClose])

  // A null lookup (punctuation-only token) renders nothing, so ask the parent
  // to unmount us — otherwise its state stays set and the outside-tap listener
  // can never fire (ref is null).
  useEffect(() => {
    if (result === null) onClose()
  }, [result, onClose])

  // Nothing to show for punctuation-only tokens.
  if (result === null) return null

  const loading = result === 'loading'
  const headword = loading ? token.surface : result.headword
  const reading = loading ? null : result.reading
  const pos = loading ? null : result.pos
  const glosses = loading ? [] : result.glosses

  const narrow = window.innerWidth < 640
  const anchored = !narrow && anchorRect !== null
  // Flip above the word when the card would spill past the bottom edge. Using
  // `bottom:` for the flipped case avoids needing the real card height.
  const fitsBelow = anchorRect !== null && anchorRect.bottom + 8 + CARD_EST_HEIGHT <= window.innerHeight
  const style = anchored
    ? {
        left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - CARD_WIDTH - 8)),
        ...(fitsBelow
          ? { top: anchorRect.bottom + 8 }
          : { bottom: window.innerHeight - anchorRect.top + 8 }),
      }
    : undefined

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Dictionary entry for ${headword}`}
      onClick={(e) => e.stopPropagation()}
      style={style}
      className={[
        anchored ? 'fixed w-72' : 'fixed inset-x-3 bottom-24 mx-auto max-w-sm',
        'z-30 rounded-xl border border-cinnabar-accent/60 bg-cinnabar-900 p-3 space-y-1.5 shadow-xl text-left',
      ].join(' ')}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span lang="ja" className="font-jp text-lg font-semibold text-white">{headword}</span>
        {reading && reading !== headword && (
          <span lang="ja" className="font-jp text-sm text-cinnabar-accent/90">{reading}</span>
        )}
        {pos && <span className="text-[10px] text-white/40">{pos}</span>}
      </div>
      {loading ? (
        <p className="text-xs text-white/40">Looking up…</p>
      ) : glosses.length > 0 ? (
        <p className="text-sm text-white/80 text-pretty">{glosses.join('; ')}</p>
      ) : result.dictionaryAvailable ? (
        <p className="text-xs text-white/40">No definition found.</p>
      ) : (
        <p className="text-xs text-white/40">Definitions unavailable.</p>
      )}
      <a
        href={jishoSearchUrl(headword)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-cinnabar-accent underline underline-offset-2 touch-manipulation"
      >
        jisho.org ↗
      </a>
    </div>
  )
}
