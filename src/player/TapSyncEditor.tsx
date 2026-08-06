import { useState, useCallback, useRef } from 'react'
import type { TimedLine } from '../core/types'
import { ConfirmDialog } from '../core/ui/ConfirmDialog'
import { useModalDialog } from '../core/ui/useModalDialog'

interface Props {
  plainLines: string[]
  translations: string[]
  audioPosition: () => number
  onComplete: (lines: TimedLine[]) => void
  /** Leave the screen without saving. Tap-through covers the whole player, so
   * without this there is no way back short of reloading the app. */
  onCancel: () => void
  /** Playback controls so the user can start/pause/rewind without leaving the
   * screen — the instruction says "play the song", so the screen must be able to. */
  isPlaying: boolean
  onTogglePlay: () => void
  onSeek?: (time: number) => void
  /** Audio adjustments — this screen replaces the player UI entirely, so volume
   * and speed must be reachable here. Slowing playback makes taps easier to
   * land; recorded times stay in song-time, so timing is unaffected. */
  volume: number
  onVolumeChange: (volume: number) => void
  speed: number
  onSpeedChange: (speed: number) => void
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

const SPEED_PRESETS = [
  { label: 'Slower (60%)', speed: 0.6 },
  { label: 'Slow (75%)', speed: 0.75 },
]

export function TapSyncEditor({ plainLines, translations, audioPosition, onComplete, onCancel, isPlaying, onTogglePlay, onSeek, volume, onVolumeChange, speed, onSpeedChange }: Props) {
  const [tapped, setTapped] = useState<number[]>([])
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = tapped.length
  const done = current >= plainLines.length

  const handleTap = useCallback(() => {
    if (current >= plainLines.length) return
    setTapped((prev) => [...prev, audioPosition()])
  }, [current, plainLines.length, audioPosition])

  /** Leaving discards taps, so only ask when there is something to lose. */
  const requestCancel = useCallback(() => {
    if (tapped.length === 0) onCancel()
    else setConfirmingCancel(true)
  }, [tapped.length, onCancel])

  useModalDialog(rootRef, requestCancel)

  const handleFinish = () => {
    // Emit every line, not just the tapped ones: a partial pass is still worth
    // saving on a long song, and untapped lines stay at 0/0 (untimed) rather
    // than being given invented timestamps that would look aligned.
    const lines: TimedLine[] = plainLines.map((original, i) => {
      const startTime = tapped[i]
      if (startTime === undefined) {
        return { startTime: 0, endTime: 0, original, translation: translations[i] ?? '' }
      }
      return {
        startTime,
        endTime: tapped[i + 1] ?? startTime + 5,
        original,
        translation: translations[i] ?? '',
      }
    })
    onComplete(lines)
  }

  const handleUndo = () => {
    setTapped((prev) => {
      const next = prev.slice(0, -1)
      // Rewind a little so the user can re-hear the line they're re-timing.
      const back = next[next.length - 1]
      if (onSeek && back !== undefined) onSeek(Math.max(0, back - 1))
      return next
    })
  }

  const iconBtn =
    'min-w-11 min-h-11 flex items-center justify-center rounded-full border border-cinnabar-800 text-white/70 hover:text-white hover:border-cinnabar-accent/50 touch-manipulation transition-[color,border-color,transform] duration-150 ease-out active:scale-[0.96]'

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Tap-through timing"
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-cinnabar-950 flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {confirmingCancel && (
        <ConfirmDialog
          title="Leave tap-through?"
          message={tapped.length === 1
            ? 'Your 1 tapped line will be discarded. Save instead to keep it.'
            : `Your ${tapped.length} tapped lines will be discarded. Save instead to keep them.`}
          confirmLabel="Discard"
          cancelLabel="Keep tapping"
          onConfirm={onCancel}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}

      {/* The screen replaces the whole player, so it has to carry its own way
          back — the app header (and its ← Back) is not rendered underneath. */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-cinnabar-900">
        <button
          type="button"
          onClick={requestCancel}
          aria-label="Cancel tap-through"
          className="min-h-11 px-3 text-white/50 hover:text-white text-sm touch-manipulation transition-colors duration-150 ease-out"
        >
          ← Cancel
        </button>
        <span className="text-white/30 text-[11px] uppercase tracking-wide">Tap-through</span>
      </div>

      {/* Scrolls instead of centring: on a short viewport a centred column
          pushes the Tap button and the Save/Undo row off both ends. */}
      <div
        data-testid="tap-sync-scroll"
        className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-6 p-6"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 1.5rem), 1.5rem)' }}
      >
      <div className="text-white/40 text-sm tabular-nums">
        Line {Math.min(current + 1, plainLines.length)} of {plainLines.length}
      </div>

      <div className="text-center space-y-2 max-w-md">
        <div lang="ja" className="text-xl sm:text-2xl font-semibold text-white font-jp yomitan-text select-text text-balance">
          {plainLines[current] ?? '—'}
        </div>
        {translations[current] && (
          <div className="text-white/60 italic text-pretty">{translations[current]}</div>
        )}
      </div>

      {tapped.length > 0 && (
        <div className="text-white/30 text-xs text-center max-w-xs tabular-nums space-y-0.5">
          {/* Offset by however many are actually shown — slice(-3) yields fewer
              than 3 early on, and a fixed -3 produced negative indices (a blank
              label) for the first two taps. */}
          {tapped.slice(-3).map((t, i) => (
            <div key={i} className="truncate">{plainLines[tapped.length - Math.min(3, tapped.length) + i]} · {fmt(t)}</div>
          ))}
        </div>
      )}

      {/* Transport — the screen can now drive playback itself. */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onSeek?.(Math.max(0, audioPosition() - 3))} disabled={!onSeek} aria-label="Back 3 seconds" className={`${iconBtn} disabled:opacity-30`}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 4 12l7 7"/><path d="M20 5l-7 7 7 7"/></svg>
        </button>
        <button type="button" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className={`${iconBtn} w-12 h-12`}>
          {isPlaying ? (
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
          ) : (
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          )}
        </button>
        <span className="text-white/40 text-xs tabular-nums min-w-12 text-center">{fmt(audioPosition())}</span>
      </div>

      {/* Audio adjustments — volume and slowed playback for easier tapping. */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 w-56">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 shrink-0">
            <path d="M11 5 6 9H3v6h3l5 4z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          </svg>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
            aria-label="Volume"
            className="flex-1 accent-cinnabar-accent h-1"
          />
          <span className="text-white/40 text-xs w-9 text-right tabular-nums shrink-0">{Math.round(volume * 100)}%</span>
        </div>
        <div className="flex items-center gap-2">
          {SPEED_PRESETS.map((p) => {
            const active = speed === p.speed
            return (
              <button
                key={p.speed}
                type="button"
                onClick={() => onSpeedChange(active ? 1 : p.speed)}
                aria-pressed={active}
                className={`min-h-9 px-3 rounded-full text-xs touch-manipulation transition-colors ${active ? 'bg-cinnabar-accent text-white' : 'border border-cinnabar-800 text-white/50 hover:text-white'}`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      <p className="text-white/50 text-sm text-center text-pretty max-w-xs">
        {isPlaying ? 'Tap the moment each line starts.' : 'Press play, then tap the moment each line starts.'}
      </p>

      <button
        onClick={handleTap}
        disabled={done}
        aria-label="Mark line start"
        className="w-32 h-32 rounded-full bg-cinnabar-accent text-white font-semibold text-lg shadow-lg active:scale-95 transition-transform disabled:opacity-30"
        style={{ boxShadow: '0 0 30px rgba(248,113,113,0.4)' }}
      >
        {done ? 'Done' : 'Tap'}
      </button>

      <div className="flex gap-4">
        <button onClick={handleUndo} disabled={tapped.length === 0}
          className="min-h-11 px-4 py-2 text-white/50 hover:text-white text-sm disabled:opacity-30 touch-manipulation transition-colors">
          ← Undo
        </button>
        {/* Available from the first tap: a half-timed long song beats none. The
            label names the count so a partial pass isn't mistaken for a full one. */}
        {tapped.length > 0 && (
          <button onClick={handleFinish}
            className="min-h-11 px-6 py-2 bg-cinnabar-accent text-white rounded-full text-sm font-medium touch-manipulation active:scale-[0.97] transition-transform">
            {done ? 'Save timing' : `Save timing for ${tapped.length} of ${plainLines.length}`}
          </button>
        )}
      </div>
      </div>
    </div>
  )
}
