import { useState } from 'react'
import type { TimedLine } from '../core/types'

interface Props {
  line: TimedLine
  /** Where an auto end lands right now (next line's start), for slider init/display. */
  autoEnd: number
  playhead: () => number
  /** `shiftRestBy` (seconds) asks the editor to shift every following line by that
   * delta too — the "this whole section drifted" cascade. Omitted/0 = this line only. */
  onCommit: (patch: { start: number; end: number | null; shiftRestBy?: number }) => void
  onClose: () => void
  onScrub?: (time: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
  /** Whether a following line exists — gates the "shift later lines too" toggle. */
  canCascade?: boolean
  /** Previous line's start, for the context strip's spatial bearing (0 for the first line). */
  prevStart?: number
}

/** Half-width (seconds) of the scrub window on each side of the drag anchor. Small
 * enough that dragging across the slider is a fine local adjustment (12s total, not
 * 30s), which — with the frozen-during-drag window below — keeps the thumb tracking
 * the finger instead of the old spring-return that jumped seconds at a time. */
const WINDOW_HALF = 6

type Mode = 'start' | 'end' | 'line'

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '—'
  // Keep tenths — sub-second nudges (±0.1s) must be visible in the readout.
  const rounded = Math.round(t * 10) / 10
  const m = Math.floor(rounded / 60)
  const s = rounded - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

const round1 = (t: number) => Math.round(t * 10) / 10

/** A small spatial bearing: the current scrub window drawn as a track, with the
 * draft start/end and the neighbouring lines' starts placed on it so the user can
 * see WHERE in the song this line sits — not just a bare number. The track spans
 * the same [min, max] as the slider directly below it, so a marker's horizontal
 * position matches the thumb. Neighbours outside the window collapse to an edge
 * arrow instead of vanishing. */
function ContextStrip({
  min, max, draftStart, draftEnd, prevStart, nextStart, mode,
}: {
  min: number
  max: number
  draftStart: number
  draftEnd: number | null
  prevStart?: number
  nextStart: number | null
  mode: Mode
}) {
  const span = max - min
  const pct = (t: number) => ((t - min) / span) * 100
  const inWindow = (t: number | null | undefined): t is number =>
    typeof t === 'number' && Number.isFinite(t) && t >= min && t <= max
  const gap = (a: number, b?: number) =>
    typeof b === 'number' && Number.isFinite(b) ? Math.abs(round1(a - b)) : null
  const prevGap = gap(draftStart, prevStart)
  const nextGap = gap(draftStart, nextStart ?? undefined)

  const marker = (t: number, cls: string, label?: string, key?: string) => (
    <div
      key={key}
      className="absolute top-0 bottom-0 flex flex-col items-center -translate-x-1/2"
      style={{ left: `${Math.max(0, Math.min(100, pct(t)))}%` }}
    >
      <div className={`w-0.5 h-full rounded-full ${cls}`} />
      {label && <span className="absolute -bottom-4 text-[9px] leading-none text-white/60 whitespace-nowrap">{label}</span>}
    </div>
  )

  return (
    <div className="pb-4">
      <div className="relative h-6 rounded-md bg-cinnabar-950 border border-cinnabar-800 overflow-hidden">
        {/* neighbours first (behind), then draft on top */}
        {inWindow(prevStart) && marker(prevStart, 'bg-white/25', 'prev', 'prev')}
        {inWindow(nextStart) && marker(nextStart, 'bg-white/25', 'next', 'next')}
        {/* start always shows as the anchor; in End mode it's the dimmer reference the end moves relative to */}
        {inWindow(draftStart) && marker(draftStart, mode === 'end' ? 'bg-cinnabar-accent/50' : 'bg-cinnabar-accent', undefined, 'ds')}
        {draftEnd !== null && inWindow(draftEnd) && marker(draftEnd, mode === 'end' ? 'bg-cinnabar-accent' : 'bg-cinnabar-accent/60', undefined, 'de')}
        {/* edge arrows when a neighbour is off-window, so the user still has a direction */}
        {typeof prevStart === 'number' && prevStart < min && (
          <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[9px] text-white/55">◂ prev</span>
        )}
        {typeof nextStart === 'number' && Number.isFinite(nextStart) && nextStart > max && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-white/55">next ▸</span>
        )}
      </div>
      {(prevGap !== null || nextGap !== null) && (
        <div className="mt-0.5 flex justify-between text-[10px] text-white/60 tabular-nums">
          <span>{prevGap !== null ? `${prevGap}s after prev` : ''}</span>
          <span>{nextGap !== null ? `${nextGap}s before next` : ''}</span>
        </div>
      )}
    </div>
  )
}

