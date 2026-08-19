import { useState } from 'react'
import { dragWindowFor, DRAG_WINDOW_BACK_SEC, DRAG_WINDOW_FORWARD_SEC } from './dragTiming'

interface Props {
  /** Flagged line to re-time, or null to render nothing. */
  lineIndex: number | null
  /** The line's text, shown so the user knows what they are matching. */
  lineText?: string
  /** The line's current start (seconds) — the window centres here. */
  startSec: number
  /** How many uncertain spots remain in this song, including this one. */
  remaining?: number
  /** Fires continuously while dragging so the caller can seek and preview. */
  onPreview: (timeSec: number) => void
  /** Fires once, with the chosen time, when the user accepts. */
  onCommit: (lineIndex: number, timeSec: number) => void
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

/**
 * Inline re-timing for a line the aligner was unsure of.
 *
 * Replaces a one-tap affordance that committed the playhead at the moment of the
 * click. That carried the user's reaction latency — roughly 250-400ms, and always
 * in the same direction, late — straight into stored timing, where it was then
 * marked 'good' and never revisited. Measured on a real song, tapping the ~4
 * flagged spots left a 0.30s mean start error with no line worse than 0.82s: the
 * same order as the latency itself.
 *
 * Dragging removes that term entirely. The user adjusts until it matches, hearing
 * the result as they go, and can overshoot and correct — which a tap structurally
 * cannot allow.
 *
 * Styled to match `Banner` (same rail, padding and type scale) rather than using
 * it: Banner renders its children inside a <p>, and this control needs a slider
 * and a button, which cannot legally nest there.
 */
export function DragRetimeStrip({
  lineIndex, lineText, startSec, remaining, onPreview, onCommit,
}: Props) {
  const [value, setValue] = useState(startSec)
  // The window centre is frozen for as long as the strip points at one line, so
  // the range cannot shift under the user's finger mid-drag. Same reasoning as
  // TimestampPopover's frozen scrub centre.
  const [centreSec, setCentreSec] = useState(startSec)
  const [targetLine, setTargetLine] = useState(lineIndex)

  // React's documented "adjusting state when a prop changes" pattern, not an
  // effect: re-centre only when the TARGET line changes. Doing this in an effect
  // would cascade an extra render, and keying it on startSec as well would reset
  // the thumb whenever the parent re-rendered with an updated line.
  if (lineIndex !== targetLine) {
    setTargetLine(lineIndex)
    setCentreSec(startSec)
    setValue(startSec)
  }

  if (lineIndex === null) return null

  const win = dragWindowFor(centreSec, DRAG_WINDOW_BACK_SEC, DRAG_WINDOW_FORWARD_SEC)
  const more = typeof remaining === 'number' && remaining > 1 ? ` · ${remaining} spots left` : ''

  return (
    <div
      role="status"
      className="relative shrink-0 px-3 sm:px-4 py-2.5 border-b border-cinnabar-900/80 bg-cinnabar-950/80 space-y-2"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-cinnabar-accent" />
      <p className="text-xs text-white/70 leading-snug">
        Drag until it lines up with what you hear{more}
        {lineText ? <span className="block text-white/45 truncate">{lineText}</span> : null}
      </p>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={win.minSec}
          max={win.maxSec}
          step={0.05}
          value={value}
          aria-label={`Line ${lineIndex + 1} start time`}
          className="flex-1 accent-cinnabar-accent slider-touch"
          onChange={(e) => {
            const t = Number(e.target.value)
            setValue(t)
            onPreview(t)
          }}
        />
        <span className="text-white/70 text-xs tabular-nums w-16 text-right">{fmt(value)}</span>
        <button
          type="button"
          onClick={() => onCommit(lineIndex, value)}
          className="shrink-0 min-h-11 px-3 rounded-lg bg-cinnabar-accent text-white text-[11px] font-semibold touch-manipulation transition-transform duration-150 ease-out active:scale-[0.96]"
        >
          Use this
        </button>
      </div>
    </div>
  )
}
