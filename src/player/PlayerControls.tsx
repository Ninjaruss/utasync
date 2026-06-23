import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PlaybackState, ABLoop, ABLoopPlaylistEntry } from '../core/types'
import { isABLoopActive } from './abLoopUtils'
import {
  PLAYLIST_REPEAT_PRESETS,
  playlistEntryLabel,
  playlistRepeatButtonLabel,
  playlistRepeatLabel,
  wrapPlaylistIndex,
  wrapPlaylistIndexPrev,
} from './abLoopPlaylist'
import { useMinWidthMd } from '../core/ui/useMinWidthMd'
import {
  displayMenuTrigger,
  displayMenuTriggerActive,
  displayMenuTriggerIdle,
  toolbarChipBtn,
  toolbarChipBtnActive,
  toolbarChipBtnArmed,
  toolbarChipBtnIdle,
  toolbarSectionLabel,
} from '../core/ui/toolbarClasses'

const NORMAL_SPEED = 1
const LEARNER_SPEED_PRESETS = [
  { label: 'Slow', speed: 0.75 },
  { label: 'Slower', speed: 0.6 },
] as const
const DOUBLE_TAP_MS = 350

interface Props {
  mode: 'play' | 'edit'
  playbackState: PlaybackState
  position: number
  duration: number
  progress: number
  speed: number
  speedPct: number
  volume: number
  volumePct: number
  onSpeedChange: (speed: number) => void
  onVolumeChange: (volume: number) => void
  abLoop: ABLoop
  armingAB: 'a' | 'b' | null
  abLoopError: string | null
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onToggleArm: (which: 'a' | 'b') => void
  onClearAB: () => void
  showAbExport?: boolean
  onExportAb?: () => void
  abExporting?: boolean
  abExportError?: string | null
  abExportCanIncludeSrt?: boolean
  abExportIncludeSrt?: boolean
  onAbExportIncludeSrtChange?: (value: boolean) => void
  playlistEntries?: ABLoopPlaylistEntry[]
  playlistActive?: boolean
  playlistIndex?: number
  playlistRepeatCount?: number
  onPlaylistRepeatCountChange?: (count: number) => void
  canSaveToPlaylist?: boolean
  onSaveToPlaylist?: () => void
  onTogglePlaylist?: () => void
  onLoadPlaylistEntry?: (entry: ABLoopPlaylistEntry, index: number) => void
  onMovePlaylistEntry?: (from: number, to: number) => void
  onRemovePlaylistEntry?: (entryId: string) => void
  onRenamePlaylistEntry?: (entryId: string, label: string) => void
  onClearPlaylist?: () => void
  showPlaylistExport?: boolean
  onExportPlaylist?: () => void
  playlistExporting?: boolean
  playlistExportError?: string | null
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function SeekBar({ progress, duration, onSeek }: { progress: number; duration: number; onSeek: (t: number) => void }) {
  return (
    <div
      className="py-2 -my-1 touch-manipulation"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onSeek(((e.clientX - rect.left) / rect.width) * duration)
      }}
    >
      <div className="h-2.5 md:h-2 bg-cinnabar-900 rounded-full cursor-pointer">
        <div
          className="h-full bg-cinnabar-accent rounded-full transition-[width] duration-150 ease-out"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  )
}

function TransportButtons({
  playbackState,
  position,
  duration,
  onTogglePlay,
  onSeek,
  playSize = 'lg',
  compact = false,
}: {
  playbackState: PlaybackState
  position: number
  duration: number
  onTogglePlay: () => void
  onSeek: (time: number) => void
  playSize?: 'md' | 'lg'
  compact?: boolean
}) {
  const playClass = playSize === 'lg' ? 'w-14 h-14 text-2xl' : 'w-10 h-10 text-xl'
  const skipClass = compact
    ? 'min-w-9 min-h-9 text-base'
    : 'min-w-11 min-h-11 text-lg'

  return (
    <div className={['flex items-center justify-center', compact ? 'gap-2' : 'gap-4'].join(' ')}>
      <button
        type="button"
        onClick={() => onSeek(Math.max(0, position - 5))}
        className={`${skipClass} flex items-center justify-center text-white/45 hover:text-white touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]`}
        aria-label="Rewind 5 seconds"
      >
        ⏮
      </button>
      <button
        type="button"
        onClick={onTogglePlay}
        className={`${playClass} rounded-full bg-cinnabar-accent text-white flex items-center justify-center touch-manipulation transition-[transform,box-shadow] duration-150 ease-out active:scale-[0.96]`}
        style={{ boxShadow: '0 0 18px rgba(248,113,113,0.35)' }}
        aria-label={playbackState === 'playing' ? 'Pause playback' : 'Start playback'}
      >
        <span className={playbackState === 'playing' ? '' : 'pl-0.5'} aria-hidden>
          {playbackState === 'playing' ? '⏸' : '▶'}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onSeek(Math.min(duration, position + 5))}
        className={`${skipClass} flex items-center justify-center text-white/45 hover:text-white touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]`}
        aria-label="Forward 5 seconds"
      >
        ⏭
      </button>
    </div>
  )
}

