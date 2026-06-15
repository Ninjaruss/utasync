import React from 'react'
import { useLyricsStore } from './LyricsStore'
import type { TimedLine } from '../core/types'
import { WordAlignment } from '../language/WordAlignment'

interface Props {
  onSeek: (time: number) => void
}

function Line({ line, state, onSeek }: {
  line: TimedLine
  state: 'prev' | 'active' | 'next' | 'hidden'
  onSeek: (t: number) => void
}) {
  const isActive = state === 'active'
  const isAdjacent = state === 'prev' || state === 'next'

  return (
    <div
      onClick={() => onSeek(line.startTime)}
      className={[
        'cursor-pointer select-none transition-all duration-300 text-center px-4 py-2',
        isActive ? 'py-6' : '',
      ].join(' ')}
    >
      <div className={[
        'font-jp transition-all duration-300',
        isActive
          ? 'text-2xl font-semibold text-white'
          : isAdjacent
            ? 'text-base font-normal text-cinnabar-800/60'
            : 'text-sm font-normal text-cinnabar-800/30',
      ].join(' ')}
        style={isActive ? { textShadow: '0 0 20px rgba(248,113,113,0.5)' } : undefined}
      >
        {line.original}
      </div>

      {isActive && line.reading && (
        <div className="text-sm text-cinnabar-accent/80 mt-1">{line.reading}</div>
      )}

      {isActive && line.translation && (
        <div className="text-base italic text-white/70 mt-1">{line.translation}</div>
      )}

      {isActive && line.tokens && line.tokens.length > 0 && (
        <div className="mt-2">
          <WordAlignment tokens={line.tokens} grammarAnnotations={line.grammarAnnotations ?? []} />
        </div>
      )}
    </div>
  )
}

export function LyricDisplay({ onSeek }: Props) {
  const { lines, activeLine } = useLyricsStore()

  if (lines.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-cinnabar-800/40 text-sm">
        No lyrics loaded
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center overflow-hidden">
      {lines.map((line, i) => {
        const offset = i - activeLine
        if (offset < -1 || offset > 2) return null
        const state = offset === 0 ? 'active' : offset === -1 ? 'prev' : 'next'
        return <Line key={i} line={line} state={state} onSeek={onSeek} />
      })}
    </div>
  )
}
