import { useRef, useState } from 'react'
import type { FuriganaMode, LyricsLayout } from '../core/types'
import { useOutsideDismiss } from '../core/ui/useOutsideDismiss'
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
  onFuriganaCycle: () => void
  onToggleTranslation: () => void
  onToggleLayout: () => void
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
): boolean {
  if (isJapanese && furiganaMode !== 'furigana') return true
  if (!showTranslation) return true
  if (lyricsLayout === 'sideBySide') return true
  return false
}

function displaySummary(
  isJapanese: boolean,
  furiganaMode: FuriganaMode,
  showTranslation: boolean,
  lyricsLayout: LyricsLayout,
): string | null {
  const parts: string[] = []
  if (isJapanese && furiganaMode !== 'furigana') parts.push(FURIGANA_LABEL[furiganaMode])
  if (!showTranslation) parts.push('No translation')
  else if (lyricsLayout === 'sideBySide') parts.push('Side by side')
  return parts.length > 0 ? parts.join(' · ') : null
}

export function DisplayMenu({
  isJapanese,
  hasTranslation,
  furiganaMode,
  showTranslation,
  lyricsLayout,
  wordPairColoringAvailable = true,
  onFuriganaCycle,
  onToggleTranslation,
  onToggleLayout,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const customized = hasNonDefaultDisplay(isJapanese, furiganaMode, showTranslation, lyricsLayout)
  const summary = displaySummary(isJapanese, furiganaMode, showTranslation, lyricsLayout)

  useOutsideDismiss(rootRef, open, () => setOpen(false))

  if (!isJapanese && !hasTranslation) return null

  const triggerActive = open || customized

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
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

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 sm:hidden"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Lyrics display options"
            className="fixed left-4 right-4 top-[calc(env(safe-area-inset-top,0px)+3.75rem)] z-50 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-60 rounded-xl border border-cinnabar-800 bg-cinnabar-900 shadow-xl shadow-black/40 p-3 space-y-3 max-h-[min(70dvh,24rem)] overflow-y-auto"
          >
            {isJapanese && (
              <section className="space-y-2" aria-label="Reading aids">
                <p className={toolbarSectionLabel}>Reading</p>
                <button
                  type="button"
                  onClick={onFuriganaCycle}
                  className={[
                    toolbarChipBtn, 'w-full text-left px-3',
                    furiganaMode !== 'none' ? toolbarChipBtnActive : toolbarChipBtnIdle,
                  ].join(' ')}
                >
                  <span className="text-sm">{FURIGANA_LABEL[furiganaMode]}</span>
                  <span className="block text-[10px] text-white/35 mt-0.5 text-pretty">Tap to cycle</span>
                </button>
              </section>
            )}

            {hasTranslation && (
              <section className="space-y-2" aria-label="Translation layout">
                {isJapanese && <div className="border-t border-cinnabar-800/80 pt-3" />}
                <p className={toolbarSectionLabel}>Translation</p>
                <div className="space-y-1.5">
                  <label className={[
                    'flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border cursor-pointer touch-manipulation min-h-11',
                    showTranslation ? 'border-cinnabar-accent/50 bg-cinnabar-accent/5' : 'border-cinnabar-800 hover:border-cinnabar-accent/30',
                  ].join(' ')}>
                    <span className="text-sm text-white/80">Show translation</span>
                    <input
                      type="checkbox"
                      checked={showTranslation}
                      onChange={onToggleTranslation}
                      className="accent-cinnabar-accent w-5 h-5 shrink-0"
                    />
                  </label>
                  <label className={[
                    'flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border cursor-pointer touch-manipulation min-h-11',
                    !showTranslation ? 'opacity-40 pointer-events-none' : lyricsLayout === 'sideBySide' ? 'border-cinnabar-accent/50 bg-cinnabar-accent/5' : 'border-cinnabar-800 hover:border-cinnabar-accent/30',
                  ].join(' ')}>
                    <span className="text-sm text-white/80">Side by side</span>
                    <input
                      type="checkbox"
                      checked={lyricsLayout === 'sideBySide'}
                      onChange={onToggleLayout}
                      disabled={!showTranslation}
                      className="accent-cinnabar-accent w-5 h-5 shrink-0"
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
          </div>
        </>
      )}
    </div>
  )
}
