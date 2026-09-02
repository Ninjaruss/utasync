import { useState } from 'react'
import { dragWindowFor, isAtWindowEdge, DRAG_WINDOW_BACK_SEC, DRAG_WINDOW_FORWARD_SEC } from './dragTiming'
import { type Peaks } from './waveformPeaks'
import { retimeLoopFor } from './retimeLoop'
import { WaveformStrip } from './WaveformStrip'

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
  const loop = retimeLoopFor(value)
  const more = typeof remaining === 'number' && remaining > 1 ? ` · ${remaining} lines left` : ''
  /* A YouTube-only song never gets peaks, so "drag to the first sound" pointed at
   * an empty box that also read there was no waveform — an instruction the user
   * cannot follow next to what looks like a failure. With no picture to aim at,
   * the job is done by ear against the playhead, so say that instead.
   *
   * This mirrors WaveformStrip's own draw condition exactly, rather than
   * approximating it: the instruction and the box are two halves of one message,
   * and any drift between them puts a contradiction on screen. In particular
   * 'pending' is NOT by-ear — the peaks are still coming, and telling the user to
   * work by ear only to swap the instruction out from under them a moment later
   * is its own small betrayal. */
  const waveformDrawn = waveformState === 'ready' && peaks != null && peaks.data.length > 0
  const byEar = !waveformDrawn && waveformState !== 'pending'

  return (
    <div className="relative shrink-0 px-3 sm:px-4 py-2.5 border-b border-cinnabar-900/80 bg-cinnabar-950/80 space-y-2">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-cinnabar-accent" />
      {/* The live region is the standing instruction ONLY. It used to wrap the whole
          strip, which meant every 0.05s of drag re-announced everything inside —
          a screen reader barrage aimed at the users least able to absorb it. What
          changes during a drag is the slider's own value, which it reports itself. */}
      <p role="status" className="text-xs text-white/70 leading-snug">
        {byEar
          ? `Play the line and drag the marker to where the singing starts${more}`
          : `Drag the marker to the first sound of this line${more}`}
        {lineText ? <span className="block text-white/45 truncate">{lineText}</span> : null}
      </p>

      {/* One shared geometry: the audio, every marker, and the input that drives
          them all occupy exactly this box, so nothing can drift out of scale. */}
      <div className="relative h-16 rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-cinnabar-accent">
        <WaveformStrip
          peaks={peaks}
          waveformState={waveformState}
          minSec={win.minSec}
          maxSec={win.maxSec}
          regions={[{ startSec: loop.startSec, endSec: loop.endSec }]}
          markers={[{ timeSec: value, label: 'line start' }]}
          positionSec={positionSec}
        />

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
        <span aria-hidden="true" className="text-white/70 text-xs tabular-nums">{fmt(value)}</span>
        <button
          type="button"
          onClick={() => onCommit(lineIndex, value, { clamped: isAtWindowEdge(win, value) })}
          className="shrink-0 min-h-11 px-3 rounded-lg bg-cinnabar-accent text-cinnabar-950 text-[11px] font-semibold touch-manipulation transition-transform duration-150 ease-out active:scale-[0.96]"
        >
          Use this
        </button>
      </div>
    </div>
  )
}
