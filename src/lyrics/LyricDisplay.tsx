import { useEffect, useRef } from 'react'
import { useLyricsStore } from './LyricsStore'
import type { TimedLine, FuriganaMode } from '../core/types'
import { WordAlignment } from '../language/WordAlignment'
import { isSameText } from './bilingual'

interface Props {
  onLineClick: (line: TimedLine) => void
}

/** Renders the Japanese (primary) text honoring the furigana/romaji mode. */
function PrimaryText({ line, isActive, furiganaMode }: {
  line: TimedLine
  isActive: boolean
  furiganaMode: FuriganaMode
}) {
  const sizeClass = isActive ? 'text-2xl font-semibold text-white' : 'text-base font-normal text-white/45'

  if (furiganaMode === 'furigana' && line.furigana) {
    return (
      <div
        className={['font-jp furigana-text transition-all duration-300', sizeClass].join(' ')}
        style={isActive ? { textShadow: '0 0 20px rgba(248,113,113,0.5)' } : undefined}
        dangerouslySetInnerHTML={{ __html: line.furigana }}
      />
    )
  }

  return (
    <div
      className={['font-jp transition-all duration-300', sizeClass].join(' ')}
      style={isActive ? { textShadow: '0 0 20px rgba(248,113,113,0.5)' } : undefined}
    >
      {line.original}
      {furiganaMode === 'romaji' && line.reading && !isSameText(line.reading, line.original) && (
        <div className={isActive ? 'text-sm text-cinnabar-accent/80 mt-1' : 'text-xs text-white/30 mt-0.5'}>
          {line.reading}
        </div>
      )}
    </div>
  )
}

function Line({ line, isActive, onLineClick, lineRef }: {
  line: TimedLine
  isActive: boolean
  onLineClick: (line: TimedLine) => void
  lineRef?: React.Ref<HTMLDivElement>
}) {
  const { furiganaMode, showTranslation, lyricsLayout } = useLyricsStore()
  const hasTranslation = !!line.translation && !isSameText(line.translation, line.original)
  const sideBySide = lyricsLayout === 'sideBySide' && hasTranslation

  const translationEl = hasTranslation && (showTranslation || isActive || sideBySide) ? (
    <div className={[
      'transition-all duration-300',
      isActive ? 'text-base italic text-white/70' : 'text-sm italic text-white/35',
      sideBySide ? 'text-left' : 'mt-1',
    ].join(' ')}>
      {line.translation}
    </div>
  ) : null

  return (
    <div
      ref={lineRef}
      onClick={() => onLineClick(line)}
      className={[
        'cursor-pointer select-none transition-all duration-300 px-4',
        isActive ? 'py-6' : 'py-2',
        sideBySide ? 'text-left' : 'text-center',
      ].join(' ')}
    >
      {sideBySide ? (
        <div className="grid grid-cols-2 gap-4 items-baseline max-w-3xl mx-auto">
          <PrimaryText line={line} isActive={isActive} furiganaMode={furiganaMode} />
          {translationEl}
        </div>
      ) : (
        <>
          <PrimaryText line={line} isActive={isActive} furiganaMode={furiganaMode} />
          {translationEl}
        </>
      )}

      {isActive && line.tokens && line.tokens.length > 0 && (
        <div className="mt-2">
          <WordAlignment tokens={line.tokens} grammarAnnotations={line.grammarAnnotations ?? []} />
        </div>
      )}
    </div>
  )
}

export function LyricDisplay({ onLineClick }: Props) {
  const { lines, activeLine } = useLyricsStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  // Keep the active line centered as playback advances, without hijacking the
  // user's manual scrolling beyond the moment the line changes.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeLine])

  if (lines.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
        No lyrics loaded
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-y-auto py-[35vh]"
      style={{ touchAction: 'pan-y', scrollbarWidth: 'thin' }}
    >
      {lines.map((line, i) => {
        const isActive = i === activeLine
        return (
          <Line
            key={i}
            line={line}
            isActive={isActive}
            onLineClick={onLineClick}
            lineRef={isActive ? activeRef : undefined}
          />
        )
      })}
    </div>
  )
}
