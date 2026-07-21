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
  /** Why a more powerful re-align pass is recommended (accurateRealignReason):
   * 'segment-blocks' — the transcript merged multiple lines into shared audio
   * chunks, so line-end timing is structurally approximate; 'weak-labels' — a
   * large share of lines could not be verified against the audio at all. */
  accurateRealignReason?: 'segment-blocks' | 'weak-labels' | null
  /** Re-run Auto-align in accurate (word-level) mode. */
  onAutoAlignAccurate?: () => void
  /** Whether Demucs vocal separation was used for the stored alignment. */
  vocalSeparationUsed?: boolean
  /** Whether this device can run vocal separation (gates the nudge). */
  vocalSeparationSupported?: boolean
  /** Enable "Isolate vocals for timing" and re-run Auto-align. */
  onAutoAlignWithVocals?: () => void
}

const DELETE_CONFIRM_MS = 3000

// Wave 2 toolbar hierarchy: one 44px row with a primary Auto-align, compact
// icon Undo/Redo, and an overflow "More" menu for secondary actions.
const toolbarIconBtn =
  'min-w-11 min-h-11 flex items-center justify-center rounded-lg border border-cinnabar-800 text-white/60 hover:text-white hover:border-cinnabar-accent/50 touch-manipulation transition-[color,border-color,transform] duration-150 ease-out active:scale-[0.96]'

const toolbarPrimaryBtn =
  'min-h-11 px-3.5 py-2 rounded-lg bg-cinnabar-accent text-white text-xs font-semibold shadow-sm shadow-cinnabar-accent/20 hover:bg-cinnabar-accent/90 touch-manipulation transition-[background-color,transform] duration-150 ease-out active:scale-[0.96]'

const moreMenuItem =
  'min-h-11 px-3 py-2 text-left text-xs text-white/70 rounded-lg hover:bg-cinnabar-800/60 hover:text-white touch-manipulation whitespace-nowrap transition-colors'

function isTimed(line: TimedLine, first: boolean): boolean {
  return line.startTime > 0 || (first && line.startTime === 0 && line.endTime > 0)
}

/** True when two line arrays differ in the fields a user actually edits —
 * count, timing (start/end), or text (original/translation). Ignores
 * enrichment-only fields (tokens/reading/furigana/grammarAnnotations) so an
 * async reading/token pass that leaves timing+text untouched is NOT treated as
 * a destructive external change. */
