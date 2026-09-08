import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { FuriganaMode, LyricsLayout, ClozeDifficulty } from '../core/types'
import { useMinWidthMd } from '../core/ui/useMinWidthMd'
import { Overlay } from '../core/ui/Overlay'
import {
  displayMenuTrigger,
  displayMenuTriggerActive,
  displayMenuTriggerIdle,
  toolbarChipBtn,
  toolbarChipBtnActive,
  toolbarChipBtnIdle,
  toolbarSectionLabel,
} from '../core/ui/toolbarClasses'

interface Props {
  isJapanese: boolean
  hasTranslation: boolean
  furiganaMode: FuriganaMode
  showTranslation: boolean
  lyricsLayout: LyricsLayout
  wordPairColoringAvailable?: boolean
  /** True when the song has sung-phrase regroupings the user can opt into. */
  phrasingAvailable?: boolean
  /** Cloze drilling is on. */
  clozeMode?: boolean
  clozeDifficulty?: ClozeDifficulty
  onToggleCloze?: () => void
  onClozeDifficulty?: (level: ClozeDifficulty) => void
  /** True when rows are currently rendered in the sung-phrase layout. */
  sungLayoutActive?: boolean
  /** True while applying/reverting the sung layout (async re-enrichment). */
  phrasingBusy?: boolean
  onFuriganaCycle: () => void
  onToggleTranslation: () => void
  onToggleLayout: () => void
  /** Apply the sung phrasing when off, restore pasted rows when on. */
  onTogglePhrasing?: () => void
}

const FURIGANA_LABEL: Record<FuriganaMode, string> = {
  none: 'Off',
  romaji: 'Romaji',
  furigana: 'Furigana',
}

function hasNonDefaultDisplay(
  isJapanese: boolean,
  furiganaMode: FuriganaMode,
  showTranslation: boolean,
  lyricsLayout: LyricsLayout,
  sungLayoutActive: boolean,
  clozeMode: boolean,
): boolean {
  if (isJapanese && furiganaMode !== 'furigana') return true
  if (!showTranslation) return true
  if (lyricsLayout === 'sideBySide') return true
  if (sungLayoutActive) return true
  if (clozeMode) return true
  return false
}

function displaySummary(
  isJapanese: boolean,
  furiganaMode: FuriganaMode,
  showTranslation: boolean,
  lyricsLayout: LyricsLayout,
  sungLayoutActive: boolean,
  clozeMode: boolean,
): string | null {
  const parts: string[] = []
  if (isJapanese && furiganaMode !== 'furigana') parts.push(FURIGANA_LABEL[furiganaMode])
  if (!showTranslation) parts.push('No translation')
  else if (lyricsLayout === 'sideBySide') parts.push('Side by side')
  if (sungLayoutActive) parts.push('Sung phrasing')
  if (clozeMode) parts.push('Recall drill')
  return parts.length > 0 ? parts.join(' · ') : null
}

