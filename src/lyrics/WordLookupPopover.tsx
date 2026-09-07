import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Token } from '../core/types'
import { lookupWord, jishoSearchUrl, type WordLookupResult } from '../language/japanese/wordLookup'
import { useSettingsStore } from '../payment/SettingsStore'
import { Overlay } from '../core/ui/Overlay'

interface Props {
  token: Token
  /** Bounding rect of the tapped span; null falls back to the bottom-card layout. */
  anchorRect: DOMRect | null
  /** Grammar pattern covering this word, when the line has one. */
  grammar?: { pattern: string; explanation: string }
  onClose: () => void
}

const CARD_WIDTH = 288 // w-72, for clamping the anchored position on-screen
const CARD_EST_HEIGHT = 160 // rough card height, for deciding when to flip above the word

/**
 * Compact tap-to-look-up dictionary card. Anchored under the tapped word on
 * wide viewports; a fixed bottom card on narrow ones so it never fights the
 * user's thumb. Playback keeps running; dismissed by tapping outside.
 */
export function WordLookupPopover({ token, anchorRect, grammar, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Keyed by token so a new tap derives back to the loading state without a
  // synchronous setState inside the effect.
  const [resolved, setResolved] = useState<{ token: Token; result: WordLookupResult | null } | null>(null)
  const result: WordLookupResult | null | 'loading' =
    resolved && resolved.token === token ? resolved.result : 'loading'

  // Same reading-mode the ruby uses, so the popover reading matches the lyrics.
  const readingMode = useSettingsStore((s) => s.readingMode)

  useEffect(() => {
    let cancelled = false
    void lookupWord(token, readingMode).then((r) => { if (!cancelled) setResolved({ token, result: r }) })
    return () => { cancelled = true }
  }, [token, readingMode])

  // Swallow the click that completes a dismissing outside tap: without this the
  // gesture lands on the lyric row underneath, whose onClick seeks playback.
  // Actually closing is now <Overlay>'s job (its own outside-pointerdown
  // dismissal, bubble-phase) — this stays on the capture phase purely so the
  // swallower is armed before that click has a chance to land anywhere. It no
  // longer calls onClose itself: doing so as well as Overlay would fire it
  // twice for the same tap. The swallower is deliberately detached from this
  // effect's cleanup — the popover unmounts on onClose() before the click event
  // fires, so tying it to the component lifetime would defeat the fix. It is
  // one-shot and also self-removes on a short timer in case no click follows
  // (e.g. a drag).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      let timer = 0
      function remove() {
        document.removeEventListener('click', swallow, true)
        window.clearTimeout(timer)
      }
      function swallow(ce: MouseEvent) {
        ce.stopPropagation()
        ce.preventDefault()
        remove()
      }
      document.addEventListener('click', swallow, true)
      timer = window.setTimeout(remove, 400)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  // A null lookup (punctuation-only token) renders nothing, so ask the parent
  // to unmount us — otherwise its state stays set and the outside-tap listener
  // can never fire (ref is null).
  useEffect(() => {
    if (result === null) onClose()
  }, [result, onClose])

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
    : // Bottom-card layout: sit just above the playback dock. PlayerControls
      // publishes --player-dock-height on mobile; the fallback matches the
      // old fixed offset (bottom-24 = 96px).
      { bottom: 'calc(var(--player-dock-height, 96px) + 12px)' }

  // Positioning can't travel through Overlay's className (a static string), so
  // apply it to the panel node directly. Cleared first: which of left/top/bottom
  // are active differs between the anchored and bottom-card layouts. Declared
  // before the early return below so this hook always runs, whether or not the
  // popover ends up rendering anything this pass.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.left = el.style.top = el.style.bottom = ''
    for (const [prop, value] of Object.entries(style)) {
      el.style.setProperty(prop, typeof value === 'number' ? `${value}px` : String(value))
    }
  })

  // Nothing to show for punctuation-only tokens.
  if (result === null) return null

  const loading = result === 'loading'
  const headword = loading ? token.surface : result.headword
  const reading = loading ? null : result.reading
  const pos = loading ? null : result.posLabel ?? result.pos
  // `senses` enriches `glosses`, which stays the guaranteed field: a result that
  // predates it (or arrives from a boundary that dropped it) still renders as
  // the single definition it carries.
  const senses = loading
    ? []
    : result.senses?.length
      ? result.senses
      : result.glosses.length > 0
        ? [{ posLabel: null, glosses: result.glosses }]
        : []

  return (
    <Overlay
      // Escape closes it and focus returns to the word that opened it, so a
      // keyboard reader can look words up without losing their place in the
      // line. <Overlay>'s own outside-pointerdown dismissal (bubble-phase) is
      // now the sole owner of outside-tap dismissal — it is what calls
      // onClose. The capture-phase pointerdown effect above no longer closes
      // anything; it exists purely to swallow the click that completes a
      // dismissing outside tap, so that click doesn't fall through and seek
      // the lyric row underneath (see that effect's own comment).
      onClose={onClose}
      placement="anchored"
      role="dialog"
      label={`Dictionary entry for ${headword}`}
      panelRef={ref}
      className={[
        anchored ? 'fixed w-72' : 'fixed inset-x-3 mx-auto max-w-sm',
        'z-30 rounded-xl border border-cinnabar-accent/60 bg-cinnabar-900 p-3 space-y-1.5 shadow-xl text-left',
      ].join(' ')}
    >
      {/* display:contents so this wrapper doesn't break the panel's space-y-1.5
          child spacing — it exists only to stop a click from reaching the lyric
          row underneath. */}
      <div className="contents" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-0 right-0 w-11 h-11 flex items-center justify-center text-white/60 hover:text-white/80 touch-manipulation transition-colors duration-150 ease-out"
      >
        <span aria-hidden className="text-sm leading-none">✕</span>
      </button>
      <div className="flex items-baseline gap-2 flex-wrap pr-9">
        <span lang="ja" className="font-jp text-lg font-semibold text-white">{headword}</span>
        {reading && reading !== headword && (
          <span lang="ja" className="font-jp text-sm text-cinnabar-accent/90">{reading}</span>
        )}
        {!loading && result.dictionaryReading && (
          <span lang="ja" className="font-jp text-xs text-white/60">dictionary: {result.dictionaryReading}</span>
        )}
        {pos && <span className="text-[10px] text-white/60">{pos}</span>}
      </div>
      {loading ? (
        <p className="text-xs text-white/60">Looking up…</p>
      ) : senses.length > 0 ? (
        /* Every sense the dictionary has, the best match first. Committing to a
           single definition made each disambiguation call user-visible: pick
           wrong and the reader had no way to reach the sense they wanted. The
           list is unnumbered at one sense so the common case stays quiet. */
        <ol className={senses.length > 1 ? 'space-y-1 list-decimal list-inside marker:text-white/40 marker:text-xs' : ''}>
          {senses.map((sense, i) => (
            <li key={i} className="text-sm text-white/80 text-pretty">
              {sense.posLabel && (
                <span className="text-[0.65rem] uppercase tracking-wide text-cinnabar-accent/80 mr-1.5">
                  {sense.posLabel}
                </span>
              )}
              {sense.glosses.join('; ')}
            </li>
          ))}
        </ol>
      ) : result.dictionaryAvailable ? (
        <p className="text-xs text-white/60">No definition found.</p>
      ) : (
        <p className="text-xs text-white/60">Definitions unavailable.</p>
      )}
      {/* The grammar pattern this word belongs to. Detected for every line
          already; this is the first surface that actually shows it, and the
          only tap-driven one — the previous renderer was hover-only. */}
      {grammar && (
        <div className="pt-1.5 border-t border-cinnabar-800">
          <p lang="ja" className="font-jp text-xs text-cinnabar-accent/90">{grammar.pattern}</p>
          <p className="text-xs text-white/70 text-pretty leading-snug">{grammar.explanation}</p>
        </div>
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
    </Overlay>
  )
}
