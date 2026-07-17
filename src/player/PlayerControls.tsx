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
  { label: 'Slower', speed: 0.6 },
  { label: 'Slow', speed: 0.75 },
  { label: 'Fast', speed: 1.25 },
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
  /** Rendered above transport (e.g. YouTube embed on Firefox). */
  headerSlot?: ReactNode
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Inline monochrome transport glyphs. The previous ⏮ ▶ ⏸ ⏭ 🔊 ⏩ characters
// render as full-colour emoji on iOS, clashing with the monochrome dock.
// All are decorative (aria-hidden); the wrapping buttons carry the labels.

function SkipBackIcon({ className = 'w-[1.1em] h-[1.1em]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M6 5h2.2v14H6z" />
      <path d="M20 5v14L9.2 12z" />
    </svg>
  )
}

function SkipForwardIcon({ className = 'w-[1.1em] h-[1.1em]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M15.8 5H18v14h-2.2z" />
      <path d="M4 5v14l10.8-7z" />
    </svg>
  )
}

function PlayIcon({ className = 'w-[1em] h-[1em]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 5.2v13.6L18.6 12z" />
    </svg>
  )
}

function PauseIcon({ className = 'w-[1em] h-[1em]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M7 5h3.4v14H7z" />
      <path d="M13.6 5H17v14h-3.4z" />
    </svg>
  )
}

function FastForwardIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M3.5 6.5v11l7.8-5.5z" />
      <path d="M12.2 6.5v11l7.8-5.5z" />
    </svg>
  )
}

function VolumeIcon({ level, className = 'w-4 h-4' }: { level: 'mute' | 'low' | 'high'; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="currentColor" d="M3 9.2v5.6h3.8L12 19.4V4.6L6.8 9.2z" />
      {level === 'mute' ? (
        <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" d="M15.2 9.6l4.8 4.8m0-4.8l-4.8 4.8" />
      ) : (
        <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" d="M15.4 8.6a5 5 0 0 1 0 6.8" />
      )}
      {level === 'high' && (
        <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" d="M18.2 6.2a9 9 0 0 1 0 11.6" />
      )}
    </svg>
  )
}

function SeekBar({ progress, duration, onSeek }: { progress: number; duration: number; onSeek: (t: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const position = progress * duration

  const seekFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    onSeek(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration)
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={formatTime(position)}
      tabIndex={0}
      className="group py-4 -my-2 touch-manipulation cursor-pointer"
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
        seekFromClientX(e.clientX)
      }}
      onPointerMove={(e) => { if (dragging.current) seekFromClientX(e.clientX) }}
      onPointerUp={() => { dragging.current = false }}
      onPointerCancel={() => { dragging.current = false }}
      onKeyDown={(e) => {
        // role="slider" + tabIndex must be keyboard-operable, not just announced.
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault()
          onSeek(Math.max(0, position - 5))
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault()
          onSeek(Math.min(duration, position + 5))
        }
      }}
    >
      <div className="relative h-2.5 md:h-2 bg-cinnabar-900 rounded-full">
        <div
          className="h-full bg-cinnabar-accent rounded-full transition-[width] duration-100 ease-out"
          style={{ width: `${progress * 100}%` }}
        />
        <div
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150 ease-out pointer-events-none"
          style={{ left: `calc(${progress * 100}% - 6px)` }}
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
        <SkipBackIcon />
      </button>
      <button
        type="button"
        onClick={onTogglePlay}
        className={`${playClass} rounded-full bg-cinnabar-accent text-white flex items-center justify-center touch-manipulation transition-[transform,box-shadow] duration-150 ease-out active:scale-[0.96]`}
        style={{ boxShadow: '0 0 18px rgba(248,113,113,0.35)' }}
        aria-label={playbackState === 'playing' ? 'Pause playback' : 'Start playback'}
      >
        <span className={playbackState === 'playing' ? '' : 'pl-0.5'} aria-hidden>
          {playbackState === 'playing' ? <PauseIcon /> : <PlayIcon />}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onSeek(Math.min(duration, position + 5))}
        className={`${skipClass} flex items-center justify-center text-white/45 hover:text-white touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]`}
        aria-label="Forward 5 seconds"
      >
        <SkipForwardIcon />
      </button>
    </div>
  )
}

