import { useState } from 'react'
import { dragWindowFor, isAtWindowEdge, DRAG_WINDOW_BACK_SEC, DRAG_WINDOW_FORWARD_SEC } from './dragTiming'
import { peaksWindow, type Peaks } from './waveformPeaks'
import { retimeLoopFor } from './retimeLoop'

interface Props {
  /** Flagged line to re-time, or null to render nothing. */
  lineIndex: number | null
  /** The line's text, shown so the user knows what they are matching. */
  lineText?: string
  /** The line's current start (seconds) — the window opens around here. */
  startSec: number
  /** How many uncertain spots remain in this song, including this one. */
  remaining?: number
  /** Coarse amplitude peaks for the whole track, when they are ready. */
  peaks?: Peaks | null
  /** Why there is no waveform yet, so the strip can say which. */
  waveformState?: 'pending' | 'ready' | 'unavailable'
  /** Live playhead, so the loop can be seen sweeping the window. */
  positionSec?: number
  /** Fires continuously while dragging so the caller can seek and preview. */
  onPreview: (timeSec: number) => void
  /** Fires once, with the chosen time, when the user accepts. `clamped` means the
   * thumb was against a window edge — the line needed to travel further than the
   * control reaches, so the time is the best available, not the right one. */
  onCommit: (lineIndex: number, timeSec: number, opts: { clamped: boolean }) => void
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

/** Columns in the waveform. Finer than the strip is ever drawn, so never blocky. */
const WAVE_COLUMNS = 220

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
 * The waveform is the control. A native range input is still the interaction and
 * accessibility layer — it keeps role=slider, its label, keyboard stepping and
 * click-to-position — but it is transparent, and every mark you see is drawn here
 * on the audio's own axis. That is deliberate: the range thumb is drawn by the
 * browser at a browser-defined size, so a marker aligned to it in Chromium drifts
 * in Gecko. Owning the geometry means the line you drag and the transient you are
 * aiming at cannot disagree.
 */
export function DragRetimeStrip({
  lineIndex, lineText, startSec, remaining, peaks, waveformState, positionSec, onPreview, onCommit,
}: Props) {
  const [value, setValue] = useState(startSec)
  // The window centre is frozen for as long as the strip points at one line, so the
  // range cannot shift under the user's finger mid-drag.
  const [centreSec, setCentreSec] = useState(startSec)
  const [targetLine, setTargetLine] = useState(lineIndex)
  const [seenStartSec, setSeenStartSec] = useState(startSec)

  // React's documented "adjusting state when a prop changes" pattern, not an
  // effect: an effect would cascade an extra render. Re-centre when the target line
  // changes, and also when the SAME line's stored start moves — which happens after
  // a clamped commit, where the line is deliberately left flagged and offered again
  // so the user can walk it further. Comparing against the last start we saw
  // (rather than against centreSec) means an ordinary parent re-render cannot yank
  // the thumb mid-drag; only a genuine change does.
  if (lineIndex !== targetLine || startSec !== seenStartSec) {
    setTargetLine(lineIndex)
    setSeenStartSec(startSec)
    setCentreSec(startSec)
    setValue(startSec)
  }

  if (lineIndex === null) return null

  const win = dragWindowFor(centreSec, DRAG_WINDOW_BACK_SEC, DRAG_WINDOW_FORWARD_SEC)
  const span = win.maxSec - win.minSec
  /** Fraction along the window — the one axis every mark here shares. */
  const at = (t: number) => (span > 0 ? Math.min(1, Math.max(0, (t - win.minSec) / span)) : 0)
  // Not memoized on purpose: 220 columns of a max-reduce is a few hundred ops, and a
  // useMemo would have to sit above the early return to keep hook order, which reads
  // worse than just doing the work.
  const columns = peaksWindow(peaks, win.minSec, win.maxSec, WAVE_COLUMNS)
  const hasWave = columns.some((v) => v > 0.001)
  const loop = retimeLoopFor(value)
  const playheadVisible =
    typeof positionSec === 'number' && positionSec >= win.minSec && positionSec <= win.maxSec
  const more = typeof remaining === 'number' && remaining > 1 ? ` · ${remaining} spots left` : ''

  return (
    <div
      role="status"
      className="relative shrink-0 px-3 sm:px-4 py-2.5 border-b border-cinnabar-900/80 bg-cinnabar-950/80 space-y-2"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-cinnabar-accent" />
      <p className="text-xs text-white/70 leading-snug">
        Drag until the marker sits on the start of the vocal{more}
        {lineText ? <span className="block text-white/45 truncate">{lineText}</span> : null}
      </p>

      {/* One shared geometry: the audio, every marker, and the input that drives
          them all occupy exactly this box, so nothing can drift out of scale. */}
      <div className="relative h-16 rounded-md bg-black/30 overflow-hidden ring-1 ring-white/5 focus-within:ring-2 focus-within:ring-cinnabar-accent">
        {hasWave ? (
          <svg
            viewBox={`0 0 ${WAVE_COLUMNS} 100`}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            aria-hidden="true"
          >
            {/* The stretch that repeats, so it is obvious what you are listening to. */}
            <rect
              x={at(loop.startSec) * WAVE_COLUMNS}
              width={Math.max(0.5, (at(loop.endSec) - at(loop.startSec)) * WAVE_COLUMNS)}
              y="0" height="100" className="fill-white/[0.06]"
            />
            {Array.from(columns).map((v, i) => {
              // Floor so near-silence still draws a hairline: a flat gap in the
              // middle of a waveform reads as broken rather than as quiet.
              const h = Math.max(1.5, v * 88)
              return (
                <rect key={i} x={i + 0.15} width="0.7" y={50 - h / 2} height={h} className="fill-white/35" />
              )
            })}
          </svg>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/35">
            {waveformState === 'pending' ? 'Reading the audio…' : 'No waveform for this track'}
          </div>
        )}

        {/* The live playhead, sweeping the loop. Drawn under the marker so the
            thing being positioned always stays the most legible mark. */}
        {playheadVisible ? (
          <span
            aria-hidden="true"
            className="absolute top-0 bottom-0 w-px bg-white/60"
            style={{ left: `${at(positionSec!) * 100}%` }}
          />
        ) : null}

        {/* Where the line would start: the thing being positioned. */}
        <span
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-cinnabar-accent"
          style={{ left: `${at(value) * 100}%` }}
        >
          <span className="absolute -top-px left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-cinnabar-accent" />
        </span>

        {/* The real control, kept for pointer, keyboard and screen readers. Invisible
            because everything it would draw is drawn above, on the audio's axis. */}
        <input
          type="range"
          min={win.minSec}
          max={win.maxSec}
          step={0.05}
          value={value}
          aria-label={`Line ${lineIndex + 1} start time`}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-manipulation"
          onChange={(e) => {
            const t = Number(e.target.value)
            setValue(t)
            onPreview(t)
          }}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <span className="text-white/70 text-xs tabular-nums">{fmt(value)}</span>
        <button
          type="button"
          onClick={() => onCommit(lineIndex, value, { clamped: isAtWindowEdge(win, value) })}
          className="shrink-0 min-h-11 px-3 rounded-lg bg-cinnabar-accent text-white text-[11px] font-semibold touch-manipulation transition-transform duration-150 ease-out active:scale-[0.96]"
        >
          Use this
        </button>
      </div>
    </div>
  )
}
