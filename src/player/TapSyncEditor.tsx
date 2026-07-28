import { useState, useCallback } from 'react'
import type { TimedLine } from '../core/types'

interface Props {
  plainLines: string[]
  translations: string[]
  audioPosition: () => number
  onComplete: (lines: TimedLine[]) => void
  /** Playback controls so the user can start/pause/rewind without leaving the
   * screen — the instruction says "play the song", so the screen must be able to. */
  isPlaying: boolean
  onTogglePlay: () => void
  onSeek?: (time: number) => void
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

export function TapSyncEditor({ plainLines, translations, audioPosition, onComplete, isPlaying, onTogglePlay, onSeek }: Props) {
  const [tapped, setTapped] = useState<number[]>([])
  const current = tapped.length
  const done = current >= plainLines.length

  const handleTap = useCallback(() => {
    if (current >= plainLines.length) return
    setTapped((prev) => [...prev, audioPosition()])
  }, [current, plainLines.length, audioPosition])

  const handleFinish = () => {
    const lines: TimedLine[] = tapped.map((startTime, i) => ({
      startTime,
      endTime: tapped[i + 1] ?? startTime + 5,
      original: plainLines[i],
      translation: translations[i] ?? '',
    }))
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
    <div className="h-full bg-cinnabar-950 flex flex-col items-center justify-center gap-6 p-6">
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
          {tapped.slice(-3).map((t, i) => (
            <div key={i} className="truncate">{plainLines[tapped.length - 3 + i]} · {fmt(t)}</div>
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
        {done && (
          <button onClick={handleFinish}
            className="min-h-11 px-6 py-2 bg-cinnabar-accent text-white rounded-full text-sm font-medium touch-manipulation active:scale-[0.97] transition-transform">
            Save timing
          </button>
        )}
      </div>
    </div>
  )
}
