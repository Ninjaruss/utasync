import { useEffect, useRef, useState } from 'react'
import type { TimedLine, Language } from '../core/types'
import { stampStart, setText, addLine, deleteLine } from './lineOps'
import { SecondLanguagePanel } from './SecondLanguagePanel'
import { TimestampPopover } from './TimestampPopover'
import {
  editRowSurface,
  editRowSurfaceActive,
  lyricRowPlayheadActive,
  timestampPillBtn,
  toolbarActionBtn,
  modeToolbarRow,
  toolbarSectionLabel,
} from '../core/ui/toolbarClasses'
import { lineIndexAtPlayhead } from './lineTiming'

interface Props {
  lines: TimedLine[]
  playhead: () => number
  /** Current playback position — drives playhead row highlight during edit. */
  playheadPosition?: number
  seek?: (time: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
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

function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '—'
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

function fmt(line: TimedLine, timed: boolean): string {
  if (!timed) return '—'
  if (line.endTime > line.startTime) return `${fmtTime(line.startTime)}–${fmtTime(line.endTime)}`
  return fmtTime(line.startTime)
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
  playheadActive: boolean
  playhead: () => number
  seek?: (time: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
  onCommitTime: (t: number) => void
  onClosePopover: () => void
}

/** One lyric row. Holds local draft text so typing doesn't push a change on every keystroke — committed only on blur, same discipline the old expand-into-panel editor used. */
function Row({
  line, index, timed, editing, deleteArmed, playheadActive, onStartEdit, onStopEdit, onCommitText, onAdd,
  onArmDelete, onConfirmDelete, onOpenPopover, popoverOpen, playhead, seek, onScrubStart, onScrubEnd, onCommitTime, onClosePopover,
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
    <div className={[
      editRowSurface,
      editing ? editRowSurfaceActive : '',
      playheadActive && !editing ? lyricRowPlayheadActive : '',
    ].join(' ')}>
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenPopover}
          aria-label={`Edit timestamp for line ${index + 1}`}
          className={timestampPillBtn}
        >
          <span className="text-[10px] text-white/40">⏱</span>
          <span className="text-[11px] tabular-nums text-cinnabar-accent min-w-[4.5rem] text-center">{fmt(line, timed)}</span>
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
        line.translation && <span className="block text-[11px] italic text-white/45 mt-1 pl-[4.75rem]">{line.translation}</span>
      )}

      {popoverOpen && (
        <TimestampPopover
          time={line.startTime}
          playhead={playhead}
          onCommit={onCommitTime}
          onClose={onClosePopover}
          onScrub={seek}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      )}
    </div>
  )
}

export function EditMode({ lines, playhead, playheadPosition, seek, onScrubStart, onScrubEnd, hasAudio, title, artist, sourceLanguage, onChangeLines, onAutoAlign }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [openPopover, setOpenPopover] = useState<number | null>(null)
  const [deleteArmed, setDeleteArmed] = useState<number | null>(null)
  const [confirmAutoAlign, setConfirmAutoAlign] = useState(false)
  const [showSecondLang, setShowSecondLang] = useState(false)
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewReturnRef = useRef(0)
  const hasSecondLang = lines.some((l) => l.translation)

  useEffect(() => () => { if (deleteTimer.current) clearTimeout(deleteTimer.current) }, [])

  const revertPreview = () => {
    seek?.(previewReturnRef.current)
    onScrubEnd?.()
  }

  const cancelPopover = () => {
    if (openPopover === null) return
    revertPreview()
    setOpenPopover(null)
  }

  const openTimestampPopover = (i: number) => {
    if (openPopover === i) {
      cancelPopover()
      return
    }
    if (openPopover !== null) revertPreview()
    previewReturnRef.current = playhead()
    setOpenPopover(i)
    seek?.(lines[i].startTime)
  }

  const startEdit = (i: number) => {
    if (openPopover !== null && openPopover !== i) cancelPopover()
    disarmDelete(i)
    setEditingIndex(i)
    seek?.(lines[i].startTime)
  }

  const closePopoverAfterCommit = () => {
    setOpenPopover(null)
  }

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

  const stopEdit = () => {
    disarmDelete(null)
    setEditingIndex(null)
  }

  const activePlayheadIndex = playheadPosition !== undefined
    ? lineIndexAtPlayhead(lines, playheadPosition)
    : -1

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={[modeToolbarRow, 'space-y-2'].join(' ')}>
        <div className="flex items-center gap-2">
          <p className={[toolbarSectionLabel, 'flex-1'].join(' ')}>Edit lyrics</p>
          {hasAudio ? (
            <button
              type="button"
              onClick={() => setConfirmAutoAlign(true)}
              className={toolbarActionBtn}
            >
              Auto-align
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowSecondLang(true)}
            className={toolbarActionBtn}
          >
            {hasSecondLang ? '2nd language' : '+ Translation'}
          </button>
        </div>
        {!hasAudio && (
          <p className="text-[10px] text-white/30 text-pretty">Auto-align needs uploaded audio on this song.</p>
        )}
        <p className="text-[10px] text-white/30 text-pretty">Tap a line to edit text · ⏱ to set timestamps</p>
      </div>

      <div
        className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-1.5"
        aria-label="Lyric lines"
        style={{ scrollbarWidth: 'thin' }}
        onClick={() => { if (openPopover !== null) cancelPopover() }}
      >
        {lines.map((line, i) => (
          <div key={i} onClick={(e) => e.stopPropagation()}>
          <Row
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
            onOpenPopover={() => openTimestampPopover(i)}
            popoverOpen={openPopover === i}
            playheadActive={activePlayheadIndex === i}
            playhead={playhead}
            seek={seek}
            onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
          onCommitTime={(t) => onChangeLines(stampStart(lines, i, t))}
          onClosePopover={closePopoverAfterCommit}
        />
          </div>
        ))}
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
