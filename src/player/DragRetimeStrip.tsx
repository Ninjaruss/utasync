import { useState } from 'react'
import {
  dragWindowFor,
  isAtWindowEdge,
  stepRetimeTime,
  RETIME_STEPS,
  DRAG_WINDOW_BACK_SEC,
  DRAG_WINDOW_FORWARD_SEC,
} from './dragTiming'
import { type Peaks } from './waveformPeaks'
import { retimeLoopFor } from './retimeLoop'
import { WaveformStrip } from './WaveformStrip'
import { TimingDragInput } from './TimingDragInput'

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
 * The waveform is the control. A transparent range keeps native keyboard and
 * accessibility support, while pointer capture handles waveform dragging and
 * edge panning. Every mark you see is drawn here
 * on the audio's own axis. That is deliberate: the range thumb is drawn by the
 * browser at a browser-defined size, so a marker aligned to it in Chromium drifts
 * in Gecko. Owning the geometry means the line you drag and the transient you are
 * aiming at cannot disagree.
 */
export function DragRetimeStrip({
  lineIndex, lineText, startSec, remaining, peaks, waveformState, positionSec, onPreview, onCommit,
}: Props) {
  const [value, setValue] = useState(startSec)
  // Keep the window steady for fine adjustments; only edge dragging pans it.
  const [pointerWindow, setPointerWindow] = useState<{ minSec: number; maxSec: number } | null>(null)
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
    setPointerWindow(null)
    setCentreSec(startSec)
    setValue(startSec)
  }

  if (lineIndex === null) return null

  /* Walk the line by a fixed step, taking the window with it.
   *
   * The window is frozen only for the duration of a DRAG, so re-centring here is
   * safe and is the whole point: after a step the value sits back inside the
   * range instead of pinned to its edge, so the next step (or drag) reaches
   * further rather than dead-ending. That is what makes a line whose real start
   * lies outside the window reachable at all — and at the drag's full precision,
   * since the window itself never had to be widened. */
  const step = (delta: number) => {
    const t = stepRetimeTime(value, delta)
    setValue(t)
    setPointerWindow(null)
    setCentreSec(t)
    onPreview(t)
  }

  const win = pointerWindow ?? dragWindowFor(centreSec, DRAG_WINDOW_BACK_SEC, DRAG_WINDOW_FORWARD_SEC)
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

        <TimingDragInput
          min={win.minSec}
          max={win.maxSec}
          step={0.05}
          value={value}
          label={`Line ${lineIndex + 1} start time`}
          onChange={(t) => { setValue(t); onPreview(t) }}
          onWindowChange={(minSec, maxSec) => setPointerWindow({ minSec, maxSec })}
          onDragEnd={() => { setCentreSec(value); setPointerWindow(null) }}
        />
      </div>

      <p className="text-[11px] text-white/50">Hold the marker at either edge to move further.</p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {/* Step buttons: the drag window reaches ±2.5/+6s around where the line
            sits, which is too short for a line whose real start is further out —
            a song with a long instrumental intro, most often. These walk the line
            out to it and take the window along, so the drag keeps its precision. */}
        {RETIME_STEPS.map((delta) => (
          <button
            key={delta}
            type="button"
            onClick={() => step(delta)}
            aria-label={`Move this line ${Math.abs(delta)} second${Math.abs(delta) === 1 ? '' : 's'} ${delta < 0 ? 'earlier' : 'later'}`}
            className="shrink-0 min-w-10 min-h-11 px-1.5 rounded-lg border border-cinnabar-800 text-white/70 text-[11px] font-medium tabular-nums touch-manipulation hover:text-white hover:border-cinnabar-accent/50 transition-[color,border-color,transform] duration-150 ease-out active:scale-[0.96]"
          >
            {delta < 0 ? '−' : '+'}{Math.abs(delta)}s
          </button>
        ))}
        <span aria-hidden="true" className="ml-auto text-white/70 text-xs tabular-nums">{fmt(value)}</span>
        <button
          type="button"
          onClick={() => onCommit(lineIndex, value, { clamped: value > 0 && isAtWindowEdge(win, value) })}
          className="shrink-0 min-h-11 px-3 rounded-lg bg-cinnabar-accent text-cinnabar-950 text-[11px] font-semibold touch-manipulation transition-transform duration-150 ease-out active:scale-[0.96]"
        >
          Use this
        </button>
      </div>
    </div>
  )
}
