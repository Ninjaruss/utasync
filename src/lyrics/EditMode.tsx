import { useState } from 'react'
import type { TimedLine } from '../core/types'
import { LineEditor } from './LineEditor'
import { stampStart, setText, addLine, deleteLine } from './lineOps'

interface Props {
  lines: TimedLine[]
  playhead: () => number
  /** Active provider exposes a waveform (YouTube/upload) → Auto-align allowed. */
  hasAudio: boolean
  onChangeLines: (lines: TimedLine[]) => void
  onTapThrough: () => void
  onAutoAlign: () => void
}

function isTimed(line: TimedLine, first: boolean): boolean {
  return line.startTime > 0 || (first && line.startTime === 0 && line.endTime > 0)
}

function fmt(t: number, timed: boolean): string {
  if (!timed) return '—'
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

export function EditMode({ lines, playhead, hasAudio, onChangeLines, onTapThrough, onAutoAlign }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {lines.map((line, i) => {
          const timed = isTimed(line, i === 0)
          if (expanded === i) {
            return (
              <LineEditor
                key={i}
                line={line}
                playhead={playhead}
                onChange={(patch) => {
                  let next = lines
                  if (patch.startTime !== undefined) next = stampStart(next, i, patch.startTime)
                  if (patch.original !== undefined || patch.translation !== undefined) next = setText(next, i, patch)
                  onChangeLines(next)
                }}
                onAdd={() => onChangeLines(addLine(lines, i))}
                onDelete={() => { onChangeLines(deleteLine(lines, i)); setExpanded(null) }}
              />
            )
          }
          return (
            <div key={i} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-2">
              <button
                onClick={() => onChangeLines(stampStart(lines, i, playhead()))}
                className="flex-1 flex items-center gap-3 text-left"
                aria-label={`Stamp start for line ${i + 1}`}
              >
                <span className="text-[11px] tabular-nums text-cinnabar-accent w-10 shrink-0">{fmt(line.startTime, timed)}</span>
                <span className="flex-1 text-sm text-white font-jp">
                  {line.original || <span className="text-white/30">empty</span>}
                  {!timed && <span className="ml-2 text-[10px] text-cinnabar-accent">untimed</span>}
                  {line.translation && <span className="block text-[11px] italic text-white/45">{line.translation}</span>}
                </span>
              </button>
              <button onClick={() => setExpanded(i)} aria-label={`Edit line ${i + 1}`} className="text-white/40 px-1 shrink-0">✎</button>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 p-3 border-t border-white/10 shrink-0">
        <button onClick={onTapThrough} className="flex-1 text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">⏱ Tap-through</button>
        {hasAudio ? (
          <button onClick={onAutoAlign} className="flex-1 text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">✨ Auto-align</button>
        ) : (
          <span className="flex-1 text-[10px] text-white/35 self-center text-center px-1">
            Auto-align needs a YouTube or uploaded audio source
          </span>
        )}
        <button onClick={() => onChangeLines(addLine(lines, lines.length - 1))} className="flex-1 text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">＋ Add line</button>
      </div>
    </div>
  )
}
