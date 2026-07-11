import { useState } from 'react'
import type { TimedLine } from '../core/types'

interface Props {
  line: TimedLine
  /** Where an auto end lands right now (next line's start), for slider init/display. */
  autoEnd: number
  playhead: () => number
  onCommit: (patch: { start: number; end: number | null }) => void
  onClose: () => void
  onScrub?: (time: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
}

type Anchor = 'start' | 'end'

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '—'
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

const anchorTabBase = 'flex-1 py-1 rounded-lg text-xs font-medium touch-manipulation transition-colors'
const anchorTabOn = 'bg-cinnabar-accent text-white'
const anchorTabOff = 'bg-cinnabar-950 text-white/50'

/**
 * Edits both anchors of a line without committing until Done: a Start | End
 * toggle picks which anchor the slider scrubs. End starts as "Auto" (follows
 * the next line) until dragged; Auto restores that. Dragging previews the
 * audio position in real time.
 */
export function TimestampPopover({ line, autoEnd, playhead: _playhead, onCommit, onClose, onScrub, onScrubStart, onScrubEnd }: Props) {
  const hasExplicitEnd = line.endTime > line.startTime
  const [anchor, setAnchor] = useState<Anchor>('start')
  const [draftStart, setDraftStart] = useState(line.startTime)
  const [draftEnd, setDraftEnd] = useState<number | null>(hasExplicitEnd ? line.endTime : null)

  // Slider value/window for the active anchor. An auto end scrubs from where
  // it currently lands so grabbing the slider feels anchored, not arbitrary.
  const autoEndTarget = Number.isFinite(autoEnd) ? autoEnd : draftStart + 3
  const effectiveEnd = draftEnd ?? autoEndTarget
  const value = anchor === 'start' ? draftStart : effectiveEnd
  const center = anchor === 'start' ? line.startTime : (hasExplicitEnd ? line.endTime : effectiveEnd)
  const min = anchor === 'start' ? Math.max(0, center - 15) : Math.max(draftStart + 0.1, center - 15)
  const max = center + 15

  const move = (t: number) => {
    if (anchor === 'start') {
      setDraftStart(t)
      // Keep an explicit end from being overtaken while dragging the start.
      if (draftEnd !== null && draftEnd < t) setDraftEnd(t)
    } else {
      setDraftEnd(t)
    }
    onScrub?.(t)
  }

  return (
    <div
      className="absolute z-20 mt-1 left-0 right-0 rounded-xl border border-cinnabar-accent/60 bg-cinnabar-900 p-3 space-y-2 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex gap-1" role="tablist" aria-label="Timestamp anchor">
        <button
          type="button"
          role="tab"
          aria-selected={anchor === 'start'}
          onClick={() => setAnchor('start')}
          className={`${anchorTabBase} ${anchor === 'start' ? anchorTabOn : anchorTabOff}`}
        >
          Start
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={anchor === 'end'}
          onClick={() => setAnchor('end')}
          className={`${anchorTabBase} ${anchor === 'end' ? anchorTabOn : anchorTabOff}`}
        >
          End
        </button>
      </div>
      <p className="text-[10px] text-white/40 text-center">Drag to preview · Done to save · tap outside or another line to cancel</p>
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onPointerDown={() => onScrubStart?.()}
        onPointerUp={() => onScrubEnd?.()}
        onChange={(e) => move(Number(e.target.value))}
        aria-label={anchor === 'start' ? 'Scrub start timestamp' : 'Scrub end timestamp'}
        className="w-full accent-cinnabar-accent"
      />
      <div className="flex items-center justify-center gap-2 text-xs">
        <span className={`tabular-nums ${anchor === 'start' ? 'text-white font-semibold' : 'text-white/40'}`}>{fmt(draftStart)}</span>
        <span className="text-white/30">–</span>
        <span className={`tabular-nums ${anchor === 'end' ? 'text-white font-semibold' : 'text-white/40'}`}>
          {draftEnd === null ? 'auto' : fmt(draftEnd)}
        </span>
        {anchor === 'end' && draftEnd !== null && (
          <button
            type="button"
            onClick={() => { setDraftEnd(null); onScrub?.(autoEndTarget) }}
            className="ml-1 px-2 py-0.5 rounded-full bg-cinnabar-950 text-white/60 text-[10px] touch-manipulation"
            aria-label="Clear end — follow the next line"
          >
            Auto
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => { onCommit({ start: draftStart, end: draftEnd }); onClose() }}
        className="w-full py-1.5 rounded-lg bg-cinnabar-accent text-white text-xs font-medium touch-manipulation"
      >
        Done
      </button>
    </div>
  )
}