function DisplayMenuPanel({
  isJapanese,
  hasTranslation,
  furiganaMode,
  showTranslation,
  lyricsLayout,
  wordPairColoringAvailable,
  phrasingAvailable,
  sungLayoutActive,
  phrasingBusy,
  clozeMode,
  clozeDifficulty,
  onToggleCloze,
  onClozeDifficulty,
  onFuriganaCycle,
  onToggleTranslation,
  onToggleLayout,
  onTogglePhrasing,
  compact,
}: Props & { compact?: boolean }) {
  const chip = compact ? `${toolbarChipBtn} min-h-9 py-1.5 text-[11px]` : toolbarChipBtn

  return (
    <>
      {isJapanese && (
        <section className={compact ? 'space-y-1' : 'space-y-2'} aria-label="Reading aids">
          <p className={toolbarSectionLabel}>Reading</p>
          <button
            type="button"
            onClick={onFuriganaCycle}
            className={[
              chip, 'w-full text-left px-3',
              furiganaMode !== 'none' ? toolbarChipBtnActive : toolbarChipBtnIdle,
            ].join(' ')}
          >
            <span className={compact ? 'text-xs' : 'text-sm'}>{FURIGANA_LABEL[furiganaMode]}</span>
            {/* "Tap to cycle" told the user there were other states without ever
              * saying what they were, so the only way to find them was to poke the
              * control repeatedly. Name the cycle instead. */}
            {!compact && (
              <span className="block text-[10px] text-white/60 mt-0.5 text-pretty">
                Tap to cycle: Off → Romaji → Furigana
              </span>
            )}
          </button>
        </section>
      )}

      <section className={compact ? 'space-y-1' : 'space-y-2'} aria-label="Translation layout">
        {isJapanese && <div className={compact ? 'border-t border-cinnabar-800/80 pt-1.5' : 'border-t border-cinnabar-800/80 pt-3'} />}
        <p className={toolbarSectionLabel}>Translation</p>
        {hasTranslation ? (
          <div className="space-y-1.5">
            <label className={[
              'flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg border cursor-pointer touch-manipulation',
              compact ? 'min-h-9 text-xs' : 'min-h-11 px-3 py-2.5 text-sm',
              showTranslation ? 'border-cinnabar-accent/50 bg-cinnabar-accent/5' : 'border-cinnabar-800 hover:border-cinnabar-accent/30',
            ].join(' ')}>
              <span className="text-white/80">Show translation</span>
              <input
                type="checkbox"
                checked={showTranslation}
                onChange={onToggleTranslation}
                className="accent-cinnabar-accent w-4 h-4 shrink-0"
              />
            </label>
            <label className={[
              'flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg border cursor-pointer touch-manipulation',
              compact ? 'min-h-9 text-xs' : 'min-h-11 px-3 py-2.5 text-sm',
              !showTranslation ? 'opacity-40 pointer-events-none' : lyricsLayout === 'sideBySide' ? 'border-cinnabar-accent/50 bg-cinnabar-accent/5' : 'border-cinnabar-800 hover:border-cinnabar-accent/30',
            ].join(' ')}>
              <span className="text-white/80">Side by side</span>
              <input
                type="checkbox"
                checked={lyricsLayout === 'sideBySide'}
                onChange={onToggleLayout}
                disabled={!showTranslation}
                className="accent-cinnabar-accent w-4 h-4 shrink-0"
              />
            </label>
            {!wordPairColoringAvailable && (
              <p className="text-[10px] text-white/55 px-1 text-pretty">
                Word-pair colors need WebGPU (unavailable on this device).
              </p>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-white/60 px-1 py-0.5 text-pretty leading-snug">
            No translation attached — add one in Edit mode.
          </p>
        )}
      </section>

      {/* Cloze drilling. Japanese-only: the engine blanks by part of speech from
          the tokenizer, which only runs on the Japanese side. */}
      {isJapanese && (
        <section className={compact ? 'space-y-1' : 'space-y-2'} aria-label="Practice">
          <div className={compact ? 'border-t border-cinnabar-800/80 pt-1.5' : 'border-t border-cinnabar-800/80 pt-3'} />
          <p className={toolbarSectionLabel}>Practice</p>
          <div className="space-y-1.5">
            <label className={[
              'flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg border cursor-pointer touch-manipulation',
              compact ? 'min-h-9 text-xs' : 'min-h-11 px-3 py-2.5 text-sm',
              clozeMode ? 'border-cinnabar-accent/50 bg-cinnabar-accent/5' : 'border-cinnabar-800 hover:border-cinnabar-accent/30',
            ].join(' ')}>
              <span className="text-white/80">Hide words to recall</span>
              <input
                type="checkbox"
                checked={!!clozeMode}
                onChange={onToggleCloze}
                className="accent-cinnabar-accent w-4 h-4 shrink-0"
              />
            </label>
            {clozeMode && (
              <div className="flex gap-1.5" role="group" aria-label="Difficulty">
                {(['easy', 'medium', 'hard'] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={clozeDifficulty === level}
                    onClick={() => onClozeDifficulty?.(level)}
                    className={[
                      'flex-1 min-h-9 rounded-lg text-[11px] capitalize touch-manipulation transition-colors duration-150',
                      clozeDifficulty === level
                        ? 'bg-cinnabar-accent text-cinnabar-950'
                        : 'border border-cinnabar-800 text-white/70 hover:text-white',
                    ].join(' ')}
                  >
                    {level}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[10px] text-white/60 px-1 text-pretty leading-snug">
              Blanks out content words on the line being sung. Reveal when you want the answer.
            </p>
          </div>
        </section>
      )}

      {phrasingAvailable && (
        <section className={compact ? 'space-y-1' : 'space-y-2'} aria-label="Phrasing">
          <div className={compact ? 'border-t border-cinnabar-800/80 pt-1.5' : 'border-t border-cinnabar-800/80 pt-3'} />
          <p className={toolbarSectionLabel}>Phrasing</p>
          <div className="space-y-1.5">
            <label className={[
              'flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg border cursor-pointer touch-manipulation',
              compact ? 'min-h-9 text-xs' : 'min-h-11 px-3 py-2.5 text-sm',
              phrasingBusy ? 'opacity-50 pointer-events-none' : sungLayoutActive ? 'border-cinnabar-accent/50 bg-cinnabar-accent/5' : 'border-cinnabar-800 hover:border-cinnabar-accent/30',
            ].join(' ')}>
              <span className="text-white/80">Match song phrasing</span>
              <input
                type="checkbox"
                checked={!!sungLayoutActive}
                onChange={onTogglePhrasing}
                disabled={phrasingBusy}
                className="accent-cinnabar-accent w-4 h-4 shrink-0"
              />
            </label>
            <p className="text-[10px] text-white/60 px-1 text-pretty leading-snug">
              Regroup rows to match how the song is actually sung — clearer word pairing and seek points.
            </p>
          </div>
        </section>
      )}
    </>
  )
}

export function DisplayMenu(props: Props) {
  const {
    isJapanese,
    hasTranslation,
    furiganaMode,
    showTranslation,
    lyricsLayout,
    phrasingAvailable,
    sungLayoutActive,
    clozeMode,
  } = props
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; right: number; width: number } | null>(null)
  const isDesktop = useMinWidthMd()
  const customized = hasNonDefaultDisplay(isJapanese, furiganaMode, showTranslation, lyricsLayout, !!sungLayoutActive, !!clozeMode)
  const summary = displaySummary(isJapanese, furiganaMode, showTranslation, lyricsLayout, !!sungLayoutActive, !!clozeMode)

  // <Overlay placement="anchored"> now owns both Escape and the outside-pointerdown
  // dismissal (previously a manual useOutsideDismiss on desktop and a hand-rolled
  // pointerdown listener on mobile). Its dismiss boundary is the panel alone, with
  // no way to also exclude the trigger — so without this, closing the menu by
  // clicking the trigger again would immediately reopen: the outside-dismiss fires
  // on pointerdown (before the trigger's own onClick toggle runs), and that toggle
  // then flips the now-false state back to true. Stopping the trigger's pointerdown
  // from reaching the document-level listener preserves the old click-to-toggle
  // behaviour exactly, on both layouts.
  const stopTriggerPointerDown = (e: ReactPointerEvent) => e.stopPropagation()

  useLayoutEffect(() => {
    if (!open || isDesktop || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const width = Math.min(280, window.innerWidth - 24)
    // Clamp so the panel never extends past the left viewport edge when the
    // trigger sits on the left side of the screen.
    const maxRight = window.innerWidth - width - 12
    setPanelPos({
      top: rect.bottom + 6,
      right: Math.min(Math.max(12, window.innerWidth - rect.right), maxRight),
      width,
    })
  }, [open, isDesktop])

  // Mobile panel is portaled to document.body, so its measured position can't
  // travel through Overlay's className (a static string) — apply it to the
  // panel node directly once it mounts.
  useLayoutEffect(() => {
    if (isDesktop) return
    const el = panelRef.current
    if (!el || !panelPos) return
    el.style.top = `${panelPos.top}px`
    el.style.right = `${panelPos.right}px`
    el.style.width = `${panelPos.width}px`
  })

  if (!isJapanese && !hasTranslation && !phrasingAvailable) return null

  const triggerActive = open || customized

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onPointerDown={stopTriggerPointerDown}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Lyrics display options"
        className={[
          displayMenuTrigger,
          triggerActive ? displayMenuTriggerActive : displayMenuTriggerIdle,
        ].join(' ')}
      >
        <span aria-hidden className="text-sm leading-none">Aa</span>
        <span>Display</span>
        {summary && (
          <span className="hidden sm:inline text-[10px] font-normal text-white/60 truncate max-w-[8rem]">
            · {summary}
          </span>
        )}
      </button>

      {open && isDesktop && (
        <Overlay
          onClose={() => setOpen(false)}
          placement="anchored"
          role="dialog"
          label="Lyrics display options"
          panelRef={panelRef}
          className="absolute left-auto right-0 top-full mt-2 z-50 w-60 rounded-xl border border-cinnabar-800 bg-cinnabar-900 shadow-xl shadow-black/40 p-3 space-y-3 max-h-[70dvh] overflow-y-auto overscroll-contain"
        >
          <DisplayMenuPanel {...props} />
        </Overlay>
      )}

      {open && !isDesktop && panelPos && createPortal(
        <Overlay
          onClose={() => setOpen(false)}
          placement="anchored"
          role="dialog"
          label="Lyrics display options"
          panelRef={panelRef}
          // max-h/overflow: in landscape the panel starts ~155px down a 375px
          // viewport, so its lower rows (Side by side, Match song phrasing) were
          // drawn off the bottom edge with no way to reach them.
          className="fixed z-50 rounded-xl border border-cinnabar-800 bg-cinnabar-900 shadow-xl shadow-black/40 p-2.5 space-y-2 max-h-[70dvh] overflow-y-auto overscroll-contain"
        >
          <DisplayMenuPanel {...props} compact />
        </Overlay>,
        document.body,
      )}
    </div>
  )
}
