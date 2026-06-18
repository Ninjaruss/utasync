import { useEffect, useRef, useState } from 'react'
import type { TimedLine, Language } from '../core/types'
import { stampStart, setText, addLine, deleteLine } from './lineOps'
import { SecondLanguagePanel } from './SecondLanguagePanel'
import { TimestampPopover } from './TimestampPopover'

interface Props {
  lines: TimedLine[]
  playhead: () => number
  /** Whether this song has locally stored audio for Auto-align to decode (not just an active playback source — YouTube alone doesn't count). */
  hasAudio: boolean
  title: string
  artist: string
  sourceLanguage: Language
  onChangeLines: (lines: TimedLine[]) => void
  onAutoAlign: () => void
}

const DELETE_CONFIRM_MS = 3000

function isTimed(line: TimedLine, first: boolean): boolean {
  return line.startTime > 0 || (first && line.startTime === 0 && line.endTime > 0)
}

function fmt(t: number, timed: boolean): string {
  if (!timed) return '—'
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

interface RowProps {
  line: TimedLine
  index: number
  timed: boolean
  editing: boolean
  deleteArmed: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  onCommitText: (patch: { original?: string; translation?: string }) => void
  onAdd: () => void
  onArmDelete: () => void
  onConfirmDelete: () => void
  onOpenPopover: () => void
  popoverOpen: boolean
  playhead: () => number
  onCommitTime: (t: number) => void
  onClosePopover: () => void
}

/** One lyric row. Holds local draft text so typing doesn't push a change on every keystroke — committed only on blur, same discipline as the LineEditor panel this replaces. */
function Row({
  line, index, timed, editing, deleteArmed, onStartEdit, onStopEdit, onCommitText, onAdd,
  onArmDelete, onConfirmDelete, onOpenPopover, popoverOpen, playhead, onCommitTime, onClosePopover,
}: RowProps) {
  const [original, setOriginal] = useState(line.original)
  const [translation, setTranslation] = useState(line.translation)

  // Reset local drafts only on the false->true transition of `editing`, not on every
  // change to the line's text while already editing — otherwise an external lines
  // update (e.g. SecondLanguagePanel.onApply) would clobber in-progress typing.
  // Adjusted during render per React's guidance for resetting state from props
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders),
  // rather than in a useEffect (see commit 7c63b9d for the prior incarnation of this bug).
  const [wasEditing, setWasEditing] = useState(editing)
  if (editing !== wasEditing) {
    setWasEditing(editing)
    if (editing) {
      setOriginal(line.original)
      setTranslation(line.translation)
    }
  }

  return (
    <div className="relative rounded-xl border border-white/10 bg-white/5 px-2 py-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenPopover}
          aria-label={`Edit timestamp for line ${index + 1}`}
          className="flex items-center gap-1 shrink-0 rounded-lg border border-white/15 bg-white/5 px-1.5 py-1"
        >
          <span className="text-[10px] text-white/40">⏱</span>
          <span className="text-[11px] tabular-nums text-cinnabar-accent w-9 text-center">{fmt(line.startTime, timed)}</span>
        </button>

        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
              onBlur={() => original !== line.original && onCommitText({ original })}
              aria-label="Original text"
              className="w-full bg-cinnabar-950 text-white text-sm px-2 py-1 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent font-jp"
            />
          ) : (
            <button onClick={onStartEdit} className="w-full flex items-center gap-3 text-left" aria-label={`Edit line ${index + 1}`}>
              <span className="flex-1 text-sm text-white font-jp">
                {line.original || <span className="text-white/30">empty</span>}
                {!timed && <span className="ml-2 text-[10px] text-cinnabar-accent">untimed</span>}
              </span>
            </button>
          )}
        </div>

        {editing && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onAdd} aria-label={`Add line after ${index + 1}`} className="text-white/50 px-1">⊕</button>
            {deleteArmed ? (
              <button onClick={onConfirmDelete} aria-label={`Confirm delete line ${index + 1}`} className="text-red-400 px-1 font-semibold whitespace-nowrap">Confirm?</button>
            ) : (
              <button onClick={onArmDelete} aria-label={`Delete line ${index + 1}`} className="text-white/50 px-1">🗑</button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <input
          value={translation}
          onChange={(e) => setTranslation(e.target.value)}
          onBlur={() => {
            if (translation !== line.translation) onCommitText({ translation })
            onStopEdit()
          }}
          placeholder="Translation"
          aria-label="Translation text"
          className="mt-1.5 w-full bg-cinnabar-950 text-white/80 text-sm px-2 py-1 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent"
        />
      ) : (
        line.translation && <span className="block text-[11px] italic text-white/45 ml-[3.25rem]">{line.translation}</span>
      )}

      {popoverOpen && (
        <TimestampPopover time={line.startTime} playhead={playhead} onCommit={onCommitTime} onClose={onClosePopover} />
      )}
    </div>
  )
}