function timingOrTextChanged(a: TimedLine[], b: TimedLine[]): boolean {
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].startTime !== b[i].startTime ||
      a[i].endTime !== b[i].endTime ||
      a[i].original !== b[i].original ||
      a[i].translation !== b[i].translation
    ) {
      return true
    }
  }
  return false
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
          <span className="text-white/40">
            {/* Clock — inline SVG so tint classes apply (emoji render as color glyphs on iOS). */}
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="8" r="6.25" />
              <path d="M8 4.75V8l2.25 1.5" />
            </svg>
          </span>
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
              <button onClick={onAdd} aria-label={`Add line after ${index + 1}`} className="min-w-11 min-h-11 flex items-center justify-center text-white/50 hover:text-white touch-manipulation transition-[color,transform] duration-150 ease-out active:scale-[0.96]">
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </button>
              {deleteArmed ? (
                <button onClick={onConfirmDelete} aria-label={`Confirm delete line ${index + 1}`} className="min-h-11 px-2 text-red-400 font-semibold whitespace-nowrap text-xs touch-manipulation active:scale-[0.96]">Confirm?</button>
              ) : (
                <button onClick={onArmDelete} aria-label={`Delete line ${index + 1}`} className="min-w-11 min-h-11 flex items-center justify-center text-white/50 hover:text-white touch-manipulation transition-[color,transform] duration-150 ease-out active:scale-[0.96]">
                  <svg
                    aria-hidden="true"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.75 4.25h10.5" />
                    <path d="M5.5 4.25V3.25a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" />
                    <path d="M12.25 4.25l-.6 8.3a1.2 1.2 0 0 1-1.2 1.1H5.55a1.2 1.2 0 0 1-1.2-1.1l-.6-8.3" />
                    <path d="M6.5 7v3.75M9.5 7v3.75" />
                  </svg>
                </button>
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

export function EditMode({ lines, playhead, playheadPosition, seek, onScrubStart, onScrubEnd, hasLocalAudio, title, artist, sourceLanguage, onChangeLines, onAutoAlign, showTapSync, onTapSync, onReplaceLyrics, onPausePlayback, lineAlignmentQuality, showAlignmentQuality = true, needsMixedRealign = false, recoverableGapCount = 0, onRecoverGaps, recoveringGaps = false, recoverGapsStatus, alignmentConfidence, accurateRealignReason = null, onAutoAlignAccurate, vocalSeparationUsed, vocalSeparationSupported = false, onAutoAlignWithVocals }: Props) {
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
  const [showMore, setShowMore] = useState(false)

  // External-change guard (item 3): EditMode stays mounted while a completed
  // Auto-align or gap-recovery pass replaces `lines` from OUTSIDE this editor.
  // Such a change arrives as a `lines` prop the undo stack never emitted —
  // internal edits set currentLines.current to the exact array passed to
  // onChangeLines, which the store round-trips back by reference, so an internal
  // edit is never mistaken for an external one. On a genuine external
  // replacement, adopt the new baseline so a later Undo can never revert past
  // it; WIPE the undo/redo history only when the timing or text actually changed
  // (gap recovery, completed auto-align) — an enrichment pass that only adds
  // tokens/readings keeps the history so a manual edit made just before it stays
  // undoable. Runs in an effect (not during render) so the refs are touched only
  // after commit.
  useEffect(() => {
    if (lines === currentLines.current) return
    if (timingOrTextChanged(currentLines.current, lines)) {
      undoStack.current = []
      redoStack.current = []
      setCanUndo(false)
      setCanRedo(false)
    }
    currentLines.current = lines
  }, [lines])

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
  // The "Recover N sections" block (further down) already names and re-times the
  // untimed parts, so a generic off-timing nudge alongside it just duplicates it.
  const recoverBlockShown = hasLocalAudio && recoverableGapCount > 0 && !!onRecoverGaps
  // A single prioritized alignment hint (below the toolbar), most-actionable
  // first — exactly one ever renders, so guidance never stacks:
  //  0. mixed-realign    — a stale mixed-language song the on-open re-refine
  //     can't repair; only a fresh Auto-align re-times it. Supersedes the
  //     quality hints below (re-running is the first step and clears them if it
  //     works), rather than stacking a second amber banner beside them.
  //  1. lyrics-mismatch  — the recording likely doesn't match these lyrics; no
  //     re-align fixes that, so point at Replace lyrics.
  //  2. block-timing     — segment-mode merged lines into shared blocks; a
  //     word-level re-align tightens line ends (the tail-clipping cause). Shown
  //     even when no row is flagged off-timing, since clipped tails still score
  //     'good'.
  //  3. weak-labels      — many lines could not be verified against the audio;
  //     the song likely needs a more powerful pass (word-level timestamps or
  //     the High-accuracy model), not row-by-row nudging.
  //  4. off-timing       — a few stray rows to nudge by hand or re-align, unless
  //     the Recover block already owns them.
  const likelyMismatch =
    showAlignmentQuality && likelyLyricsMismatch(lines, lineAlignmentQuality, alignmentConfidence)
  const unverifiedCount =
    showAlignmentQuality && lineAlignmentQuality?.length
      ? lines.reduce(
          (n, l, i) =>
            n + ((l.original || l.translation).trim() && lineAlignmentQuality[i] !== 'good' ? 1 : 0),
          0,
        )
      : 0
  const alignmentHint: 'mixed-realign' | 'lyrics-mismatch' | 'block-timing' | 'weak-labels' | 'off-timing' | null =
    needsMixedRealign
      ? 'mixed-realign'
      : likelyMismatch
        ? 'lyrics-mismatch'
        : hasLocalAudio && accurateRealignReason === 'segment-blocks'
          ? 'block-timing'
          : hasLocalAudio && accurateRealignReason === 'weak-labels' && showAlignmentQuality
            ? 'weak-labels'
            : offTimingCount > 0 && !recoverBlockShown
              ? 'off-timing'
              : null

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={editToolbarRow}>
        <div className="flex items-center gap-1.5">
          <p className={[toolbarSectionLabel, 'flex-1 min-w-0 truncate'].join(' ')}>Edit lyrics</p>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            aria-label="Undo"
            className={`${toolbarIconBtn} disabled:opacity-30`}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 5 3 8l3 3" />
              <path d="M3 8h6a3.5 3.5 0 0 1 0 7H7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            aria-label="Redo"
            className={`${toolbarIconBtn} disabled:opacity-30`}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 5 13 8l-3 3" />
              <path d="M13 8H7a3.5 3.5 0 0 0 0 7h2" />
            </svg>
          </button>

          {/* Overflow menu — secondary actions kept off the primary row so it
              never wraps on a 375px phone. Only applicable items are listed. */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-haspopup="true"
              aria-expanded={showMore}
              className={`${toolbarActionBtn} inline-flex items-center gap-1`}
            >
              More
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            {showMore && (
              <>
                <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setShowMore(false)} />
                <div className="absolute right-0 top-full z-40 mt-1 flex min-w-[11rem] flex-col rounded-xl border border-cinnabar-800 bg-cinnabar-900 p-1 shadow-xl">
                  {onReplaceLyrics && (
                    <button type="button" onClick={() => { setShowMore(false); onReplaceLyrics() }} className={moreMenuItem}>
                      Replace lyrics
                    </button>
                  )}
                  {showTapSync && onTapSync && (
                    <button type="button" onClick={() => { setShowMore(false); onTapSync() }} className={moreMenuItem}>
                      Tap-through
                    </button>
                  )}
                  <button type="button" onClick={() => { setShowMore(false); openSecondLang() }} className={moreMenuItem}>
                    {hasSecondLang ? '2nd language' : '+ Translation'}
                  </button>
                </div>
              </>
            )}
          </div>

          {hasLocalAudio && (
            <button
              type="button"
              onClick={() => setConfirmAutoAlign(true)}
              className={toolbarPrimaryBtn}
            >
              Auto-align
            </button>
          )}
        </div>
        {!hasLocalAudio && (
          <p className="text-xs text-white/30 text-pretty">
            No audio file — use Tap-through to time lyrics while the song plays.
          </p>
        )}
        {alignmentHint === 'mixed-realign' && (
          <p className="text-xs text-amber-400/80 text-pretty">
            Mixed-language song aligned before recent timing fixes — re-run Auto-align to re-time it (older mixed songs can't be re-timed automatically on open).
          </p>
        )}
        {alignmentHint === 'lyrics-mismatch' && (
          <p className="text-xs text-amber-400/80 text-pretty">
            Many lines couldn’t be matched to the audio — these lyrics may not match this recording
            (a different or live version, or the wrong lyrics).{onReplaceLyrics ? ' Try Replace lyrics,' : ''} or
            fine-tune the timestamps below.
          </p>
        )}
        {alignmentHint === 'block-timing' && (
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-xs text-amber-400/80 text-pretty flex-1 min-w-[12rem]">
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
        {alignmentHint === 'weak-labels' && (
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-xs text-amber-400/80 text-pretty flex-1 min-w-[12rem]">
              {unverifiedCount} line{unverifiedCount === 1 ? '' : 's'} couldn’t be verified against the
              audio, so their timing may drift. This song likely needs a more powerful pass — re-align
              with Accurate timing or the High accuracy model (slower), or fine-tune below.
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
          <p className="text-xs text-amber-400/80 text-pretty">
            {offTimingCount} line{offTimingCount === 1 ? '' : 's'} off-timing — adjust the timestamps below or re-run Auto-align.
          </p>
        )}
        {onAutoAlignWithVocals && !vocalSeparationUsed && vocalSeparationSupported &&
          (alignmentHint === 'weak-labels' || alignmentHint === 'block-timing' || alignmentHint === 'off-timing') && (
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-xs text-white/45 text-pretty flex-1 min-w-[12rem]">
              Isolating the vocals first often sharpens timing on busy or live recordings.
            </p>
            <button
              type="button"
              onClick={onAutoAlignWithVocals}
              className={`${toolbarActionBtn} self-start`}
            >
              Isolate vocals &amp; re-align
            </button>
          </div>
        )}
        {hasLocalAudio && recoverableGapCount > 0 && onRecoverGaps && (
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={onRecoverGaps}
              disabled={recoveringGaps}
              className={`${toolbarActionBtn} inline-flex items-center gap-1.5 disabled:opacity-60`}
            >
              {recoveringGaps && (
                <span
                  aria-hidden="true"
                  className="w-3 h-3 shrink-0 rounded-full border-2 border-cinnabar-accent border-t-transparent animate-spin"
                />
              )}
              {recoveringGaps
                ? recoverGapsStatus ?? 'Recovering…'
                : `Recover ${recoverableGapCount} section${recoverableGapCount === 1 ? '' : 's'}`}
            </button>
            <p className="text-xs text-white/60 text-pretty">
              {recoverableGapCount} part{recoverableGapCount === 1 ? '' : 's'} of the song couldn’t
              be timed — re-scan just those parts. Your edits are kept.
            </p>
          </div>
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
            <p className="text-white/50 text-xs">This takes a few minutes.</p>
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