function CompactVolume({ volumePct, onVolumeChange }: { volumePct: number; onVolumeChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/35 text-sm w-4 shrink-0" aria-hidden>
        {volumePct === 0 ? '🔇' : volumePct < 50 ? '🔉' : '🔊'}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={volumePct}
        onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
        className="flex-1 accent-cinnabar-accent touch-manipulation h-1"
        aria-label="Volume"
      />
      <span className="text-white/45 text-xs w-10 text-right tabular-nums shrink-0">{volumePct}%</span>
    </div>
  )
}

function ABLoopControls({
  abLoop,
  armingAB,
  abLoopError,
  onToggleArm,
  onClearAB,
  compact = false,
}: {
  abLoop: ABLoop
  armingAB: 'a' | 'b' | null
  abLoopError: string | null
  onToggleArm: (which: 'a' | 'b') => void
  onClearAB: () => void
  compact?: boolean
}) {
  const chip = compact ? practiceChipBtn : toolbarChipBtn
  const btn = (which: 'a' | 'b', value: number | null) => {
    const armed = armingAB === which
    const set = value !== null
    return (
      <button
        type="button"
        onClick={() => onToggleArm(which)}
        aria-label={`${which.toUpperCase()} loop point${value !== null ? ` ${formatTime(value)}` : ''}`}
        className={[
          chip,
          armed ? toolbarChipBtnArmed : set ? toolbarChipBtnActive : toolbarChipBtnIdle,
        ].join(' ')}
      >
        {which.toUpperCase()} {value !== null ? formatTime(value) : '—'}
      </button>
    )
  }

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      <div className={['flex flex-wrap items-center', compact ? 'gap-1' : 'gap-1.5'].join(' ')}>
        {btn('a', abLoop.a)}
        {btn('b', abLoop.b)}
        {(abLoop.a !== null || abLoop.b !== null) && (
          <button
            type="button"
            onClick={onClearAB}
            className={[chip, toolbarChipBtnIdle, 'text-white/40'].join(' ')}
          >
            Clear
          </button>
        )}
      </div>
      {armingAB && (
        <p className={[
          'text-cinnabar-accent/85 animate-pulse text-pretty',
          compact ? 'text-[10px]' : 'text-[11px]',
        ].join(' ')}>
          Tap a lyric line to set {armingAB.toUpperCase()}
          {armingAB === 'b' && ' (same line loops to its end)'}
        </p>
      )}
      {abLoopError && (
        <p className={compact ? 'text-[10px] text-red-400/90' : 'text-[11px] text-red-400/90'} role="alert">{abLoopError}</p>
      )}
    </div>
  )
}

function CollapsibleABLoopSection({
  abLoop,
  armingAB,
  abLoopError,
  abLooping,
  playlistActive,
  abActive,
  onToggleArm,
  onClearAB,
  forceCollapsed,
}: {
  abLoop: ABLoop
  armingAB: 'a' | 'b' | null
  abLoopError: string | null
  abLooping: boolean
  playlistActive: boolean
  abActive: boolean
  onToggleArm: (which: 'a' | 'b') => void
  onClearAB: () => void
  forceCollapsed?: boolean
}) {
  const isDesktop = useMinWidthMd()
  const [expanded, setExpanded] = useState(abActive)

  useEffect(() => {
    if (abActive) setExpanded(true)
  }, [abActive])

  useEffect(() => {
    if (forceCollapsed && !armingAB) setExpanded(false)
  }, [forceCollapsed, armingAB])

  const shellClass = [
    'rounded-xl border shrink-0',
    abLooping ? 'border-cinnabar-accent/40 bg-cinnabar-accent/[0.06]' : 'border-cinnabar-900/80 bg-cinnabar-900/30',
  ].join(' ')

  if (isDesktop) {
    return (
      <section className={[shellClass, 'p-2.5'].join(' ')} aria-label="A-B Loop">
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <p className={toolbarSectionLabel}>A-B Loop</p>
          {abLooping && !playlistActive && (
            <span className="text-[10px] uppercase tracking-wide text-cinnabar-accent font-medium">Looping</span>
          )}
        </div>
        <ABLoopControls
          abLoop={abLoop}
          armingAB={armingAB}
          abLoopError={abLoopError}
          onToggleArm={onToggleArm}
          onClearAB={onClearAB}
        />
      </section>
    )
  }

  const aLabel = abLoop.a !== null ? formatTime(abLoop.a) : '—'
  const bLabel = abLoop.b !== null ? formatTime(abLoop.b) : '—'

  return (
    <section className={[shellClass, 'p-2'].join(' ')} aria-label="A-B Loop">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-2 min-h-9 touch-manipulation"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-white/35 shrink-0">A-B</span>
          {!expanded && (
            <span className="text-[11px] text-white/50 truncate tabular-nums">{aLabel} → {bLabel}</span>
          )}
          {abLooping && (
            <span className="text-[10px] text-cinnabar-accent font-medium shrink-0">Looping</span>
          )}
        </span>
        <span className="text-[10px] text-white/35 shrink-0" aria-hidden>{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className="pt-1.5 border-t border-cinnabar-900/60 mt-1.5">
          <ABLoopControls
            abLoop={abLoop}
            armingAB={armingAB}
            abLoopError={abLoopError}
            onToggleArm={onToggleArm}
            onClearAB={onClearAB}
            compact
          />
        </div>
      )}
    </section>
  )
}

