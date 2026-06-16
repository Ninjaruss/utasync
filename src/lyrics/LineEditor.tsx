import { useState } from 'react'
import type { TimedLine } from '../core/types'

interface Props {
  line: TimedLine
  /** Reads the live audio position when the user taps "Set start". */
  playhead: () => number
  onChange: (patch: { startTime?: number; original?: string; translation?: string }) => void
  onAdd: () => void
  onDelete: () => void
}

function fmt(t: number): string {
  if (!(t > 0)) return '—'
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

export function LineEditor({ line, playhead, onChange, onAdd, onDelete }: Props) {
  // Local draft state for the two text fields, committed to the parent on blur.
  // A row is expanded one at a time and keyed by line, so initialising from the
  // prop is sufficient; stable-id keys (follow-up) handle identity changes.
  const [original, setOriginal] = useState(line.original)
  const [translation, setTranslation] = useState(line.translation)

  return (
    <div className="rounded-xl border border-cinnabar-accent/60 bg-cinnabar-accent/8 p-3 space-y-2">
      <input
        value={original}
        onChange={(e) => setOriginal(e.target.value)}
        onBlur={() => original !== line.original && onChange({ original })}
        className="w-full bg-cinnabar-950 text-white text-sm px-2 py-1.5 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent font-jp"
        aria-label="Original text"
      />
      <input
        value={translation}
        onChange={(e) => setTranslation(e.target.value)}
        onBlur={() => translation !== line.translation && onChange({ translation })}
        className="w-full bg-cinnabar-950 text-white/80 text-sm px-2 py-1.5 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent"
        aria-label="Translation text"
      />
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <button
          onClick={() => onChange({ startTime: playhead() })}
          className="px-2.5 py-1 rounded-lg bg-cinnabar-accent text-white font-medium"
        >
          ⏱ Set start @ {fmt(line.startTime)}
        </button>
        <button onClick={() => onChange({ startTime: Math.max(0, line.startTime - 0.1) })}
          className="px-2 py-1 rounded-lg bg-cinnabar-900 text-white/70">−0.1</button>
        <button onClick={() => onChange({ startTime: line.startTime + 0.1 })}
          className="px-2 py-1 rounded-lg bg-cinnabar-900 text-white/70">+0.1</button>
        <button onClick={onAdd} className="px-2 py-1 rounded-lg bg-cinnabar-900 text-white/70">⊕ add</button>
        <button onClick={onDelete} aria-label="Delete line" className="px-2 py-1 rounded-lg bg-cinnabar-900 text-red-400 ml-auto">🗑</button>
      </div>
    </div>
  )
}
