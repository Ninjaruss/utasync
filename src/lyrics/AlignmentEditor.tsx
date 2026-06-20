import { useState } from 'react'

interface Props {
  originalLines: string[]
  translationLines: string[]
  /** Pre-computed unmatched translation lines (e.g. from auto-aligner). When
   *  provided these are used instead of computing extras from the slice. */
  extraLines?: string[]
  onConfirm: (pairs: Array<{ original: string; translation: string }>) => void
}

export function AlignmentEditor({ originalLines, translationLines, extraLines, onConfirm }: Props) {
  // Translations are the only mutable side; originals are fixed.
  const [translations, setTranslations] = useState<string[]>(() =>
    Array.from({ length: originalLines.length }, (_, i) => translationLines[i] ?? '')
  )

  // Extra translation lines that couldn't be paired
  const [extras, setExtras] = useState<string[]>(() =>
    extraLines ?? translationLines.slice(originalLines.length)
  )

  const update = (i: number, value: string) =>
    setTranslations((prev) => prev.map((t, j) => (j === i ? value : t)))

  const moveUp = (i: number) => {
    if (i === 0) return
    setTranslations((prev) => {
      const next = [...prev]
      ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
      return next
    })
  }

  const moveDown = (i: number) => {
    if (i >= translations.length - 1) return
    setTranslations((prev) => {
      const next = [...prev]
      ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
      return next
    })
  }

  const clearRow = (i: number) =>
    setTranslations((prev) => prev.map((t, j) => (j === i ? '' : t)))

  const removeExtra = (i: number) =>
    setExtras((prev) => prev.filter((_, j) => j !== i))

  const promoteExtra = (ei: number) => {
    // Find the first empty translation slot and fill it with this extra line.
    const firstEmpty = translations.findIndex((t) => !t.trim())
    if (firstEmpty >= 0) {
      setTranslations((prev) => prev.map((t, j) => (j === firstEmpty ? extras[ei] : t)))
      setExtras((prev) => prev.filter((_, j) => j !== ei))
    }
  }

  const handleConfirm = () => {
    const pairs = originalLines.map((original, i) => ({
      original,
      translation: translations[i] ?? '',
    }))
    onConfirm(pairs.filter((p) => p.original))
  }

  const emptyCount = translations.filter((t) => !t.trim()).length

  return (
    <div className="h-full min-h-0 flex flex-col p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-white font-semibold">Align translations</h2>
          <p className="text-white/40 text-xs mt-0.5 text-pretty">
            Use ↑ ↓ to reorder translations until each row matches its original line.
          </p>
        </div>
        {emptyCount > 0 && (
          <span className="shrink-0 text-[11px] text-yellow-400/80 mt-0.5 tabular-nums">
            {emptyCount} unmatched
          </span>
        )}
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[10px] uppercase tracking-wide text-white/30 px-1 shrink-0">
        <span>Original</span>
        <span>Translation</span>
        <span className="w-14" />
      </div>

      <div className="flex-1 min-h-0 space-y-1.5 overflow-y-auto pr-1">
        {originalLines.map((original, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
            {/* Original — read only */}
            <div
              className="px-2 py-1.5 rounded-lg bg-cinnabar-900/50 text-white/60 text-sm font-jp leading-snug select-none truncate"
              title={original}
            >
              {original || <span className="text-white/20 italic">empty</span>}
            </div>

            {/* Translation — editable */}
            <input
              value={translations[i] ?? ''}
              onChange={(e) => update(i, e.target.value)}
              placeholder="—"
              className={[
                'bg-cinnabar-900 text-sm px-2 py-1.5 rounded-lg outline-none border focus:border-cinnabar-accent',
                translations[i]?.trim()
                  ? 'text-white border-cinnabar-800'
                  : 'text-white/30 border-cinnabar-800/50',
              ].join(' ')}
            />

            {/* Move + clear controls */}
            <div className="flex items-center gap-0.5 w-14 justify-end">
              <button
                onClick={() => moveUp(i)}
                disabled={i === 0}
                className="text-white/30 hover:text-white disabled:opacity-20 text-xs px-1 py-1"
                aria-label="Move translation up"
              >↑</button>
              <button
                onClick={() => moveDown(i)}
                disabled={i >= translations.length - 1}
                className="text-white/30 hover:text-white disabled:opacity-20 text-xs px-1 py-1"
                aria-label="Move translation down"
              >↓</button>
              <button
                onClick={() => clearRow(i)}
                className="text-white/20 hover:text-red-400 text-xs px-1 py-1"
                aria-label="Clear translation"
              >✕</button>
            </div>
          </div>
        ))}
      {/* Extra translation lines that had no original counterpart */}
      {extras.length > 0 && (
        <div className="space-y-1.5 pt-2">
          <p className="text-[10px] uppercase tracking-wide text-white/30">
            Extra lines — move into place or discard
          </p>
          {extras.map((ex, ei) => (
            <div key={ei} className="flex items-center gap-2">
              <div className="flex-1 px-2 py-1.5 rounded-lg bg-cinnabar-900 text-white/50 text-sm italic">
                {ex}
              </div>
              <button
                onClick={() => promoteExtra(ei)}
                className="text-cinnabar-accent text-xs px-2 py-1 rounded-lg border border-cinnabar-accent/40 hover:bg-cinnabar-accent/10 whitespace-nowrap"
              >
                Fill next empty
              </button>
              <button
                onClick={() => removeExtra(ei)}
                className="text-white/30 hover:text-red-400 text-xs px-2"
              >✕</button>
            </div>
          ))}
        </div>
      )}
      </div>

      <button
        onClick={handleConfirm}
        className="w-full py-3 md:py-2.5 bg-cinnabar-accent text-white rounded-xl font-medium shrink-0"
      >
        Confirm pairings
      </button>
    </div>
  )
}
