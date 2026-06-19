import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { PlaybackState, ABLoop } from '../core/types'
import { isABLoopActive } from './abLoopUtils'
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
  showRealign?: boolean
  onRealign?: () => void
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function SeekBar({ progress, duration, onSeek }: { progress: number; duration: number; onSeek: (t: number) => void }) {
  return (
    <div
      className="h-2 bg-cinnabar-900 rounded-full cursor-pointer touch-manipulation"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onSeek(((e.clientX - rect.left) / rect.width) * duration)
      }}
    >
      <div
        className="h-full bg-cinnabar-accent rounded-full transition-[width] duration-150 ease-out"
        style={{ width: `${progress * 100}%` }}
      />
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
  showRealign,
  onRealign,
}: {
  showAbExport?: boolean
  onExportAb?: () => void
  exporting?: boolean
  exportError?: string | null
  canIncludeSrt?: boolean
  includeSrt?: boolean
  onIncludeSrtChange?: (value: boolean) => void
  showRealign?: boolean
  onRealign?: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const hasItems = showAbExport || showRealign

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
          {showRealign && onRealign && (
            <section aria-label="Lyrics alignment">
              <p className={[toolbarSectionLabel, 'mb-2'].join(' ')}>Lyrics</p>
              <button
                type="button"
                onClick={() => { onRealign(); setOpen(false) }}
                className={[toolbarChipBtn, toolbarChipBtnIdle, 'w-full text-left px-3 py-2 text-sm'].join(' ')}
              >
                Re-align lyrics
              </button>
            </section>
          )}
          {showAbExport && onExportAb && (
            <section aria-label="Export loop" className={showRealign ? 'border-t border-cinnabar-800/80 pt-3' : ''}>
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
  showRealign,
  onRealign,
}: Props) {
  const abActive = abLoop.a !== null || abLoop.b !== null || armingAB !== null
  const abLooping = isABLoopActive(abLoop)
  const [practiceOpen, setPracticeOpen] = useState(abActive)

  useEffect(() => {
    if (abActive) setPracticeOpen(true)
  }, [abActive])

  const practiceStatus = abLooping
    ? 'Looping'
    : abActive
      ? 'A-B on'
      : `Speed ${speedPct}%`

  return (
    <aside
      className="shrink-0 border-t md:border-t-0 md:border-l border-cinnabar-900 bg-cinnabar-950/98 md:bg-cinnabar-950 backdrop-blur-sm md:backdrop-blur-none px-4 pt-3 md:pt-4 md:px-5 md:w-64 lg:w-72 flex flex-col gap-3 max-h-[min(46dvh,22rem)] md:max-h-none overflow-y-auto"
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
              className="w-full flex items-center justify-between px-3 py-2.5 text-left touch-manipulation"
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
                <div className="border-t border-cinnabar-900/50 pt-4">
                  <p className={[toolbarSectionLabel, 'mb-2'].join(' ')}>
                    Speed <span className="normal-case tracking-normal text-white/25">· {speedPct}%</span>
                  </p>
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
            showRealign={showRealign}
            onRealign={onRealign}
          />
        </>
      )}
    </aside>
  )
}