function CompactVolume({ volumePct, onVolumeChange }: { volumePct: number; onVolumeChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/35 w-4 shrink-0 flex items-center justify-center" aria-hidden>
        <VolumeIcon level={volumePct === 0 ? 'mute' : volumePct < 50 ? 'low' : 'high'} />
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
  showIdleHints = true,
}: {
  abLoop: ABLoop
  armingAB: 'a' | 'b' | null
  abLoopError: string | null
  onToggleArm: (which: 'a' | 'b') => void
  onClearAB: () => void
  compact?: boolean
  showIdleHints?: boolean
}) {
  const chip = compact ? practiceChipBtn : toolbarChipBtn
  const hintClass = [
    'text-pretty leading-snug',
    compact ? 'text-[10px]' : 'text-[11px]',
  ].join(' ')

  const btn = (which: 'a' | 'b', value: number | null) => {
    const armed = armingAB === which
    const set = value !== null
    return (
      <button
        type="button"
        onClick={() => onToggleArm(which)}
        aria-label={`${which.toUpperCase()} loop point${value !== null ? ` ${formatTime(value)}` : ''}`}
        aria-pressed={armed}
        className={[
          chip,
          'inline-flex items-center justify-center flex-1 min-w-0',
          armed ? toolbarChipBtnArmed : set ? toolbarChipBtnActive : toolbarChipBtnIdle,
        ].join(' ')}
      >
        {set ? (
          <>
            <span className="text-white/45 mr-1">{which.toUpperCase()}</span>
            {formatTime(value)}
          </>
        ) : (
          <>Set {which.toUpperCase()}</>
        )}
      </button>
    )
  }

  const hasAny = abLoop.a !== null || abLoop.b !== null
  const onlyA = abLoop.a !== null && abLoop.b === null
  const onlyB = abLoop.b !== null && abLoop.a === null

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className="flex items-center gap-1">
        {btn('a', abLoop.a)}
        <span
          className={[
            'shrink-0 text-[10px] tabular-nums transition-colors duration-150',
            abLoop.a !== null && abLoop.b !== null ? 'text-cinnabar-accent/70' : 'text-white/20',
          ].join(' ')}
          aria-hidden
        >
          →
        </span>
        {btn('b', abLoop.b)}
      </div>
      <div className={['flex flex-wrap items-center', compact ? 'gap-1' : 'gap-1.5'].join(' ')}>
        {hasAny && (
          <button
            type="button"
            onClick={onClearAB}
            className={[chip, toolbarChipBtnIdle, 'text-white/40'].join(' ')}
          >
            Clear loop
          </button>
        )}
      </div>
      {armingAB && (
        <p className={[hintClass, 'text-cinnabar-accent/90 animate-pulse'].join(' ')} role="status">
          Now tap a lyric line to place point {armingAB.toUpperCase()}
          {armingAB === 'b' && ' — same line loops to its end'}
        </p>
      )}
      {!armingAB && !abLoopError && !hasAny && showIdleHints && (
        <p className={[hintClass, 'text-white/35'].join(' ')}>
          Tap Set A or Set B, then tap a lyric line to mark the loop.
        </p>
      )}
      {!armingAB && !abLoopError && onlyA && showIdleHints && (
        <p className={[hintClass, 'text-white/35'].join(' ')}>
          Point A is set. Tap Set B, then tap the ending lyric line.
        </p>
      )}
      {!armingAB && !abLoopError && onlyB && showIdleHints && (
        <p className={[hintClass, 'text-white/35'].join(' ')}>
          Point B is set. Tap Set A, then tap the starting lyric line.
        </p>
      )}
      {abLoopError && (
        <p className={[hintClass, 'text-red-400/90'].join(' ')} role="alert">{abLoopError}</p>
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
  canSave,
  onSave,
  expanded: controlledExpanded,
  onExpandedChange,
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
  canSave?: boolean
  onSave?: () => void
  /** Controlled expansion (bottom-sheet drawer drives this so the section
   * lands open); omit for the self-managing accordion (desktop column). */
  expanded?: boolean
  onExpandedChange?: (value: boolean) => void
}) {
  const isDesktop = useMinWidthMd()
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(abActive)
  const expanded = controlledExpanded ?? uncontrolledExpanded
  const setExpanded = (value: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(expanded) : value
    if (onExpandedChange) onExpandedChange(next)
    else setUncontrolledExpanded(next)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: auto-expand when a loop activates
    if (abActive) setExpanded(true)
  }, [abActive])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: collapse when another panel takes focus
    if (forceCollapsed && !armingAB) setExpanded(false)
  }, [forceCollapsed, armingAB])

  const shellClass = [
    'rounded-xl border shrink-0',
    abLooping ? 'border-cinnabar-accent/40 bg-cinnabar-accent/[0.06]' : 'border-cinnabar-900/80 bg-cinnabar-900/30',
  ].join(' ')

  if (isDesktop) {
    const aLabel = abLoop.a !== null ? formatTime(abLoop.a) : null
    const bLabel = abLoop.b !== null ? formatTime(abLoop.b) : null
    const collapsedSummary = aLabel && bLabel
      ? `${aLabel} → ${bLabel}`
      : aLabel
        ? `From ${aLabel}`
        : bLabel
          ? `Until ${bLabel}`
          : 'Tap to set'

    return (
      <section className={[shellClass, 'p-2'].join(' ')} aria-label="A-B Loop">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex-1 flex items-center justify-between gap-2 min-h-9 touch-manipulation"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-white/35 shrink-0">Loop</span>
              {!expanded && (
                <span className={[
                  'text-[11px] truncate tabular-nums',
                  abActive ? 'text-white/60' : 'text-white/35',
                ].join(' ')}>
                  {collapsedSummary}
                </span>
              )}
              {abLooping && !playlistActive && (
                <span className="text-[10px] text-cinnabar-accent font-medium shrink-0">Looping</span>
              )}
            </span>
            <span className="text-[10px] text-white/35 shrink-0" aria-hidden>{expanded ? '▴' : '▾'}</span>
          </button>
          {canSave && onSave && (
            <button
              type="button"
              onClick={onSave}
              className={[practiceChipBtn, toolbarChipBtnActive, 'shrink-0 mr-0.5 py-0.5 text-[10px]'].join(' ')}
              aria-label="Save current loop"
            >
              Save
            </button>
          )}
        </div>
        {expanded && (
          <div className="pt-1.5 border-t border-cinnabar-900/60 mt-1.5">
            <ABLoopControls
              abLoop={abLoop}
              armingAB={armingAB}
              abLoopError={abLoopError}
              onToggleArm={onToggleArm}
              onClearAB={onClearAB}
              compact
              showIdleHints
            />
          </div>
        )}
      </section>
    )
  }

  const aLabel = abLoop.a !== null ? formatTime(abLoop.a) : null
  const bLabel = abLoop.b !== null ? formatTime(abLoop.b) : null
  const collapsedSummary = aLabel && bLabel
    ? `${aLabel} → ${bLabel}`
    : aLabel
      ? `From ${aLabel}`
      : bLabel
        ? `Until ${bLabel}`
        : 'Tap to set'

  return (
    <section className={[shellClass, 'p-2'].join(' ')} aria-label="A-B Loop">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex-1 flex items-center justify-between gap-2 min-h-9 touch-manipulation"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-white/35 shrink-0">Loop</span>
            {!expanded && (
              <span className={[
                'text-[11px] truncate tabular-nums',
                abActive ? 'text-white/60' : 'text-white/35',
              ].join(' ')}>
                {collapsedSummary}
              </span>
            )}
            {abLooping && (
              <span className="text-[10px] text-cinnabar-accent font-medium shrink-0">Looping</span>
            )}
          </span>
          <span className="text-[10px] text-white/35 shrink-0" aria-hidden>{expanded ? '▴' : '▾'}</span>
        </button>
        {canSave && onSave && (
          <button
            type="button"
            onClick={onSave}
            className={[practiceChipBtn, toolbarChipBtnActive, 'shrink-0 mr-0.5 py-0.5 text-[10px]'].join(' ')}
            aria-label="Save current loop"
          >
            Save
          </button>
        )}
      </div>
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

// Mobile control-dock chips (Loop / Speed / Saved) — 44px touch target, same
// visual family as practiceChipBtn but taller so the thumb has room on a phone.
const mobileControlChipBtn =
  'min-h-11 px-2.5 py-1 rounded-lg border text-[11px] font-medium touch-manipulation transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.96] tabular-nums'


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
          <span className="sr-only">{playlistIndex + 1} of {entries.length}</span>
          {entries.length <= 6 ? (
            <div className="flex items-center justify-center gap-0.5 mt-0.5" aria-hidden>
              {entries.map((_, i) => (
                <span
                  key={i}
                  className={[
                    'rounded-full transition-[width,background-color] duration-200 ease-out',
                    i === playlistIndex
                      ? 'w-2.5 h-1.5 bg-cinnabar-accent'
                      : 'w-1.5 h-1.5 bg-white/20',
                  ].join(' ')}
                />
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-white/40 tabular-nums mt-0.5" aria-hidden>
              {playlistIndex + 1} / {entries.length}
            </p>
          )}
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
  compactMobile = false,
}: {
  entries: ABLoopPlaylistEntry[]
  playlistActive: boolean
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
  compactMobile?: boolean
}) {
  const [menuId, setMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

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
  const showManagementList = hasEntries && !playlistActive

  return (
    <div className={compactMobile ? 'space-y-1' : 'space-y-1.5'}>
      {!compactMobile && <p className={toolbarSectionLabel}>Saved loops</p>}

      {hasEntries && !playlistActive && (
        <button
          type="button"
          onClick={onTogglePlaylist}
          className={[practiceChipBtn, toolbarChipBtnIdle].join(' ')}
          aria-label="Play all saved loops"
        >
          Play all
        </button>
      )}

      {!hasEntries && !compactMobile && (
        <p className="text-[10px] text-white/30 text-pretty">
          Set A and B, then tap Save to add loops here.
        </p>
      )}

      {showManagementList && (
        <>
          <div className={['overflow-y-auto', compactMobile ? 'max-h-32' : 'max-h-44'].join(' ')}>
            <ul className="space-y-1">
              {entries.map((entry, index) => {
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
          </div>

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
  compact = false,
}: {
  speedPct: number
  speed: number
  onSpeedChange: (speed: number) => void
  compact?: boolean
}) {
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const chip = compact ? practiceChipBtn : toolbarChipBtn

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

  const presetLabel = (presetSpeed: number) =>
    `${Math.round(presetSpeed * 100)}%`

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className="flex items-center gap-2">
        <span className="text-white/35 shrink-0 w-4 flex items-center justify-center" aria-hidden>
          <FastForwardIcon />
        </span>
        <input
          type="range"
          min={50}
          max={200}
          step={5}
          value={speed * 100}
          onChange={(e) => onSpeedChange(Number(e.target.value) / 100)}
          onDoubleClick={() => onSpeedChange(NORMAL_SPEED)}
          onPointerUp={handleSliderPointerUp}
          className="flex-1 accent-cinnabar-accent touch-manipulation h-1.5"
          aria-label="Playback speed"
          aria-valuetext={`${speedPct} percent`}
        />
        <button
          type="button"
          onClick={() => onSpeedChange(NORMAL_SPEED)}
          disabled={speed === NORMAL_SPEED}
          className={[
            chip,
            speed === NORMAL_SPEED ? 'border-cinnabar-accent/40 text-cinnabar-accent bg-cinnabar-accent/10' : toolbarChipBtnIdle,
            'shrink-0 min-w-[2.75rem] px-2 py-0.5 font-medium',
          ].join(' ')}
          aria-label="Normal speed, 100 percent"
          aria-pressed={speed === NORMAL_SPEED}
        >
          1×
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {LEARNER_SPEED_PRESETS.map(({ label, speed: presetSpeed }) => (
          <button
            key={presetSpeed}
            type="button"
            onClick={() => onSpeedChange(presetSpeed)}
            className={[
              chip,
              speed === presetSpeed ? toolbarChipBtnActive : toolbarChipBtnIdle,
              'flex-1 min-w-[4.5rem]',
            ].join(' ')}
            aria-label={`${label}, ${Math.round(presetSpeed * 100)} percent speed`}
            aria-pressed={speed === presetSpeed}
          >
            <span className="block font-medium">{presetLabel(presetSpeed)}</span>
            <span className="block text-[9px] text-white/35 leading-tight">{label}</span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-white/30 text-pretty sr-only">
        Double-tap the slider to jump back to 1×.
      </p>
    </div>
  )
}

function CollapsibleSpeedSection({
  speedPct,
  speed,
  onSpeedChange,
  forceCollapsed,
  expanded: controlledExpanded,
  onExpandedChange,
}: {
  speedPct: number
  speed: number
  onSpeedChange: (speed: number) => void
  forceCollapsed?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}) {
  const isDesktop = useMinWidthMd()
  const isActive = speed !== NORMAL_SPEED
  const [internalExpanded, setInternalExpanded] = useState(isActive)
  const expanded = controlledExpanded ?? internalExpanded

  const setExpanded = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(expanded) : next
    onExpandedChange?.(value)
    if (controlledExpanded === undefined) setInternalExpanded(value)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: auto-expand when this control becomes active
    if (isActive) setExpanded(true)
  }, [isActive])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: collapse when another panel takes focus
    if (forceCollapsed && !isActive) setExpanded(false)
  }, [forceCollapsed, isActive])

  const shellClass = [
    'rounded-xl border shrink-0',
    isActive
      ? 'border-cinnabar-accent/40 bg-cinnabar-accent/[0.06]'
      : 'border-cinnabar-900/80 bg-cinnabar-900/30',
  ].join(' ')

  const summary = speedPct === 100 ? 'Normal (1×)' : `${speedPct}%`

  return (
    <section className={[shellClass, 'p-2'].join(' ')} aria-label="Playback speed">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-2 min-h-9 touch-manipulation"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-white/35 shrink-0">Speed</span>
          {!expanded && (
            <span className={[
              'text-[11px] tabular-nums truncate',
              isActive ? 'text-cinnabar-accent font-medium' : 'text-white/50',
            ].join(' ')}>
              {summary}
            </span>
          )}
        </span>
        <span className="text-[10px] text-white/35 shrink-0" aria-hidden>{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className="pt-1.5 border-t border-cinnabar-900/60 mt-1.5">
          <SpeedControl
            speedPct={speedPct}
            speed={speed}
            onSpeedChange={onSpeedChange}
            compact={!isDesktop}
          />
        </div>
      )}
    </section>
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number; width: number } | null>(null)
  const hasItems = showAbExport

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: Event) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const margin = 8
    const estHeight = 180
    const spaceAbove = rect.top - margin
    const openUp = spaceAbove >= estHeight || spaceAbove >= rect.bottom - margin
    setMenuPos({
      left: rect.left,
      width: rect.width,
      bottom: openUp
        ? window.innerHeight - rect.top + 4
        : window.innerHeight - rect.bottom - 4 - estHeight,
    })
  }, [open])

  if (!hasItems) return null

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
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
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          role="dialog"
          aria-label="More playback options"
          style={{
            left: menuPos.left,
            width: menuPos.width,
            bottom: menuPos.bottom,
          }}
          className="fixed z-[60] rounded-xl border border-cinnabar-800 bg-cinnabar-900 shadow-xl shadow-black/40 p-2.5 space-y-2"
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
        </div>,
        document.body,
      )}
    </div>
  )
}