const anchorTabBase = 'flex-1 min-h-11 py-1 rounded-lg text-xs font-medium touch-manipulation transition-colors'
const nudgeBtn =
  'min-h-11 flex-1 rounded-lg border border-cinnabar-800 text-white/70 text-xs tabular-nums touch-manipulation hover:border-cinnabar-accent/50 hover:text-white transition-[color,border-color,transform] duration-150 ease-out active:scale-[0.96]'
const anchorTabOn = 'bg-cinnabar-accent text-white'
const anchorTabOff = 'bg-cinnabar-950 text-white/50'

/**
 * Edits a line's timing without committing until Done. A Start | End | Line
 * toggle picks what the slider/nudges move: Start or End scrubs that one anchor;
 * Line shifts the whole line (start+end together) — the "this line came in
 * late/early" fix. End starts as "Auto" (follows the next line) until dragged.
 * With following lines present, "Shift later lines too" propagates the same
 * offset to the rest of the song. Dragging previews the audio position live.
 */
export function TimestampPopover({ line, autoEnd, playhead, onCommit, onClose, onScrub, onScrubStart, onScrubEnd, canCascade = false, prevStart }: Props) {
  const hasExplicitEnd = line.endTime > line.startTime
  const [mode, setMode] = useState<Mode>('start')
  const [draftStart, setDraftStart] = useState(line.startTime)
  const [draftEnd, setDraftEnd] = useState<number | null>(hasExplicitEnd ? line.endTime : null)
  const [cascade, setCascade] = useState(false)
  // While a drag is active this holds the window centre captured at pointer-down,
  // so min/max stay FIXED for the whole gesture and the thumb tracks the finger.
  // null = idle, window re-centres on the current value (so the next grab, or a
  // "Use current position" jump, starts anchored under the thumb).
  const [dragCenter, setDragCenter] = useState<number | null>(null)

  // Slider value for the active mode. An auto end scrubs from where it currently
  // lands so grabbing the slider feels anchored, not arbitrary.
  const autoEndTarget = Number.isFinite(autoEnd) ? autoEnd : draftStart + 3
  const effectiveEnd = draftEnd ?? autoEndTarget
  const value = mode === 'end' ? effectiveEnd : draftStart
  // Fixed ±WINDOW_HALF window. Its centre is frozen at drag start (dragCenter) so
  // the range doesn't shift under the thumb mid-gesture — the old bug where the
  // window followed the live draft made every push spring back to centre and race
  // the value by seconds. When idle the centre is the current value, so releasing
  // and grabbing again re-anchors to travel further than one window.
  const center = dragCenter ?? value
  const min = mode === 'end' ? Math.max(draftStart + 0.1, center - WINDOW_HALF) : Math.max(0, center - WINDOW_HALF)
  const max = center + WINDOW_HALF

  const setStart = (t: number) => {
    const v = round1(Math.max(0, t))
    setDraftStart(v)
    // Keep an explicit end from being overtaken while moving the start.
    if (draftEnd !== null && draftEnd < v) setDraftEnd(v)
    onScrub?.(v)
  }
  const setEnd = (t: number) => {
    const v = round1(Math.max(draftStart + 0.1, t))
    setDraftEnd(v)
    onScrub?.(v)
  }
  // Move the whole line, preserving duration. Clamp at 0 so the start never goes
  // negative (the end slides by the same amount that the start actually moved).
  const shiftLineBy = (delta: number) => {
    const eff = Math.max(delta, -draftStart)
    const ns = round1(draftStart + eff)
    setDraftStart(ns)
    if (draftEnd !== null) setDraftEnd(round1(draftEnd + eff))
    onScrub?.(ns)
  }
  const moveLine = (t: number) => shiftLineBy(round1(Math.max(0, t)) - draftStart)
  const move = (t: number) => (mode === 'start' ? setStart(t) : mode === 'end' ? setEnd(t) : moveLine(t))
  const nudge = (delta: number) =>
    mode === 'start' ? setStart(draftStart + delta)
    : mode === 'end' ? setEnd(effectiveEnd + delta)
    : shiftLineBy(delta)
  const useCurrentPosition = () => {
    const p = playhead()
    if (!Number.isFinite(p)) return
    if (mode === 'start') setStart(p)
    else if (mode === 'end') setEnd(p)
    else moveLine(p)
  }

  const startDelta = round1(draftStart - line.startTime)
  const selectMode = (m: Mode) => {
    setMode(m)
    // The cascade only belongs to whole-line moves; leaving that mode clears it so
    // a checkbox ticked earlier can never silently shift the song from another tab.
    if (m !== 'line') setCascade(false)
  }
  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => selectMode(m)}
      className={`${anchorTabBase} ${mode === m ? anchorTabOn : anchorTabOff}`}
    >
      {label}
    </button>
  )

  return (
    <div
      className="absolute z-20 mt-1 left-0 right-0 rounded-xl border border-cinnabar-accent/60 bg-cinnabar-900 p-3 space-y-2 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex gap-1" role="tablist" aria-label="Timestamp anchor">
        {tab('start', 'Start')}
        {tab('end', 'End')}
        {tab('line', 'Whole line')}
      </div>
      <p className="text-xs text-white/60 text-center text-pretty">
        {mode === 'line' ? 'Moves the whole line · ' : ''}Drag to preview · tap outside to cancel
      </p>
      <ContextStrip
        min={min}
        max={max}
        draftStart={draftStart}
        draftEnd={draftEnd}
        prevStart={prevStart}
        nextStart={Number.isFinite(autoEnd) ? autoEnd : null}
        mode={mode}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onPointerDown={() => { setDragCenter(value); onScrubStart?.() }}
        onPointerUp={() => { setDragCenter(null); onScrubEnd?.() }}
        onPointerCancel={() => { setDragCenter(null); onScrubEnd?.() }}
        onChange={(e) => move(Number(e.target.value))}
        aria-label={mode === 'start' ? 'Scrub start timestamp' : mode === 'end' ? 'Scrub end timestamp' : 'Move whole line'}
        className="w-full accent-cinnabar-accent slider-touch"
      />
      <div className="flex items-center gap-1.5">
        {([-0.5, -0.1, 0.1, 0.5] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => nudge(d)}
            aria-label={`${d < 0 ? 'Back' : 'Forward'} ${Math.abs(d)} seconds`}
            className={nudgeBtn}
          >
            {d > 0 ? '+' : '−'}{Math.abs(d)}s
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={useCurrentPosition}
        className="w-full min-h-11 rounded-lg border border-dashed border-cinnabar-800 text-white/60 text-xs touch-manipulation hover:border-cinnabar-accent/50 hover:text-white transition-[color,border-color,transform] duration-150 ease-out active:scale-[0.96]"
      >
        Use current position
      </button>
      {canCascade && mode === 'line' && (
        <label className="flex items-center gap-2 min-h-11 px-1 text-xs text-white/70 touch-manipulation cursor-pointer">
          <input
            type="checkbox"
            checked={cascade}
            onChange={(e) => setCascade(e.target.checked)}
            className="accent-cinnabar-accent w-4 h-4 shrink-0"
          />
          <span className="text-pretty">
            Shift later lines by the same amount
            {cascade && startDelta !== 0 && (
              <span className="text-white/60 tabular-nums"> ({startDelta > 0 ? '+' : '−'}{Math.abs(startDelta)}s)</span>
            )}
          </span>
        </label>
      )}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 text-xs">
          <span className={`tabular-nums ${mode !== 'end' ? 'text-white font-semibold' : 'text-white/60'}`}>{fmt(draftStart)}</span>
          <span className="text-white/55">–</span>
          <span className={`tabular-nums ${mode !== 'start' ? 'text-white font-semibold' : 'text-white/60'}`}>
            {draftEnd === null ? 'auto' : fmt(draftEnd)}
          </span>
          {mode === 'end' && draftEnd !== null && (
            <button
              type="button"
              onClick={() => { setDraftEnd(null); onScrub?.(autoEndTarget) }}
              className="ml-0.5 px-2 py-0.5 rounded-full bg-cinnabar-950 text-white/60 text-[10px] touch-manipulation"
              aria-label="Clear end — follow the next line"
            >
              Auto
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            onCommit({ start: draftStart, end: draftEnd, shiftRestBy: cascade ? startDelta : undefined })
            onClose()
          }}
          className="shrink-0 min-h-11 px-6 rounded-lg bg-cinnabar-accent text-white text-xs font-medium touch-manipulation transition-transform duration-150 ease-out active:scale-[0.98]"
        >
          Done
        </button>
      </div>
    </div>
  )
}
