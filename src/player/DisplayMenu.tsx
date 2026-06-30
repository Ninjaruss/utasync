import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FuriganaMode, LyricsLayout } from '../core/types'
import { useOutsideDismiss } from '../core/ui/useOutsideDismiss'
import { useMinWidthMd } from '../core/ui/useMinWidthMd'
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
): boolean {
  if (isJapanese && furiganaMode !== 'furigana') return true
  if (!showTranslation) return true
  if (lyricsLayout === 'sideBySide') return true
  if (sungLayoutActive) return true
  return false
}

function displaySummary(
  isJapanese: boolean,
  furiganaMode: FuriganaMode,
  showTranslation: boolean,
  lyricsLayout: LyricsLayout,
  sungLayoutActive: boolean,
): string | null {
  const parts: string[] = []
  if (isJapanese && furiganaMode !== 'furigana') parts.push(FURIGANA_LABEL[furiganaMode])
  if (!showTranslation) parts.push('No translation')
  else if (lyricsLayout === 'sideBySide') parts.push('Side by side')
  if (sungLayoutActive) parts.push('Sung phrasing')
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
            {!compact && <span className="block text-[10px] text-white/35 mt-0.5 text-pretty">Tap to cycle</span>}
          </button>
        </section>
      )}

      {hasTranslation && (
        <section className={compact ? 'space-y-1' : 'space-y-2'} aria-label="Translation layout">
          {isJapanese && <div className={compact ? 'border-t border-cinnabar-800/80 pt-1.5' : 'border-t border-cinnabar-800/80 pt-3'} />}
          <p className={toolbarSectionLabel}>Translation</p>
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
              <p className="text-[10px] text-white/30 px-1 text-pretty">
                Word-pair colors need WebGPU (unavailable on this device).
              </p>
            )}
          </div>
        </section>
      )}

      {phrasingAvailable && (
        <section className={compact ? 'space-y-1' : 'space-y-2'} aria-label="Phrasing">
          {(isJapanese || hasTranslation) && <div className={compact ? 'border-t border-cinnabar-800/80 pt-1.5' : 'border-t border-cinnabar-800/80 pt-3'} />}
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
            <p className="text-[10px] text-white/35 px-1 text-pretty leading-snug">
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
  } = props
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; right: number; width: number } | null>(null)
  const isDesktop = useMinWidthMd()
  const customized = hasNonDefaultDisplay(isJapanese, furiganaMode, showTranslation, lyricsLayout, !!sungLayoutActive)
  const summary = displaySummary(isJapanese, furiganaMode, showTranslation, lyricsLayout, !!sungLayoutActive)

  useOutsideDismiss(rootRef, open && isDesktop, () => setOpen(false))

  useLayoutEffect(() => {
    if (!open || isDesktop || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const width = Math.min(280, window.innerWidth - 24)
    setPanelPos({
      top: rect.bottom + 6,
      right: Math.max(12, window.innerWidth - rect.right),
      width,
    })
  }, [open, isDesktop])

  useEffect(() => {
    if (!open || isDesktop) return
    const onPointerDown = (e: Event) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, isDesktop])

  if (!isJapanese && !hasTranslation && !phrasingAvailable) return null

  const triggerActive = open || customized

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
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
          <span className="hidden sm:inline text-[10px] font-normal text-white/40 truncate max-w-[8rem]">
            · {summary}
          </span>
        )}
      </button>

      {open && isDesktop && (
        <div
          role="dialog"
          aria-label="Lyrics display options"
          className="absolute left-auto right-0 top-full mt-2 z-50 w-60 rounded-xl border border-cinnabar-800 bg-cinnabar-900 shadow-xl shadow-black/40 p-3 space-y-3"
        >
          <DisplayMenuPanel {...props} />
        </div>
      )}

      {open && !isDesktop && panelPos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Lyrics display options"
          style={{
            top: panelPos.top,
            right: panelPos.right,
            width: panelPos.width,
          }}
          className="fixed z-50 rounded-xl border border-cinnabar-800 bg-cinnabar-900 shadow-xl shadow-black/40 p-2.5 space-y-2"
        >
          <DisplayMenuPanel {...props} compact />
        </div>,
        document.body,
      )}
    </div>
  )
}
