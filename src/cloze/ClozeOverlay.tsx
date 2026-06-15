import { useMemo } from 'react'
import { selectClozeTokens } from './ClozeEngine'
import type { TimedLine, ClozeDifficulty } from '../core/types'

interface Props {
  line: TimedLine
  difficulty: ClozeDifficulty
  revealed: boolean
}

export function ClozeOverlay({ line, difficulty, revealed }: Props) {
  const tokens = useMemo(
    () => (line.tokens ? selectClozeTokens(line.tokens, difficulty) : []),
    [line.tokens, difficulty],
  )

  if (!line.tokens) return <span className="text-white">{line.original}</span>

  return (
    <div className="flex flex-wrap gap-0.5 justify-center font-jp text-2xl font-semibold">
      {tokens.map((t, i) => (
        <span key={i} className="relative">
          {t.blanked && !revealed ? (
            <span className="inline-block min-w-[1.5em] border-b-2 border-cinnabar-accent text-transparent">
              {t.surface}
            </span>
          ) : (
            <span className={t.blanked ? 'text-cinnabar-accent' : 'text-white'}>
              {t.surface}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
