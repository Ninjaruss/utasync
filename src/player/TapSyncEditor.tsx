import { useState, useCallback } from 'react'
import type { TimedLine } from '../core/types'

interface Props {
  plainLines: string[]
  translations: string[]
  audioPosition: () => number
  onComplete: (lines: TimedLine[]) => void
}

export function TapSyncEditor({ plainLines, translations, audioPosition, onComplete }: Props) {
  const [tapped, setTapped] = useState<number[]>([])
  const current = tapped.length

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

  const handleUndo = () => setTapped((prev) => prev.slice(0, -1))

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center gap-6 p-6">
      <div className="text-white/40 text-sm">
        Line {current + 1} of {plainLines.length}
      </div>

      <div className="text-center space-y-2">
        <div className="text-2xl font-semibold text-white font-jp">
          {plainLines[current] ?? '—'}
        </div>
        {translations[current] && (
          <div className="text-white/60 italic">{translations[current]}</div>
        )}
      </div>

      {/* Previous lines tapped */}
      <div className="text-white/30 text-xs text-center max-w-xs">
        {tapped.slice(-3).map((t, i) => (
          <div key={i}>{plainLines[tapped.length - 3 + i]} @ {t.toFixed(2)}s</div>
        ))}
      </div>

      <button
        onClick={handleTap}
        disabled={current >= plainLines.length}
        className="w-32 h-32 rounded-full bg-cinnabar-accent text-white text-4xl shadow-lg active:scale-95 transition-transform disabled:opacity-30"
        style={{ boxShadow: '0 0 30px rgba(248,113,113,0.4)' }}
      >
        ⏎
      </button>

      <div className="flex gap-4">
        <button onClick={handleUndo} disabled={tapped.length === 0}
          className="px-4 py-2 text-white/50 hover:text-white text-sm disabled:opacity-30">
          ← Undo
        </button>
        {current >= plainLines.length && (
          <button onClick={handleFinish}
            className="px-6 py-2 bg-cinnabar-accent text-white rounded-full text-sm">
            Save & Practice
          </button>
        )}
      </div>
    </div>
  )
}