const SWIPE_MIN_PX = 48

const practiceChipBtn =
  'min-h-9 px-2.5 py-1 rounded-lg border text-[11px] touch-manipulation transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.96] tabular-nums'

function loopsPageSize(compactMobile: boolean): number {
  return compactMobile ? 2 : 3
}

function PlaylistCompactPlayer({
  entries,
  playlistIndex,
  playlistRepeatCount,
  onStep,
  onRepeatChange,
}: {
  entries: ABLoopPlaylistEntry[]
  playlistIndex: number
  playlistRepeatCount: number
  onStep: (delta: -1 | 1) => void
  onRepeatChange: (count: number) => void
}) {
  const current = entries[playlistIndex]
  const [repeatOpen, setRepeatOpen] = useState(false)
  const repeatRef = useRef<HTMLDivElement>(null)
  const repeatTriggerRef = useRef<HTMLButtonElement>(null)
  const repeatMenuRef = useRef<HTMLDivElement>(null)
  const [repeatMenuPos, setRepeatMenuPos] = useState<{ left: number; bottom: number; width: number } | null>(null)
  const swipeStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!repeatOpen) return
    const onPointerDown = (e: Event) => {
      const target = e.target as Node
      if (repeatTriggerRef.current?.contains(target)) return
      if (repeatMenuRef.current?.contains(target)) return
      setRepeatOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [repeatOpen])

  useLayoutEffect(() => {
    if (!repeatOpen || !repeatTriggerRef.current) return
    const rect = repeatTriggerRef.current.getBoundingClientRect()
    const margin = 8
    const estHeight = 120
    const spaceAbove = rect.top - margin
    const openUp = spaceAbove >= estHeight || spaceAbove >= rect.bottom - margin
    setRepeatMenuPos({
      left: rect.left,
      width: rect.width,
      bottom: openUp
        ? window.innerHeight - rect.top + 4
        : window.innerHeight - rect.bottom - 4 - estHeight,
    })
  }, [repeatOpen])

  if (!current) return null

  const label = playlistEntryLabel(current)
  const canStep = entries.length > 1

  const handlePointerDown = (e: ReactPointerEvent) => {
    swipeStart.current = { x: e.clientX, y: e.clientY }
  }

  const handlePointerUp = (e: ReactPointerEvent) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || !canStep) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > Math.abs(dx)) return
    onStep(dx > 0 ? -1 : 1)
  }

  return (
    <div
      className="rounded-lg border border-cinnabar-accent/30 bg-cinnabar-accent/[0.06] px-2 py-2 space-y-1.5"
      role="group"
      aria-label={`Playlist loop ${playlistIndex + 1} of ${entries.length}`}
    >
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          disabled={!canStep}
          onClick={() => onStep(-1)}
          className="min-w-9 min-h-9 shrink-0 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-25 touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]"
          aria-label="Previous loop"
        >
          ‹
        </button>
        <div
          className="flex-1 min-w-0 text-center px-1 touch-pan-y"
          aria-live="polite"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => { swipeStart.current = null }}
        >
          <p className="text-xs font-medium text-white truncate">{label}</p>
          <p className="text-[10px] text-white/40 tabular-nums mt-0.5">
            {playlistIndex + 1} / {entries.length}
          </p>
        </div>
        <button
          type="button"
          disabled={!canStep}
          onClick={() => onStep(1)}
          className="min-w-9 min-h-9 shrink-0 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-25 touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]"
          aria-label="Next loop"
        >
          ›
        </button>
      </div>

      <div ref={repeatRef} className="relative">
        <button
          ref={repeatTriggerRef}
          type="button"
          onClick={() => setRepeatOpen((v) => !v)}
          aria-expanded={repeatOpen}
          aria-haspopup="dialog"
          className={[
            practiceChipBtn,
            repeatOpen ? toolbarChipBtnActive : toolbarChipBtnIdle,
            'w-full',
          ].join(' ')}
        >
          {playlistRepeatButtonLabel(playlistRepeatCount)}
        </button>
        {repeatOpen && repeatMenuPos && createPortal(
          <div
            ref={repeatMenuRef}
            role="dialog"
            aria-label="Repeats before next loop"
            style={{
              left: repeatMenuPos.left,
              width: repeatMenuPos.width,
              bottom: repeatMenuPos.bottom,
            }}
            className="fixed z-[60] rounded-lg border border-cinnabar-800 bg-cinnabar-900 shadow-lg shadow-black/40 p-2"
          >
            <p className="text-[10px] text-white/40 px-0.5 pb-1">Plays before next loop</p>
            <div className="flex flex-wrap gap-1">
              {PLAYLIST_REPEAT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    onRepeatChange(preset)
                    setRepeatOpen(false)
                  }}
                  className={[
                    practiceChipBtn,
                    playlistRepeatCount === preset ? toolbarChipBtnActive : toolbarChipBtnIdle,
                  ].join(' ')}
                  aria-pressed={playlistRepeatCount === preset}
                >
                  {playlistRepeatLabel(preset)}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
      </div>
    </div>
  )
}