const SAVED_LOOPS_PANEL_ID = 'saved-loops-panel-content'

function savedLoopsPanelHint(
  open: boolean,
  playlistActive: boolean,
  playlistIndex: number,
  playlistLength: number,
  entryCount: number,
): string {
  if (open) return 'Close'
  if (playlistActive && playlistLength > 0) {
    return `${playlistIndex + 1}/${playlistLength}`
  }
  if (entryCount > 0) return `${entryCount} saved`
  return 'Open'
}

/** Collapsible saved-loops list — expands inline so lyrics stay visible on mobile. */
function SavedLoopsPanelSection({
  open,
  onToggle,
  playlistActive,
  playlistIndex,
  playlistLength,
  entryCount,
  children,
}: {
  open: boolean
  onToggle: () => void
  playlistActive: boolean
  playlistIndex: number
  playlistLength: number
  entryCount: number
  children: ReactNode
}) {
  const hint = savedLoopsPanelHint(open, playlistActive, playlistIndex, playlistLength, entryCount)
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
      aria-label="Saved loops"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={SAVED_LOOPS_PANEL_ID}
        aria-label={open ? 'Close saved loops' : 'Open saved loops'}
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
            Saved loops
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
        <div id={SAVED_LOOPS_PANEL_ID} className="border-t border-cinnabar-accent/20">
          <div className="px-2.5 pb-2 pt-1.5 md:px-3 md:pb-3 md:pt-2">
            {children}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Mobile-only bottom sheet for the practice controls. Portaled to `document.body`
 * so its fixed positioning is viewport-relative — the dock's `backdrop-blur`
 * would otherwise make it the containing block and clip the sheet to the bar.
 */
function MobileControlsSheet({
  title = 'Controls',
  onClose,
  children,
}: {
  title?: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] transition-opacity duration-150 ease-out"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-cinnabar-900 bg-cinnabar-950 shadow-2xl shadow-black/50 max-h-[75dvh] overflow-y-auto overscroll-contain"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 12px), 12px)' }}
      >
        <button
          type="button"
          aria-label="Dismiss controls"
          onClick={onClose}
          className="w-full min-h-11 flex items-center justify-center touch-manipulation transition-transform duration-150 ease-out active:scale-[0.98]"
        >
          <span aria-hidden className="block h-1 w-10 rounded-full bg-white/20" />
        </button>
        <div className="flex items-center justify-between gap-2 px-4 pb-2">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-white/55">{title}</h2>
          <button
            type="button"
            aria-label="Close controls"
            onClick={onClose}
            className="min-h-11 min-w-11 -mr-2 flex items-center justify-center text-white/45 hover:text-white touch-manipulation transition-[color,transform] duration-150 ease-out active:scale-[0.94]"
          >
            <span aria-hidden className="text-lg leading-none">✕</span>
          </button>
        </div>
        <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>
      </div>
    </>,
    document.body,
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
  headerSlot,
}: Props) {
  const abActive = abLoop.a !== null || abLoop.b !== null || armingAB !== null
  const abLooping = isABLoopActive(abLoop)
  const isDesktop = useMinWidthMd()
  const [savedLoopsOpen, setSavedLoopsOpen] = useState(false)
  const [speedOpen, setSpeedOpen] = useState(false)
  // Mobile bottom-sheet state. The sheet owns its own expansion flags so the
  // Speed + Saved sections open by default inside it, independent of the
  // desktop accordion wiring above.
  const [controlsOpen, setControlsOpen] = useState(false)
  const [sheetLoopOpen, setSheetLoopOpen] = useState(true)
  const [sheetSpeedOpen, setSheetSpeedOpen] = useState(true)
  const [sheetSavedOpen, setSheetSavedOpen] = useState(true)
  const dockRef = useRef<HTMLElement>(null)

  // Publish the dock's real height so fixed overlays (the word-lookup card)
  // can sit just above it instead of floating mid-dock at a guessed offset.
  // Mobile only: on md+ the dock is a full-height side column and overlays
  // anchor to the tapped word instead, so the fallback value applies.
  useEffect(() => {
    const el = dockRef.current
    const root = document.documentElement
    if (!el || isDesktop) {
      root.style.removeProperty('--player-dock-height')
      return
    }
    const update = () => {
      const height = el.offsetHeight
      if (height > 0) root.style.setProperty('--player-dock-height', `${height}px`)
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      return () => root.style.removeProperty('--player-dock-height')
    }
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--player-dock-height')
    }
  }, [isDesktop])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reveal saved loops when a loop activates
    if (abActive && isDesktop) setSavedLoopsOpen(true)
  }, [abActive, isDesktop])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reveal saved loops when a playlist activates
    if (playlistActive && isDesktop) setSavedLoopsOpen(true)
  }, [playlistActive, isDesktop])

  const toggleSavedLoops = () => {
    setSavedLoopsOpen((open) => {
      const next = !open
      if (next && !isDesktop) setSpeedOpen(false)
      return next
    })
  }

  const handleSpeedExpandedChange = (next: boolean) => {
    setSpeedOpen(next)
    if (next && !isDesktop) setSavedLoopsOpen(false)
  }

  const openControls = () => {
    // Re-open all sections each time the sheet is summoned so it always lands
    // fully expanded regardless of how it was left last time.
    setSheetLoopOpen(true)
    setSheetSpeedOpen(true)
    setSheetSavedOpen(true)
    setControlsOpen(true)
  }
  const closeControls = () => setControlsOpen(false)

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

  // Active-playlist mini player + Stop button. Stays inline on both layouts —
  // never hidden behind the mobile sheet — so an active playlist is always visible.
  const playlistBlock = playlistActive && hasPlaylistEntries && playlistHandlersReady ? (
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
  ) : null

  // Saved-loops list body, reused verbatim by the desktop stack and the sheet.
  const savedLoopsChildren = onTogglePlaylist && onLoadPlaylistEntry && onMovePlaylistEntry && onRemovePlaylistEntry && onRenamePlaylistEntry && onClearPlaylist ? (
    <ABLoopPlaylistControls
      entries={playlistEntries}
      playlistActive={playlistActive}
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
      compactMobile={!isDesktop}
    />
  ) : null

  const moreMenu = (
    <MoreMenu
      showAbExport={showAbExport}
      onExportAb={onExportAb}
      exporting={abExporting}
      exportError={abExportError}
      canIncludeSrt={abExportCanIncludeSrt}
      includeSrt={abExportIncludeSrt}
      onIncludeSrtChange={onAbExportIncludeSrtChange}
    />
  )

  return (
    <aside
      ref={dockRef}
      className={[
        'shrink-0 min-h-0 flex flex-col',
        'border-t md:border-t-0 md:border-l border-cinnabar-900',
        'bg-cinnabar-950/95 md:bg-cinnabar-950 backdrop-blur-sm md:backdrop-blur-none',
        'px-3 pt-2 md:pt-4 md:px-5 md:w-72 lg:w-80',
        'md:overflow-y-auto md:overscroll-contain',
      ].join(' ')}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 8px), 8px)' }}
      onClick={(e) => e.stopPropagation()}
      aria-label="Playback controls"
    >
      {headerSlot}
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
        {isDesktop && (
          <CompactVolume volumePct={volumePct} onVolumeChange={onVolumeChange} />
        )}
      </section>

      {mode === 'play' && (isDesktop ? (
        <div
          className={[
            'flex flex-col gap-1.5 md:gap-2 min-h-0',
            'max-md:max-h-[min(46dvh,21rem)] max-md:overflow-y-auto max-md:overscroll-contain',
            'mt-1.5 md:mt-2.5',
          ].join(' ')}
        >
          <CollapsibleABLoopSection
            abLoop={abLoop}
            armingAB={armingAB}
            abLoopError={abLoopError}
            abLooping={abLooping}
            playlistActive={playlistActive}
            abActive={abActive}
            onToggleArm={onToggleArm}
            onClearAB={onClearAB}
            forceCollapsed={savedLoopsOpen && !isDesktop}
            canSave={canSaveToPlaylist}
            onSave={onSaveToPlaylist}
          />

          {playlistBlock}

          <CollapsibleSpeedSection
            speedPct={speedPct}
            speed={speed}
            onSpeedChange={onSpeedChange}
            forceCollapsed={savedLoopsOpen && !isDesktop}
            expanded={speedOpen}
            onExpandedChange={handleSpeedExpandedChange}
          />

          <SavedLoopsPanelSection
            open={savedLoopsOpen}
            onToggle={toggleSavedLoops}
            playlistActive={playlistActive}
            playlistIndex={playlistIndex}
            playlistLength={playlistEntries.length}
            entryCount={playlistEntries.length}
          >
            {savedLoopsChildren}
          </SavedLoopsPanelSection>

          {moreMenu}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5 min-h-0 mt-1.5">
            {playlistBlock}
            <div role="group" aria-label="Playback shortcuts" className="flex items-stretch gap-1.5">
              <button
                type="button"
                onClick={openControls}
                aria-label="Loop"
                aria-haspopup="dialog"
                className={[
                  mobileControlChipBtn,
                  abActive ? toolbarChipBtnActive : toolbarChipBtnIdle,
                  'flex-1 inline-flex items-center justify-center gap-1.5',
                ].join(' ')}
              >
                Loop
                {abActive && (
                  <span
                    data-testid="loop-active-dot"
                    aria-hidden
                    className="w-1.5 h-1.5 rounded-full bg-cinnabar-accent"
                  />
                )}
              </button>
              <button
                type="button"
                onClick={openControls}
                aria-label={`Speed ${speedPct} percent`}
                aria-haspopup="dialog"
                className={[
                  mobileControlChipBtn,
                  speed !== NORMAL_SPEED ? toolbarChipBtnActive : toolbarChipBtnIdle,
                  'flex-1 inline-flex items-center justify-center',
                ].join(' ')}
              >
                Speed · {speedPct}%
              </button>
              <button
                type="button"
                onClick={openControls}
                aria-label="Saved loops"
                aria-haspopup="dialog"
                className={[
                  mobileControlChipBtn,
                  playlistActive ? toolbarChipBtnActive : toolbarChipBtnIdle,
                  'flex-1 inline-flex items-center justify-center',
                ].join(' ')}
              >
                Saved
              </button>
            </div>
          </div>

          {controlsOpen && (
            <MobileControlsSheet onClose={closeControls}>
              <CompactVolume volumePct={volumePct} onVolumeChange={onVolumeChange} />
              <CollapsibleABLoopSection
                abLoop={abLoop}
                armingAB={armingAB}
                abLoopError={abLoopError}
                abLooping={abLooping}
                playlistActive={playlistActive}
                abActive={abActive}
                onToggleArm={onToggleArm}
                onClearAB={onClearAB}
                forceCollapsed={false}
                expanded={sheetLoopOpen}
                onExpandedChange={setSheetLoopOpen}
                canSave={canSaveToPlaylist}
                onSave={onSaveToPlaylist}
              />
              <CollapsibleSpeedSection
                speedPct={speedPct}
                speed={speed}
                onSpeedChange={onSpeedChange}
                forceCollapsed={false}
                expanded={sheetSpeedOpen}
                onExpandedChange={setSheetSpeedOpen}
              />
              <SavedLoopsPanelSection
                open={sheetSavedOpen}
                onToggle={() => setSheetSavedOpen((v) => !v)}
                playlistActive={playlistActive}
                playlistIndex={playlistIndex}
                playlistLength={playlistEntries.length}
                entryCount={playlistEntries.length}
              >
                {savedLoopsChildren}
              </SavedLoopsPanelSection>
              {moreMenu}
            </MobileControlsSheet>
          )}
        </>
      ))}
    </aside>
  )
}
