import { useState } from 'react'

interface Props {
  time: number
  playhead: () => number
  onCommit: (time: number) => void
  onClose: () => void
  onScrub?: (time: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
}

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '—'
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

/**
 * Replaces instant tap-to-stamp: opening this popover never overwrites the
 * timestamp by itself. Dragging the slider previews the audio position in
 * real time; nothing is committed until Done.
 */
export function TimestampPopover({ time, playhead: _playhead, onCommit, onClose, onScrub, onScrubStart, onScrubEnd }: Props) {
  const [draft, setDraft] = useState(time)
  const min = Math.max(0, time - 15)
  const max = time + 15

  return (
    <div
      className="absolute z-20 mt-1 left-0 right-0 rounded-xl border border-cinnabar-accent/60 bg-cinnabar-900 p-3 space-y-2 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-[10px] text-white/40 text-center">Drag to preview · Done to save · tap outside or another line to cancel</p>
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={draft}
        onPointerDown={() => onScrubStart?.()}
        onPointerUp={() => onScrubEnd?.()}
        onChange={(e) => {
          const t = Number(e.target.value)
          setDraft(t)
          onScrub?.(t)
        }}
        aria-label="Scrub timestamp"
        className="w-full accent-cinnabar-accent"
      />
      <div className="flex items-center justify-center text-xs">
        <span className="text-white/70 tabular-nums font-semibold">{fmt(draft)}</span>
      </div>
      <button
        type="button"
        onClick={() => { onCommit(draft); onClose() }}
        className="w-full py-1.5 rounded-lg bg-cinnabar-accent text-white text-xs font-medium touch-manipulation"
      >
        Done
      </button>
    </div>
  )
}
