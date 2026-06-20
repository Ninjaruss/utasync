import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { PlaybackState, ABLoop, ABLoopPlaylistEntry } from '../core/types'
import { isABLoopActive } from './abLoopUtils'
import { playlistEntryLabel } from './abLoopPlaylist'
import {
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
  canSaveToPlaylist?: boolean
  onSaveToPlaylist?: () => void
  onTogglePlaylist?: () => void
  onLoadPlaylistEntry?: (entry: ABLoopPlaylistEntry, index: number) => void
  onMovePlaylistEntry?: (from: number, to: number) => void
  onRemovePlaylistEntry?: (entryId: string) => void
  onRenamePlaylistEntry?: (entryId: string, label: string) => void
  onClearPlaylist?: () => void
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
}: {
  playbackState: PlaybackState
  position: number
  duration: number
  onTogglePlay: () => void
  onSeek: (time: number) => void
  playSize?: 'md' | 'lg'
}) {
  const playClass = playSize === 'lg' ? 'w-14 h-14 text-2xl' : 'w-11 h-11 text-xl'

  return (
    <div className="flex items-center justify-center gap-4">
      <button
        type="button"
        onClick={() => onSeek(Math.max(0, position - 5))}
        className="min-w-11 min-h-11 flex items-center justify-center text-white/45 hover:text-white text-lg touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]"
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
        className="min-w-11 min-h-11 flex items-center justify-center text-white/45 hover:text-white text-lg touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]"
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
}: {
  abLoop: ABLoop
  armingAB: 'a' | 'b' | null
  abLoopError: string | null
  onToggleArm: (which: 'a' | 'b') => void
  onClearAB: () => void
}) {
  const btn = (which: 'a' | 'b', value: number | null) => {
    const armed = armingAB === which
    const set = value !== null
    return (
      <button
        type="button"
        onClick={() => onToggleArm(which)}
        aria-label={`${which.toUpperCase()} loop point${value !== null ? ` ${formatTime(value)}` : ''}`}
        className={[
          toolbarChipBtn,
          armed ? toolbarChipBtnArmed : set ? toolbarChipBtnActive : toolbarChipBtnIdle,
        ].join(' ')}
      >
        {which.toUpperCase()} {value !== null ? formatTime(value) : '—'}
      </button>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {btn('a', abLoop.a)}
        {btn('b', abLoop.b)}
        {(abLoop.a !== null || abLoop.b !== null) && (
          <button
            type="button"
            onClick={onClearAB}
            className={[toolbarChipBtn, toolbarChipBtnIdle, 'text-white/40'].join(' ')}
          >
            Clear
          </button>
        )}
      </div>
      {armingAB && (
        <p className="text-[11px] text-cinnabar-accent/85 animate-pulse text-pretty">
          Tap a lyric line to set {armingAB.toUpperCase()}
          {armingAB === 'b' && ' (same line loops to its end)'}
        </p>
      )}
      {abLoopError && (
        <p className="text-[11px] text-red-400/90" role="alert">{abLoopError}</p>
      )}
    </div>
  )
}

function ABLoopPlaylistControls({
  entries,
  playlistActive,
  playlistIndex,
  canSave,
  onSave,
  onTogglePlaylist,
  onLoadEntry,
  onMoveEntry,
  onRemoveEntry,
  onRenameEntry,
  onClear,
}: {
  entries: ABLoopPlaylistEntry[]
  playlistActive: boolean
  playlistIndex: number
  canSave: boolean
  onSave: () => void
  onTogglePlaylist: () => void
  onLoadEntry: (entry: ABLoopPlaylistEntry, index: number) => void
  onMoveEntry: (from: number, to: number) => void
  onRemoveEntry: (entryId: string) => void
  onRenameEntry: (entryId: string, label: string) => void
  onClear: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) editRef.current?.focus()
  }, [editingId])

  const startRename = (entry: ABLoopPlaylistEntry) => {
    setEditingId(entry.id)
    setEditValue(playlistEntryLabel(entry))
  }

  const commitRename = (entryId: string) => {
    onRenameEntry(entryId, editValue)
    setEditingId(null)
  }

  const hasEntries = entries.length > 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className={toolbarSectionLabel}>Loop playlist</p>
        {playlistActive && hasEntries && (
          <span className="text-[10px] text-cinnabar-accent tabular-nums font-medium">
            {playlistIndex + 1}/{entries.length}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className={[
            toolbarChipBtn,
            canSave ? toolbarChipBtnActive : toolbarChipBtnIdle,
            'disabled:opacity-35',
          ].join(' ')}
        >
          Save loop
        </button>
        {hasEntries && (
          <button
            type="button"
            onClick={onTogglePlaylist}
            className={[
              toolbarChipBtn,
              playlistActive ? toolbarChipBtnActive : toolbarChipBtnIdle,
            ].join(' ')}
          >
            {playlistActive ? 'Stop playlist' : 'Play playlist'}
          </button>
        )}
        {hasEntries && (
          <button
            type="button"
            onClick={onClear}
            className={[toolbarChipBtn, toolbarChipBtnIdle, 'text-white/40'].join(' ')}
          >
            Clear list
          </button>
        )}
      </div>

      {!hasEntries && (
        <p className="text-[11px] text-white/30 text-pretty">
          Save A-B loops here, then play them in order for practice.
        </p>
      )}

      {hasEntries && (
        <ul className="space-y-1 max-h-36 overflow-y-auto overscroll-contain pr-0.5">
          {entries.map((entry, i) => {
            const isCurrent = playlistActive && i === playlistIndex
            const isEditing = editingId === entry.id
            return (
              <li
                key={entry.id}
                className={[
                  'flex items-center gap-1 rounded-lg border px-1.5 py-1 min-h-10',
                  isCurrent
                    ? 'border-cinnabar-accent/50 bg-cinnabar-accent/[0.08]'
                    : 'border-cinnabar-900/80 bg-cinnabar-950/40',
                ].join(' ')}
              >
                <button
                  type="button"
                  onClick={() => onLoadEntry(entry, i)}
                  className="flex-1 min-w-0 text-left px-1 py-1 touch-manipulation"
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
                      className="w-full bg-cinnabar-900 text-xs text-white px-1.5 py-0.5 rounded border border-cinnabar-accent/50 outline-none"
                    />
                  ) : (
                    <span className="block text-xs text-white/75 truncate text-pretty tabular-nums">
                      {playlistEntryLabel(entry)}
                    </span>
                  )}
                </button>
                <div className="flex items-center shrink-0">
                  <button
                    type="button"
                    onClick={() => startRename(entry)}
                    className="min-w-8 min-h-8 flex items-center justify-center text-white/25 hover:text-white/60 text-[10px] touch-manipulation"
                    aria-label="Rename loop"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveEntry(i, i - 1)}
                    disabled={i === 0}
                    className="min-w-8 min-h-8 flex items-center justify-center text-white/30 hover:text-white disabled:opacity-20 text-xs touch-manipulation"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveEntry(i, i + 1)}
                    disabled={i >= entries.length - 1}
                    className="min-w-8 min-h-8 flex items-center justify-center text-white/30 hover:text-white disabled:opacity-20 text-xs touch-manipulation"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveEntry(entry.id)}
                    className="min-w-8 min-h-8 flex items-center justify-center text-white/25 hover:text-red-400 text-xs touch-manipulation"
                    aria-label="Remove loop"
                  >
                    ✕
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {playlistActive && hasEntries && (
        <p className="text-[11px] text-cinnabar-accent/80 text-pretty">
          Repeats each loop, then advances to the next entry.
        </p>
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

  const handleSliderPointerUp = (e: PointerEvent<HTMLInputElement>) => {
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
    <div className="space-y-2">
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
          className="flex-1 accent-cinnabar-accent touch-manipulation"
          aria-label="Playback speed"
        />
        <span className="text-white/45 text-xs w-10 text-right tabular-nums shrink-0">{speedPct}%</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {LEARNER_SPEED_PRESETS.map(({ label, speed: presetSpeed }) => (
          <button
            key={presetSpeed}
            type="button"
            onClick={() => onSpeedChange(presetSpeed)}
            className={[
              toolbarChipBtn,
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
            className={[toolbarChipBtn, toolbarChipBtnIdle, 'text-white/40'].join(' ')}
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
    <div ref={rootRef} className="relative pt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="More playback options"
        className={[
          toolbarChipBtn, toolbarChipBtnIdle, 'w-full text-left px-3 py-2',
          open ? toolbarChipBtnActive : '',
        ].join(' ')}
      >
        More options
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="More playback options"
          className="absolute left-0 md:left-auto md:right-0 bottom-full mb-2 z-50 w-60 rounded-xl border border-cinnabar-800 bg-cinnabar-900 shadow-xl shadow-black/40 p-3 space-y-3"
        >
          {showAbExport && onExportAb && (
            <section aria-label="Export loop">
              <p className={[toolbarSectionLabel, 'mb-2'].join(' ')}>Export</p>
              <div className="space-y-2">
                {canIncludeSrt && onIncludeSrtChange && (
                  <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-cinnabar-800 text-[11px] text-white/60 cursor-pointer min-h-9">
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
                  className={[toolbarChipBtn, toolbarChipBtnActive, 'w-full py-2 text-sm font-medium disabled:opacity-40'].join(' ')}
                >
                  {exporting ? 'Exporting…' : 'Export A-B loop'}
                </button>
              </div>
            </section>
          )}
          {exportError && <p className="text-[11px] text-red-400/90 px-1" role="alert">{exportError}</p>}
        </div>
      )}
    </div>
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
  canSaveToPlaylist = false,
  onSaveToPlaylist,
  onTogglePlaylist,
  onLoadPlaylistEntry,
  onMovePlaylistEntry,
  onRemovePlaylistEntry,
  onRenamePlaylistEntry,
  onClearPlaylist,
}: Props) {
  const abActive = abLoop.a !== null || abLoop.b !== null || armingAB !== null
  const abLooping = isABLoopActive(abLoop)
  const [practiceOpen, setPracticeOpen] = useState(abActive)

  useEffect(() => {
    if (abActive) setPracticeOpen(true)
  }, [abActive])

  const practiceStatus = playlistActive
    ? `Playlist ${playlistIndex + 1}/${Math.max(playlistEntries.length, 1)}`
    : abLooping
      ? 'Looping'
      : abActive
        ? 'A-B on'
        : !practiceOpen && speed !== NORMAL_SPEED
          ? `${speedPct}%`
          : ''

  return (
    <aside
      className="shrink-0 border-t md:border-t-0 md:border-l border-cinnabar-900 bg-cinnabar-950/98 md:bg-cinnabar-950 backdrop-blur-sm md:backdrop-blur-none px-4 pt-3 md:pt-5 md:px-5 md:w-72 lg:w-80 flex flex-col gap-3 max-h-[min(42dvh,20rem)] md:max-h-none overflow-y-auto overscroll-contain"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 12px), 12px)' }}
      onClick={(e) => e.stopPropagation()}
      aria-label="Playback controls"
    >
      <section className="space-y-2" aria-label="Playback">
        <SeekBar progress={progress} duration={duration} onSeek={onSeek} />
        <div className="flex justify-between text-[11px] text-white/30 tabular-nums">
          <span>{formatTime(position)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <TransportButtons
          playbackState={playbackState}
          position={position}
          duration={duration}
          onTogglePlay={onTogglePlay}
          onSeek={onSeek}
          playSize={mode === 'edit' ? 'md' : 'lg'}
        />
        <CompactVolume volumePct={volumePct} onVolumeChange={onVolumeChange} />
      </section>

      {mode === 'play' && (
        <>
          <section className={[
            'rounded-xl border overflow-hidden',
            abLooping ? 'border-cinnabar-accent/40 bg-cinnabar-accent/[0.06]' : 'border-cinnabar-900/80 bg-cinnabar-900/30',
          ].join(' ')}>
            <button
              type="button"
              onClick={() => setPracticeOpen((v) => !v)}
              aria-expanded={practiceOpen}
              aria-label="Practice tools"
              className="w-full flex items-center justify-between px-3 py-3 min-h-11 text-left touch-manipulation transition-[background-color] duration-150 ease-out active:bg-white/[0.03]"
            >
              <span className="text-xs font-medium text-white/55">Practice</span>
              <span className={[
                'text-[11px] tabular-nums',
                abLooping ? 'text-cinnabar-accent font-medium' : 'text-white/30',
              ].join(' ')}>
                {practiceStatus}
              </span>
            </button>
            {practiceOpen && (
              <div className="px-3 pb-3 space-y-4 border-t border-cinnabar-900/60 pt-3">
                <div className={abLooping ? 'rounded-lg ring-1 ring-inset ring-cinnabar-accent/25 p-2 -mx-0.5' : ''}>
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <p className={toolbarSectionLabel}>A-B Loop</p>
                    {abLooping && (
                      <span className="text-[10px] uppercase tracking-wide text-cinnabar-accent font-medium">
                        Looping
                      </span>
                    )}
                  </div>
                  <ABLoopControls
                    abLoop={abLoop}
                    armingAB={armingAB}
                    abLoopError={abLoopError}
                    onToggleArm={onToggleArm}
                    onClearAB={onClearAB}
                  />
                </div>
                {onSaveToPlaylist && onTogglePlaylist && onLoadPlaylistEntry && onMovePlaylistEntry && onRemovePlaylistEntry && onRenamePlaylistEntry && onClearPlaylist && (
                  <div className="border-t border-cinnabar-900/50 pt-4">
                    <ABLoopPlaylistControls
                      entries={playlistEntries}
                      playlistActive={playlistActive}
                      playlistIndex={playlistIndex}
                      canSave={canSaveToPlaylist}
                      onSave={onSaveToPlaylist}
                      onTogglePlaylist={onTogglePlaylist}
                      onLoadEntry={onLoadPlaylistEntry}
                      onMoveEntry={onMovePlaylistEntry}
                      onRemoveEntry={onRemovePlaylistEntry}
                      onRenameEntry={onRenamePlaylistEntry}
                      onClear={onClearPlaylist}
                    />
                  </div>
                )}
                <div className="border-t border-cinnabar-900/50 pt-4">
                  <p className={[toolbarSectionLabel, 'mb-2'].join(' ')}>Speed</p>
                  <SpeedControl speedPct={speedPct} speed={speed} onSpeedChange={onSpeedChange} />
                </div>
              </div>
            )}
          </section>

          <MoreMenu
            showAbExport={showAbExport}
            onExportAb={onExportAb}
            exporting={abExporting}
            exportError={abExportError}
            canIncludeSrt={abExportCanIncludeSrt}
            includeSrt={abExportIncludeSrt}
            onIncludeSrtChange={onAbExportIncludeSrtChange}
          />
        </>
      )}
    </aside>
  )
}
