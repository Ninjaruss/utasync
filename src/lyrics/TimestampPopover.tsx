import { useState } from 'react'

interface Props {
  time: number
  playhead: () => number
  onCommit: (time: number) => void
  onClose: () => void
}

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '—'
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

/**
 * Replaces instant tap-to-stamp: opening this popover never overwrites the
 * timestamp by itself. Dragging the slider or tapping "Use current" only
 * updates a local draft; nothing is committed until Done.
 */
export function TimestampPopover({ time, playhead, onCommit, onClose }: Props) {
  const [draft, setDraft] = useState(time)
  const min = Math.max(0, time - 15)
  const max = time + 15

  return (
    <div
      className="absolute z-20 mt-1 left-0 right-0 rounded-xl border border-cinnabar-accent/60 bg-cinnabar-900 p-3 space-y-2 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        aria-label="Scrub timestamp"
        className="w-full accent-cinnabar-accent"
      />
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/70 tabular-nums">{fmt(draft)}</span>
        <button
          onClick={() => setDraft(playhead())}
          className="px-2 py-1 rounded-lg bg-cinnabar-950 text-cinnabar-accent"
        >
          Use current ▶ {fmt(playhead())}
        </button>
      </div>
      <button
        onClick={() => { onCommit(draft); onClose() }}
        className="w-full py-1.5 rounded-lg bg-cinnabar-accent text-white text-xs font-medium"
      >
        Done
      </button>
    </div>
  )
}
