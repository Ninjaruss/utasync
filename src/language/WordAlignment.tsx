import { useState } from 'react'
import type { Token, GrammarAnnotation } from '../core/types'

interface Props {
  tokens: Token[]
  grammarAnnotations: GrammarAnnotation[]
  onTokenHover?: (token: Token | null) => void
}

export function WordAlignment({ tokens, grammarAnnotations, onTokenHover }: Props) {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  function annotationForToken(token: Token): GrammarAnnotation | null {
    return grammarAnnotations.find(
      (a) => a.tokenIndices.includes(tokens.indexOf(token))
    ) ?? null
  }

  return (
    <div className="relative flex flex-wrap gap-0.5 justify-center">
      {tokens.map((token, i) => {
        const grammar = annotationForToken(token)
        return (
          <span
            key={i}
            className={[
              'cursor-pointer transition-colors rounded px-0.5',
              grammar ? 'border-b-2 border-dotted border-cinnabar-accent' : '',
            ].join(' ')}
            onMouseEnter={(e) => {
              if (grammar) {
                const rect = e.currentTarget.getBoundingClientRect()
                setTooltip({ text: `${grammar.pattern}: ${grammar.explanation}`, x: rect.left, y: rect.top - 8 })
              }
              onTokenHover?.(token)
            }}
            onMouseLeave={() => { setTooltip(null); onTokenHover?.(null) }}
          >
            {token.surface}
          </span>
        )
      })}

      {tooltip && (
        <div
          className="fixed z-50 bg-cinnabar-900 border border-cinnabar-800 text-white text-xs rounded-lg px-3 py-2 max-w-xs pointer-events-none shadow-xl"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  )
}
