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

  const hiddenCount = revealed ? 0 : tokens.filter((t) => t.blanked).length

  return (
    <div lang="ja" className="flex flex-wrap gap-0.5 justify-center font-jp yomitan-text select-text text-xl sm:text-2xl font-semibold">
      {/* One summary per drilled row, so the drill is usable without sight. The
          blanks themselves are aria-hidden below, so without this a screen
          reader hears the scaffolding with no sign that anything is missing. */}
      {hiddenCount > 0 && (
        <span className="sr-only">
          {hiddenCount} {hiddenCount === 1 ? 'word is' : 'words are'} hidden. Reveal to see {hiddenCount === 1 ? 'it' : 'them'}.
        </span>
      )}
      {tokens.map((t, i) => (
        <span key={i} className="relative">
          {t.blanked && !revealed ? (
            /* The answer is hidden by colour alone, so the element itself has to
               be taken out of the accessibility tree and out of the selection
               buffer: otherwise a screen reader reads the word aloud, and a
               long-press (or a drag-select) offers Copy / Look Up on it — either
               one hands over the answer the drill is asking for. The text stays
               in the DOM so the underline keeps the word's real width.
               user-select is inline because `.yomitan-text` (src/index.css) sets
               user-select: text at the same specificity, and a utility class
               would lose on source order. */
            <span
              aria-hidden="true"
              style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
              className="inline-block min-w-[1.5em] border-b-2 border-cinnabar-accent text-transparent"
            >
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