function ABLoopPlaylistControls({
  entries,
  playlistActive,
  playlistIndex,
  playlistRepeatCount,
  onPlaylistRepeatCountChange,
  canSave,
  onSave,
  onTogglePlaylist,
  onLoadEntry,
  onMoveEntry,
  onRemoveEntry,
  onRenameEntry,
  onClear,
  canExport,
  onExport,
  exporting,
  exportError,
  compactPlayerInDock = false,
  compactMobile = false,
}: {
  entries: ABLoopPlaylistEntry[]
  playlistActive: boolean
  playlistIndex: number
  playlistRepeatCount: number
  onPlaylistRepeatCountChange: (count: number) => void
  canSave: boolean
  onSave: () => void
  onTogglePlaylist: () => void
  onLoadEntry: (entry: ABLoopPlaylistEntry, index: number) => void
  onMoveEntry: (from: number, to: number) => void
  onRemoveEntry: (entryId: string) => void
  onRenameEntry: (entryId: string, label: string) => void
  onClear: () => void
  canExport?: boolean
  onExport?: () => void
  exporting?: boolean
  exportError?: string | null
  /** When true, compact player is rendered in the dock instead of here. */
  compactPlayerInDock?: boolean
  /** Tighter layout for mobile inline panel. */
  compactMobile?: boolean
}) {
  const pageSize = loopsPageSize(compactMobile)
  const [listPage, setListPage] = useState(0)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setListPage((page) => {
      const maxPage = Math.max(0, Math.ceil(entries.length / pageSize) - 1)
      return Math.min(page, maxPage)
    })
  }, [entries.length, pageSize])

  useEffect(() => {
    if (editingId) editRef.current?.focus()
  }, [editingId])

  useLayoutEffect(() => {
    if (!menuId || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const estMenuHeight = 160
    const margin = 8
    const top = rect.bottom + 2 + estMenuHeight > window.innerHeight
      ? Math.max(margin, rect.top - 2 - estMenuHeight)
      : rect.bottom + 2
    setMenuPos({ top, right: window.innerWidth - rect.right })
  }, [menuId])

  useEffect(() => {
    if (!menuId) return
    const close = () => setMenuId(null)
    // capture:true catches scroll on any ancestor (e.g. the <aside> panel),
    // since the saved-loops list no longer scrolls as its own container.
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menuId])

  useEffect(() => {
    if (!menuId) return
    const onPointerDown = (e: Event) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setMenuId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuId])

  const startRename = (entry: ABLoopPlaylistEntry) => {
    setMenuId(null)
    setEditingId(entry.id)
    setEditValue(playlistEntryLabel(entry))
  }

  const commitRename = (entryId: string) => {
    onRenameEntry(entryId, editValue)
    setEditingId(null)
  }

  const hasEntries = entries.length > 0
  const showCompactPlayer = playlistActive && hasEntries && !compactPlayerInDock
  const showManagementList = hasEntries && !playlistActive
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize))
  const pageStart = listPage * pageSize
  const visibleEntries = entries.slice(pageStart, pageStart + pageSize)

  const stepPlaylist = (delta: -1 | 1) => {
    const nextIndex = delta < 0
      ? wrapPlaylistIndexPrev(playlistIndex, entries.length)
      : wrapPlaylistIndex(playlistIndex, entries.length)
    onLoadEntry(entries[nextIndex], nextIndex)
  }

  return (
    <div className={compactMobile ? 'space-y-1' : 'space-y-1.5'}>
      <div className={compactMobile ? 'space-y-1' : 'space-y-1.5'}>
        {!compactMobile && <p className={toolbarSectionLabel}>Saved loops</p>}
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className={[
              practiceChipBtn,
              canSave ? toolbarChipBtnActive : toolbarChipBtnIdle,
              'disabled:opacity-35',
            ].join(' ')}
          >
            {compactMobile ? 'Save loop' : 'Save current loop'}
          </button>
          {hasEntries && !compactPlayerInDock && (
            <button
              type="button"
              onClick={onTogglePlaylist}
              className={[
                practiceChipBtn,
                playlistActive
                  ? 'border-red-400/60 bg-red-500/15 text-red-200 font-semibold'
                  : toolbarChipBtnIdle,
              ].join(' ')}
              aria-label={playlistActive ? `Stop playlist (${playlistIndex + 1} of ${entries.length})` : 'Play all saved loops'}
            >
              {playlistActive ? `Stop (${playlistIndex + 1}/${entries.length})` : 'Play all'}
            </button>
          )}
          {hasEntries && compactPlayerInDock && !playlistActive && (
            <button
              type="button"
              onClick={onTogglePlaylist}
              className={[practiceChipBtn, toolbarChipBtnIdle].join(' ')}
              aria-label="Play all saved loops"
            >
              Play all
            </button>
          )}
        </div>

        {!hasEntries && !compactMobile && (
          <p className="text-[10px] text-white/30 text-pretty">
            Set A and B, then save loops here.
          </p>
        )}
      </div>

      {showCompactPlayer && (
        <PlaylistCompactPlayer
          entries={entries}
          playlistIndex={playlistIndex}
          playlistRepeatCount={playlistRepeatCount}
          onStep={stepPlaylist}
          onRepeatChange={onPlaylistRepeatCountChange}
        />
      )}

      {showManagementList && (
        <>
          <div className="space-y-1">
            {!compactMobile && <p className="text-[10px] text-white/35">Repeats before next loop</p>}
            <div className="flex flex-wrap gap-1">
              {PLAYLIST_REPEAT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onPlaylistRepeatCountChange(preset)}
                  className={[
                    practiceChipBtn,
                    playlistRepeatCount === preset ? toolbarChipBtnActive : toolbarChipBtnIdle,
                  ].join(' ')}
                  aria-label={`Repeat each loop ${playlistRepeatLabel(preset)} times before advancing`}
                  aria-pressed={playlistRepeatCount === preset}
                >
                  {playlistRepeatLabel(preset)}
                </button>
              ))}
            </div>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-2 text-[10px] text-white/40 tabular-nums">
              <button
                type="button"
                disabled={listPage <= 0}
                onClick={() => setListPage((p) => Math.max(0, p - 1))}
                className="min-h-8 min-w-8 rounded-lg text-white/45 hover:text-white disabled:opacity-25 touch-manipulation"
                aria-label="Previous saved loops page"
              >
                ‹
              </button>
              <span>{pageStart + 1}–{Math.min(pageStart + pageSize, entries.length)} of {entries.length}</span>
              <button
                type="button"
                disabled={listPage >= pageCount - 1}
                onClick={() => setListPage((p) => Math.min(pageCount - 1, p + 1))}
                className="min-h-8 min-w-8 rounded-lg text-white/45 hover:text-white disabled:opacity-25 touch-manipulation"
                aria-label="Next saved loops page"
              >
                ›
              </button>
            </div>
          )}

          <ul className="space-y-1">
            {visibleEntries.map((entry, i) => {
              const index = pageStart + i
              const isEditing = editingId === entry.id
              const menuOpen = menuId === entry.id
              return (
                <li
                  key={entry.id}
                  className="relative flex items-center gap-0.5 rounded-lg border min-h-9 border-cinnabar-900/80 bg-cinnabar-950/40"
                >
                  <button
                    type="button"
                    onClick={() => onLoadEntry(entry, index)}
                    className="flex-1 min-w-0 text-left px-2 py-1 touch-manipulation"
                    aria-label={`Load loop ${playlistEntryLabel(entry)}`}
                  >
                    {isEditing ? (
                      <input
                        ref={editRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitRename(entry.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(entry.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-cinnabar-900 text-[11px] text-white px-1.5 py-0.5 rounded border border-cinnabar-accent/50 outline-none"
                      />
                    ) : (
                      <span className="block text-[11px] truncate tabular-nums text-white/75">
                        {playlistEntryLabel(entry)}
                      </span>
                    )}
                  </button>
                  <div className="relative shrink-0 pr-0.5">
                    <button
                      ref={menuOpen ? triggerRef : undefined}
                      type="button"
                      onClick={() => setMenuId(menuOpen ? null : entry.id)}
                      className="min-w-8 min-h-8 flex items-center justify-center text-white/30 hover:text-white/70 text-sm touch-manipulation"
                      aria-label={`Options for loop ${playlistEntryLabel(entry)}`}
                      aria-expanded={menuOpen}
                    >
                      ⋯
                    </button>
                    {menuOpen && menuPos && createPortal(
                      <div
                        ref={dropdownRef}
                        style={{ top: menuPos.top, right: menuPos.right }}
                        className="fixed z-[60] w-36 rounded-lg border border-cinnabar-800 bg-cinnabar-900 shadow-lg shadow-black/40 py-1"
                      >
                        <button type="button" onClick={() => startRename(entry)} className="w-full text-left px-3 py-2 text-xs text-white/75 hover:bg-white/5">Rename</button>
                        <button type="button" disabled={index === 0} onClick={() => { onMoveEntry(index, index - 1); setMenuId(null) }} className="w-full text-left px-3 py-2 text-xs text-white/75 hover:bg-white/5 disabled:opacity-30">Move up</button>
                        <button type="button" disabled={index >= entries.length - 1} onClick={() => { onMoveEntry(index, index + 1); setMenuId(null) }} className="w-full text-left px-3 py-2 text-xs text-white/75 hover:bg-white/5 disabled:opacity-30">Move down</button>
                        <button type="button" onClick={() => { onRemoveEntry(entry.id); setMenuId(null) }} className="w-full text-left px-3 py-2 text-xs text-red-400/90 hover:bg-white/5">Remove</button>
                      </div>,
                      document.body,
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
            {canExport && onExport && (
              <button
                type="button"
                onClick={onExport}
                disabled={exporting}
                className="text-cinnabar-accent/90 hover:text-cinnabar-accent disabled:opacity-40 touch-manipulation"
              >
                {exporting ? 'Exporting…' : 'Export all loops'}
              </button>
            )}
            <button
              type="button"
              onClick={onClear}
              className="text-white/35 hover:text-white/60 touch-manipulation"
            >
              Clear all
            </button>
          </div>
        </>
      )}

      {exportError && (
        <p className="text-[11px] text-red-400/90" role="alert">{exportError}</p>
      )}
    </div>
  )
}

function SpeedControl({
  speedPct,
  speed,
  onSpeedChange,
}: {
  speedPct: number
  speed: number
  onSpeedChange: (speed: number) => void
}) {
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)

  const handleSliderPointerUp = (e: ReactPointerEvent<HTMLInputElement>) => {
    const now = Date.now()
    const prev = lastTapRef.current
    if (prev) {
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      if (now - prev.time < DOUBLE_TAP_MS && dx * dx + dy * dy < 64) {
        onSpeedChange(NORMAL_SPEED)
        lastTapRef.current = null
        return
      }
    }
    lastTapRef.current = { time: now, x: e.clientX, y: e.clientY }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={50}
          max={200}
          step={5}
          value={speed * 100}
          onChange={(e) => onSpeedChange(Number(e.target.value) / 100)}
          onDoubleClick={() => onSpeedChange(NORMAL_SPEED)}
          onPointerUp={handleSliderPointerUp}
          className="flex-1 accent-cinnabar-accent touch-manipulation h-1"
          aria-label="Playback speed"
        />
        <span className="text-white/45 text-[11px] w-9 text-right tabular-nums shrink-0">{speedPct}%</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {LEARNER_SPEED_PRESETS.map(({ label, speed: presetSpeed }) => (
          <button
            key={presetSpeed}
            type="button"
            onClick={() => onSpeedChange(presetSpeed)}
            className={[
              practiceChipBtn,
              speed === presetSpeed ? toolbarChipBtnActive : toolbarChipBtnIdle,
            ].join(' ')}
            aria-label={`${label}, ${Math.round(presetSpeed * 100)} percent speed`}
          >
            {label}
          </button>
        ))}
        {speed !== NORMAL_SPEED && (
          <button
            type="button"
            onClick={() => onSpeedChange(NORMAL_SPEED)}
            className={[practiceChipBtn, toolbarChipBtnIdle, 'text-white/40'].join(' ')}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}

function MoreMenu({
  showAbExport,
  onExportAb,
  exporting,
  exportError,
  canIncludeSrt,
  includeSrt,
  onIncludeSrtChange,
}: {
  showAbExport?: boolean
  onExportAb?: () => void
  exporting?: boolean
  exportError?: string | null
  canIncludeSrt?: boolean
  includeSrt?: boolean
  onIncludeSrtChange?: (value: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const hasItems = showAbExport

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!hasItems) return null

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="More playback options"
        className={[
          practiceChipBtn, toolbarChipBtnIdle, 'w-full text-left px-3',
          open ? toolbarChipBtnActive : '',
        ].join(' ')}
      >
        More options
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="More playback options"
          className="absolute left-0 right-0 bottom-full mb-1 z-50 rounded-xl border border-cinnabar-800 bg-cinnabar-900 shadow-xl shadow-black/40 p-2.5 space-y-2"
        >
            {showAbExport && onExportAb && (
              <section aria-label="Export loop">
                <p className={[toolbarSectionLabel, 'mb-1.5'].join(' ')}>Export</p>
                <div className="space-y-1.5">
                  {canIncludeSrt && onIncludeSrtChange && (
                    <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-cinnabar-800 text-[10px] text-white/60 cursor-pointer min-h-9">
                      <input
                        type="checkbox"
                        checked={!!includeSrt}
                        onChange={(e) => onIncludeSrtChange(e.target.checked)}
                        className="accent-cinnabar-accent"
                      />
                      Include .srt subtitles
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => { onExportAb(); setOpen(false) }}
                    disabled={exporting}
                    className={[practiceChipBtn, toolbarChipBtnActive, 'w-full font-medium disabled:opacity-40'].join(' ')}
                  >
                    {exporting ? 'Exporting…' : 'Export A-B loop'}
                  </button>
                </div>
              </section>
            )}
            {exportError && <p className="text-[10px] text-red-400/90 px-1" role="alert">{exportError}</p>}
          </div>
      )}
    </div>
  )
}

const PRACTICE_PANEL_ID = 'practice-panel-content'

function practicePanelHint(
  open: boolean,
  playlistActive: boolean,
  playlistIndex: number,
  playlistLength: number,
  speedPct: number,
): string {
  if (open) return 'Close'
  if (playlistActive && playlistLength > 0) {
    return `${playlistIndex + 1}/${playlistLength}`
  }
  if (speedPct !== 100) return `${speedPct}%`
  return 'Open'
}

/** Collapsible saved-loops + speed — expands inline so lyrics stay visible on mobile. */
function PracticePanelSection({
  open,
  onToggle,
  playlistActive,
  playlistIndex,
  playlistLength,
  speedPct,
  children,
}: {
  open: boolean
  onToggle: () => void
  playlistActive: boolean
  playlistIndex: number
  playlistLength: number
  speedPct: number
  children: ReactNode
}) {
  const hint = practicePanelHint(open, playlistActive, playlistIndex, playlistLength, speedPct)
  const triggerActive = open || playlistActive
  const isDesktop = useMinWidthMd()

  return (
    <section
      className={[
        'rounded-xl border shrink-0',
        open
          ? 'border-cinnabar-accent/45 bg-cinnabar-accent/[0.05]'
          : playlistActive
            ? 'border-red-400/30 bg-red-500/[0.03]'
            : 'border-cinnabar-900/80 bg-cinnabar-900/30',
      ].join(' ')}
      aria-label="Saved loops and speed"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={PRACTICE_PANEL_ID}
        aria-label={open ? 'Close saved loops and speed' : 'Open saved loops and speed'}
        className={[
          displayMenuTrigger,
          'w-full justify-between gap-2 px-3 min-h-9 md:min-h-10 rounded-xl border-0',
          isDesktop ? 'py-2.5' : 'py-2',
          triggerActive ? displayMenuTriggerActive : displayMenuTriggerIdle,
          open ? 'rounded-b-none border-b border-cinnabar-accent/25' : '',
        ].join(' ')}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span
            className={[
              'text-[10px] leading-none shrink-0 transition-transform duration-200 ease-out',
              open ? 'text-cinnabar-accent' : 'text-white/35',
            ].join(' ')}
            aria-hidden
          >
            {open ? '▴' : '▾'}
          </span>
          <span className={[
            'text-xs font-medium truncate',
            playlistActive && !open ? 'text-red-200/85' : open ? 'text-cinnabar-accent' : 'text-white/55',
          ].join(' ')}>
            {isDesktop ? 'Saved loops & speed' : 'Loops & speed'}
          </span>
        </span>
        <span className={[
          'text-[11px] shrink-0 tabular-nums',
          open ? 'text-cinnabar-accent/80 font-medium' : playlistActive ? 'text-red-200/65' : 'text-white/35',
        ].join(' ')}>
          {hint}
        </span>
      </button>

      {open && (
        <div id={PRACTICE_PANEL_ID} className="border-t border-cinnabar-accent/20">
          <div className="px-2.5 pb-2 pt-1.5 md:px-3 md:pb-3 md:pt-2 space-y-2 md:space-y-3">
            {children}
          </div>
        </div>
      )}
    </section>
  )
}

/** Playback dock — essential controls first; practice tools tucked in a collapsible section. */
export function PlayerControls({
  mode,
  playbackState,
  position,
  duration,
  progress,
  speed,
  speedPct,
  volumePct,
  onSpeedChange,
  onVolumeChange,
  abLoop,
  armingAB,
  abLoopError,
  onTogglePlay,
  onSeek,
  onToggleArm,
  onClearAB,
  showAbExport,
  onExportAb,
  abExporting,
  abExportError,
  abExportCanIncludeSrt,
  abExportIncludeSrt,
  onAbExportIncludeSrtChange,
  playlistEntries = [],
  playlistActive = false,
  playlistIndex = 0,
  playlistRepeatCount = 3,
  onPlaylistRepeatCountChange,
  canSaveToPlaylist = false,
  onSaveToPlaylist,
  onTogglePlaylist,
  onLoadPlaylistEntry,
  onMovePlaylistEntry,
  onRemovePlaylistEntry,
  onRenamePlaylistEntry,
  onClearPlaylist,
  showPlaylistExport,
  onExportPlaylist,
  playlistExporting,
  playlistExportError,
}: Props) {
  const abActive = abLoop.a !== null || abLoop.b !== null || armingAB !== null
  const abLooping = isABLoopActive(abLoop)
  const isDesktop = useMinWidthMd()
  const [practiceOpen, setPracticeOpen] = useState(false)

  useEffect(() => {
    if (abActive && isDesktop) setPracticeOpen(true)
  }, [abActive, isDesktop])

  useEffect(() => {
    if (playlistActive && isDesktop) setPracticeOpen(true)
  }, [playlistActive, isDesktop])

  const hasPlaylistEntries = playlistEntries.length > 0
  const playlistHandlersReady = Boolean(
    onTogglePlaylist && onLoadPlaylistEntry && onPlaylistRepeatCountChange,
  )

  const stepPlaylist = (delta: -1 | 1) => {
    if (!onLoadPlaylistEntry) return
    const nextIndex = delta < 0
      ? wrapPlaylistIndexPrev(playlistIndex, playlistEntries.length)
      : wrapPlaylistIndex(playlistIndex, playlistEntries.length)
    onLoadPlaylistEntry(playlistEntries[nextIndex], nextIndex)
  }

  return (
    <aside
      className={[
        'shrink-0 border-t md:border-t-0 md:border-l border-cinnabar-900',
        'bg-cinnabar-950/98 md:bg-cinnabar-950 backdrop-blur-sm md:backdrop-blur-none',
        'px-3 pt-2 md:pt-4 md:px-5 md:w-72 lg:w-80',
        'flex flex-col gap-1.5 md:gap-2.5',
      ].join(' ')}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 8px), 8px)' }}
      onClick={(e) => e.stopPropagation()}
      aria-label="Playback controls"
    >
      <section className="space-y-1 shrink-0" aria-label="Playback">
        <SeekBar progress={progress} duration={duration} onSeek={onSeek} />
        <div className="flex justify-between text-[10px] md:text-[11px] text-white/30 tabular-nums">
          <span>{formatTime(position)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <TransportButtons
          playbackState={playbackState}
          position={position}
          duration={duration}
          onTogglePlay={onTogglePlay}
          onSeek={onSeek}
          playSize={mode === 'edit' || !isDesktop ? 'md' : 'lg'}
          compact={!isDesktop}
        />
        {(!practiceOpen || isDesktop) && (
          <CompactVolume volumePct={volumePct} onVolumeChange={onVolumeChange} />
        )}
      </section>

      {mode === 'play' && (
        <div className="flex flex-col gap-1.5 md:gap-2 shrink-0">
          <CollapsibleABLoopSection
            abLoop={abLoop}
            armingAB={armingAB}
            abLoopError={abLoopError}
            abLooping={abLooping}
            playlistActive={playlistActive}
            abActive={abActive}
            onToggleArm={onToggleArm}
            onClearAB={onClearAB}
            forceCollapsed={practiceOpen && !isDesktop}
          />

          {playlistActive && hasPlaylistEntries && playlistHandlersReady && (
            <div className="shrink-0 space-y-1">
              <PlaylistCompactPlayer
                entries={playlistEntries}
                playlistIndex={playlistIndex}
                playlistRepeatCount={playlistRepeatCount}
                onStep={stepPlaylist}
                onRepeatChange={onPlaylistRepeatCountChange!}
              />
              <button
                type="button"
                onClick={onTogglePlaylist}
                className={[
                  practiceChipBtn,
                  'w-full border-red-400/60 bg-red-500/15 text-red-200 font-semibold',
                ].join(' ')}
                aria-label={`Stop playlist (${playlistIndex + 1} of ${playlistEntries.length})`}
              >
                Stop ({playlistIndex + 1}/{playlistEntries.length})
              </button>
            </div>
          )}

          <PracticePanelSection
            open={practiceOpen}
            onToggle={() => setPracticeOpen((v) => !v)}
            playlistActive={playlistActive}
            playlistIndex={playlistIndex}
            playlistLength={playlistEntries.length}
            speedPct={speedPct}
          >
            {onSaveToPlaylist && onTogglePlaylist && onLoadPlaylistEntry && onMovePlaylistEntry && onRemovePlaylistEntry && onRenamePlaylistEntry && onClearPlaylist && (
              <ABLoopPlaylistControls
                entries={playlistEntries}
                playlistActive={playlistActive}
                playlistIndex={playlistIndex}
                playlistRepeatCount={playlistRepeatCount}
                onPlaylistRepeatCountChange={onPlaylistRepeatCountChange ?? (() => {})}
                canSave={canSaveToPlaylist}
                onSave={onSaveToPlaylist}
                onTogglePlaylist={onTogglePlaylist}
                onLoadEntry={onLoadPlaylistEntry}
                onMoveEntry={onMovePlaylistEntry}
                onRemoveEntry={onRemovePlaylistEntry}
                onRenameEntry={onRenamePlaylistEntry}
                onClear={onClearPlaylist}
                canExport={showPlaylistExport}
                onExport={onExportPlaylist}
                exporting={playlistExporting}
                exportError={playlistExportError}
                compactPlayerInDock={playlistActive && hasPlaylistEntries}
                compactMobile={!isDesktop}
              />
            )}
            <div className="border-t border-cinnabar-900/50 pt-2 md:pt-2.5">
              {!isDesktop ? null : (
                <p className={[toolbarSectionLabel, 'mb-1.5'].join(' ')}>Speed</p>
              )}
              <SpeedControl speedPct={speedPct} speed={speed} onSpeedChange={onSpeedChange} />
            </div>
          </PracticePanelSection>

          <MoreMenu
            showAbExport={showAbExport}
            onExportAb={onExportAb}
            exporting={abExporting}
            exportError={abExportError}
            canIncludeSrt={abExportCanIncludeSrt}
            includeSrt={abExportIncludeSrt}
            onIncludeSrtChange={onAbExportIncludeSrtChange}
          />
        </div>
      )}
    </aside>
  )
}
