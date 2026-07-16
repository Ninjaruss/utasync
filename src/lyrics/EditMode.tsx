import { useEffect, useRef, useState } from 'react'
import type { TimedLine, Language, LineAlignmentQuality } from '../core/types'
import { stampTimes, setText, addLine, deleteLine } from './lineOps'
import { SecondLanguagePanel } from './SecondLanguagePanel'
import { TimestampPopover } from './TimestampPopover'
import {
  editRowSurface,
  editRowSurfaceActive,
  lyricRowPlayheadActive,
  timestampPillBtn,
  toolbarActionBtn,
  editToolbarRow,
  toolbarSectionLabel,
} from '../core/ui/toolbarClasses'
import { lineIndexAtPlayhead, linePlaybackStart } from './lineTiming'
import { likelyLyricsMismatch, offTimingLineCount } from './lineDegeneracy'

interface Props {
  lines: TimedLine[]
  playhead: () => number
  /** Current playback position — drives playhead row highlight during edit. */
  playheadPosition?: number
  seek?: (time: number) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
  /** Whether this song has a local audio file the app can decode (AI align, export). YouTube streaming alone does not count. */
  hasLocalAudio: boolean
  title: string
  artist: string
  sourceLanguage: Language
  onChangeLines: (lines: TimedLine[]) => void
  /** Sole re-align entry point (Play mode intentionally has no duplicate control). */
  onAutoAlign: () => void
  /** Tap-through timing while audio plays (YouTube or local). */
  showTapSync?: boolean
  onTapSync?: () => void
  /** Re-fetch / replace main lyrics from captions, LRCLIB, paste, or file. */
  onReplaceLyrics?: () => void
  /** Pause playback when opening a modal workflow (second language, etc.). */
  onPausePlayback?: () => void
  /** Per-line auto-align quality — show warnings for weak rows. */
  lineAlignmentQuality?: LineAlignmentQuality[]
  /** When false, suppress alignment quality badges (e.g. manual tap-sync). */
  showAlignmentQuality?: boolean
  /** Mixed-language song aligned before the current pipeline version — the
   * stored-transcript re-refine can't repair it, so recommend a fresh Auto-align. */
  needsMixedRealign?: boolean
  /** Number of gap holes worth re-transcribing (round 9, R9-2). When > 0 and audio
   * is present, the off-timing banner offers a "Recover N sections" action. */
  recoverableGapCount?: number
  /** Re-transcribe the recoverable gaps of this stored song. */
  onRecoverGaps?: () => void
  /** True while a recovery pass is in flight — disables the button. */
  recoveringGaps?: boolean
  /** Live "Recovering N sections…" status shown on the button while recovering. */
  recoverGapsStatus?: string | null
  /** Stored whole-song match confidence — drives the "lyrics may not match" hint. */
  alignmentConfidence?: number
  /** The segment-mode transcript merged multiple lines into shared audio blocks,
   * so line-end timing is approximate — offer a word-level ("Accurate readings")
   * re-align for tighter tails (mirrors the Play-mode suggestion). */
  suggestAccurateAlign?: boolean
  /** Re-run Auto-align in accurate (word-level) mode. */
  onAutoAlignAccurate?: () => void
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
  onCommitTimes: (patch: { start: number; end: number | null }) => void
  onClosePopover: () => void
  /** Where an auto end lands for this line (next line's start). */
  autoEnd: number
  alignmentQuality?: LineAlignmentQuality
  showAlignmentQuality?: boolean
}


/** One lyric row. Holds local draft text so typing doesn't push a change on every keystroke — committed only on blur, same discipline the old expand-into-panel editor used. */
function Row({
  line, index, timed, editing, deleteArmed, playheadActive, onStartEdit, onStopEdit, onCommitText, onAdd,
  onArmDelete, onConfirmDelete, onOpenPopover, popoverOpen, playhead, seek, onScrubStart, onScrubEnd, onCommitTimes, onClosePopover, autoEnd,
  alignmentQuality, showAlignmentQuality,
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
            <div className="w-full flex items-center gap-3 text-left">
              <button onClick={onStartEdit} className="flex-1 text-sm text-white font-jp text-left" aria-label={`Edit line ${index + 1}`}>
                {line.original || <span className="text-white/30">empty</span>}
                {!timed && <span className="ml-2 text-[10px] text-cinnabar-accent">untimed</span>}
              </button>
              {showAlignmentQuality && alignmentQuality === 'needs_review' && (
                <span className="text-[10px] bg-amber-400/15 text-amber-400/80 rounded-full px-2 py-0.5 shrink-0 select-none">off-timing</span>
              )}
              {showAlignmentQuality && alignmentQuality === 'approximate' && (
                <span className="text-[10px] bg-white/[0.07] text-white/35 rounded-full px-2 py-0.5 shrink-0 select-none">approx</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {editing && (
            <>
              <button onClick={onAdd} aria-label={`Add line after ${index + 1}`} className="min-w-11 min-h-11 flex items-center justify-center text-white/50 hover:text-white touch-manipulation transition-[color,transform] duration-150 ease-out active:scale-[0.96]">⊕</button>
              {deleteArmed ? (
                <button onClick={onConfirmDelete} aria-label={`Confirm delete line ${index + 1}`} className="min-h-11 px-2 text-red-400 font-semibold whitespace-nowrap text-xs touch-manipulation active:scale-[0.96]">Confirm?</button>
              ) : (
                <button onClick={onArmDelete} aria-label={`Delete line ${index + 1}`} className="min-w-11 min-h-11 flex items-center justify-center text-white/50 hover:text-white touch-manipulation transition-[color,transform] duration-150 ease-out active:scale-[0.96]">🗑</button>
              )}
            </>
          )}
        </div>
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
          line={line}
          autoEnd={autoEnd}
          playhead={playhead}
          onCommit={onCommitTimes}
          onClose={onClosePopover}
          onScrub={seek}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      )}
    </div>
  )
}