export function EditMode({ lines, playhead, hasAudio, title, artist, sourceLanguage, onChangeLines, onAutoAlign }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [openPopover, setOpenPopover] = useState<number | null>(null)
  const [deleteArmed, setDeleteArmed] = useState<number | null>(null)
  const [confirmAutoAlign, setConfirmAutoAlign] = useState(false)
  const [showSecondLang, setShowSecondLang] = useState(false)
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasSecondLang = lines.some((l) => l.translation)

  useEffect(() => () => { if (deleteTimer.current) clearTimeout(deleteTimer.current) }, [])

  const armDelete = (i: number) => {
    setDeleteArmed(i)
    if (deleteTimer.current) clearTimeout(deleteTimer.current)
    deleteTimer.current = setTimeout(() => setDeleteArmed(null), DELETE_CONFIRM_MS)
  }

  const confirmDelete = (i: number) => {
    if (deleteTimer.current) clearTimeout(deleteTimer.current)
    setDeleteArmed(null)
    setEditingIndex(null)
    onChangeLines(deleteLine(lines, i))
  }

  /** Clears a stale delete-arm (and its pending timeout) belonging to a different row than `keep`. */
  const disarmDelete = (keep: number | null) => {
    setDeleteArmed((current) => {
      if (current === null || current === keep) return current
      if (deleteTimer.current) clearTimeout(deleteTimer.current)
      deleteTimer.current = null
      return null
    })
  }

  const startEdit = (i: number) => {
    disarmDelete(i)
    setEditingIndex(i)
  }

  const stopEdit = () => {
    disarmDelete(null)
    setEditingIndex(null)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {lines.map((line, i) => (
          <Row
            key={i}
            line={line}
            index={i}
            timed={isTimed(line, i === 0)}
            editing={editingIndex === i}
            deleteArmed={deleteArmed === i}
            onStartEdit={() => startEdit(i)}
            onStopEdit={stopEdit}
            onCommitText={(patch) => onChangeLines(setText(lines, i, patch))}
            onAdd={() => onChangeLines(addLine(lines, i))}
            onArmDelete={() => armDelete(i)}
            onConfirmDelete={() => confirmDelete(i)}
            onOpenPopover={() => setOpenPopover(openPopover === i ? null : i)}
            popoverOpen={openPopover === i}
            playhead={playhead}
            onCommitTime={(t) => onChangeLines(stampStart(lines, i, t))}
            onClosePopover={() => setOpenPopover(null)}
          />
        ))}
      </div>

      <div className="border-t border-white/10 shrink-0 p-3 space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-white/30 mb-1">Timing</p>
          {hasAudio ? (
            <button onClick={() => setConfirmAutoAlign(true)} className="w-full text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">
              ✨ Auto-align
            </button>
          ) : (
            <p className="text-[10px] text-white/35 text-center px-1">
              Auto-align needs locally stored audio — attach an audio file to this song
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-white/30 mb-1">Content</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onChangeLines(addLine(lines, lines.length - 1))} className="text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">＋ Add line</button>
            <button onClick={() => setShowSecondLang(true)} className="text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">
              {hasSecondLang ? '↻ Replace 2nd language' : '＋ 2nd language'}
            </button>
          </div>
        </div>
      </div>

      {confirmAutoAlign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirmAutoAlign(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-cinnabar-900 border border-cinnabar-800 p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-white text-sm">This replaces timing for all {lines.length} lines. Continue?</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmAutoAlign(false)} className="flex-1 py-2 rounded-lg bg-cinnabar-950 text-white/70 text-sm">Cancel</button>
              <button onClick={() => { setConfirmAutoAlign(false); onAutoAlign() }} className="flex-1 py-2 rounded-lg bg-cinnabar-accent text-white text-sm font-medium">Continue</button>
            </div>
          </div>
        </div>
      )}

      {showSecondLang && (
        <SecondLanguagePanel
          lines={lines}
          title={title}
          artist={artist}
          sourceLanguage={sourceLanguage}
          onApply={(next) => onChangeLines(next)}
          onClose={() => setShowSecondLang(false)}
        />
      )}
    </div>
  )
}