export function EditMode({ lines, playhead, playheadPosition, seek, onScrubStart, onScrubEnd, hasLocalAudio, title, artist, sourceLanguage, onChangeLines, onAutoAlign, showTapSync, onTapSync, onReplaceLyrics, onPausePlayback, lineAlignmentQuality, showAlignmentQuality = true, needsMixedRealign = false, recoverableGapCount = 0, onRecoverGaps, recoveringGaps = false, recoverGapsStatus, alignmentConfidence, suggestAccurateAlign = false, onAutoAlignAccurate }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [openPopover, setOpenPopover] = useState<number | null>(null)
  const [deleteArmed, setDeleteArmed] = useState<number | null>(null)
  const [confirmAutoAlign, setConfirmAutoAlign] = useState(false)
  const [showSecondLang, setShowSecondLang] = useState(false)
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewReturnRef = useRef(0)
  const hasSecondLang = lines.some((l) => l.translation)

  const undoStack = useRef<TimedLine[][]>([])
  const redoStack = useRef<TimedLine[][]>([])
  // Tracks the lines value this stack last emitted (via applyChange/undo/redo),
  // independent of whether the `lines` prop has round-tripped through the parent
  // and back into a re-render yet. Falls back to the live prop until the first
  // mutation so an immediate undo before any edit is a no-op as expected.
  const currentLines = useRef(lines)

  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const applyChange = (next: TimedLine[]) => {
    undoStack.current.push(currentLines.current)
    if (undoStack.current.length > 50) undoStack.current.shift()
    redoStack.current = []
    currentLines.current = next
    setCanUndo(true)
    setCanRedo(false)
    onChangeLines(next)
  }

  const undo = () => {
    const prev = undoStack.current.pop()
    if (!prev) return
    redoStack.current.push(currentLines.current)
    currentLines.current = prev
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
    onChangeLines(prev)
  }

  const redo = () => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(currentLines.current)
    currentLines.current = next
    setCanUndo(true)
    setCanRedo(redoStack.current.length > 0)
    onChangeLines(next)
  }

  const openSecondLang = () => {
    onPausePlayback?.()
    setShowSecondLang(true)
  }

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
    seek?.(linePlaybackStart(lines[i]))
  }

  const startEdit = (i: number) => {
    if (openPopover !== null && openPopover !== i) cancelPopover()
    disarmDelete(i)
    setEditingIndex(i)
    seek?.(linePlaybackStart(lines[i]))
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
    applyChange(deleteLine(lines, i))
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

  // Center the playhead line when entering Edit mode so the user lands where
  // the song currently is, matching Play mode's centering.
  const playheadRowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    playheadRowRef.current?.scrollIntoView({ block: 'center' })
  }, [])

  // needs_review lines plus approximate lines squashed below their sung floor
  // (see offTimingLineCount) — a visibly-squashed row is off-timing no matter
  // which chip it wears.
  const offTimingCount =
    showAlignmentQuality && lineAlignmentQuality?.length
      ? offTimingLineCount(lines, lineAlignmentQuality)
      : 0
  // A single prioritized alignment hint (below the toolbar), most-actionable first:
  //  1. lyrics-mismatch  — the recording likely doesn't match these lyrics; no
  //     re-align fixes that, so point at Replace lyrics.
  //  2. block-timing     — segment-mode merged lines into shared blocks; a
  //     word-level re-align tightens line ends (the tail-clipping cause). Shown
  //     even when no row is flagged off-timing, since clipped tails still score
  //     'good'.
  //  3. off-timing       — a few stray rows to nudge by hand or re-align.
  const likelyMismatch =
    showAlignmentQuality && likelyLyricsMismatch(lines, lineAlignmentQuality, alignmentConfidence)
  const alignmentHint: 'lyrics-mismatch' | 'block-timing' | 'off-timing' | null = likelyMismatch
    ? 'lyrics-mismatch'
    : hasLocalAudio && suggestAccurateAlign
      ? 'block-timing'
      : offTimingCount > 0
        ? 'off-timing'
        : null

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={editToolbarRow}>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <p className={[toolbarSectionLabel, 'flex-1 min-w-[6rem]'].join(' ')}>Edit lyrics</p>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            aria-label="Undo"
            className={`${toolbarActionBtn} disabled:opacity-30`}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            aria-label="Redo"
            className={`${toolbarActionBtn} disabled:opacity-30`}
          >
            Redo
          </button>
          {onReplaceLyrics && (
            <button type="button" onClick={onReplaceLyrics} className={toolbarActionBtn}>
              Replace lyrics
            </button>
          )}
          {showTapSync && onTapSync && (
            <button type="button" onClick={onTapSync} className={toolbarActionBtn}>
              Tap-through
            </button>
          )}
          {hasLocalAudio ? (
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
            onClick={openSecondLang}
            className={toolbarActionBtn}
          >
            {hasSecondLang ? '2nd language' : '+ Translation'}
          </button>
        </div>
        {!hasLocalAudio && (
          <p className="text-[10px] text-white/30 text-pretty">
            No audio file — use Tap-through to time lyrics while the song plays.
          </p>
        )}
        {alignmentHint === 'lyrics-mismatch' && (
          <p className="text-[10px] text-amber-400/80 text-pretty">
            Many lines couldn’t be matched to the audio — these lyrics may not match this recording
            (a different or live version, or the wrong lyrics).{onReplaceLyrics ? ' Try Replace lyrics,' : ''} or
            fine-tune the timestamps below.
          </p>
        )}
        {alignmentHint === 'block-timing' && (
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-[10px] text-amber-400/80 text-pretty flex-1 min-w-[12rem]">
              {offTimingCount > 0
                ? `${offTimingCount} line${offTimingCount === 1 ? '' : 's'} off-timing. `
                : ''}
              Line ends are approximate — this long track was analyzed in coarse blocks that group
              several lines together. Re-align with accurate timing for tighter per-line sync (slower).
            </p>
            {onAutoAlignAccurate && (
              <button
                type="button"
                onClick={onAutoAlignAccurate}
                className={`${toolbarActionBtn} self-start`}
              >
                Re-align accurately
              </button>
            )}
          </div>
        )}
        {alignmentHint === 'off-timing' && (
          <p className="text-[10px] text-amber-400/80 text-pretty">
            {offTimingCount} line{offTimingCount === 1 ? '' : 's'} off-timing — adjust the timestamps below or re-run Auto-align.
          </p>
        )}
        {hasLocalAudio && recoverableGapCount > 0 && onRecoverGaps && (
          <button
            type="button"
            onClick={onRecoverGaps}
            disabled={recoveringGaps}
            className={`${toolbarActionBtn} self-start disabled:opacity-60`}
          >
            {recoveringGaps
              ? recoverGapsStatus ?? 'Recovering…'
              : `Recover ${recoverableGapCount} section${recoverableGapCount === 1 ? '' : 's'}`}
          </button>
        )}
        {needsMixedRealign && (
          <p className="text-[10px] text-amber-400/80 text-pretty">
            Mixed-language song aligned before recent timing fixes — re-run Auto-align to re-time it (older mixed songs can't be re-timed automatically on open).
          </p>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
        aria-label="Lyric lines"
        style={{ scrollbarWidth: 'thin' }}
        onClick={() => { if (openPopover !== null) cancelPopover() }}
      >
        {lines.map((line, i) => (
          <div key={i} ref={activePlayheadIndex === i ? playheadRowRef : undefined} onClick={(e) => e.stopPropagation()}>
          <Row
            line={line}
            index={i}
            timed={isTimed(line, i === 0)}
            editing={editingIndex === i}
            deleteArmed={deleteArmed === i}
            onStartEdit={() => startEdit(i)}
            onStopEdit={stopEdit}
            onCommitText={(patch) => applyChange(setText(lines, i, patch))}
            onAdd={() => applyChange(addLine(lines, i))}
            onArmDelete={() => armDelete(i)}
            onConfirmDelete={() => confirmDelete(i)}
            onOpenPopover={() => openTimestampPopover(i)}
            popoverOpen={openPopover === i}
            playheadActive={activePlayheadIndex === i}
            playhead={playhead}
            seek={seek}
            onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
          onCommitTimes={(patch) => applyChange(stampTimes(lines, i, patch))}
          onClosePopover={closePopoverAfterCommit}
          autoEnd={lines[i + 1]?.startTime ?? Infinity}
          alignmentQuality={lineAlignmentQuality?.[i]}
          showAlignmentQuality={showAlignmentQuality}
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
          onApply={(next) => applyChange(next)}
          onClose={() => setShowSecondLang(false)}
        />
      )}
    </div>
  )
}
