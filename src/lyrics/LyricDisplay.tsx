import { useEffect, useRef, useState } from 'react'
import { useLyricsStore } from './LyricsStore'
import type { TimedLine, FuriganaMode, Token } from '../core/types'
import { isSameText, hasVisibleTranslation } from './bilingual'
import { colorForToken, colorForTranslationWord, splitTranslationLines } from '../language/wordColors'
import { katakanaToHiragana } from '../language/japanese/phonetics'
import type { ABLoop } from '../core/types'
import { isABLoopActive } from '../player/abLoopUtils'
import { lineOverlapsABLoop } from './lineTiming'
import { lyricRowLoopRegion, lyricRowPlayheadActive } from '../core/ui/toolbarClasses'

const lyricTextTransition =
  'transition-[color,font-size,font-weight,text-shadow] duration-300 ease-out'
const lyricLineTransition =
  'transition-[padding,background-color] duration-300 ease-out'

type HoveredPair = { source?: number; target?: number }

const tokenBorderStyle = (color: string | null, highlighted = false) => {
  if (!color && !highlighted) return undefined
  return {
    borderBottomColor: color ?? 'rgba(255,255,255,0.35)',
    borderBottomWidth: highlighted ? '3px' : '2px',
    borderBottomStyle: 'solid' as const,
    ...(highlighted ? { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '2px' } : {}),
  }
}

function isSourceHighlighted(tokenIndex: number, tokens: Token[], hovered: HoveredPair | null): boolean {
  if (!hovered) return false
  if (hovered.source === tokenIndex) return true
  if (hovered.target !== undefined) return tokens[tokenIndex].alignmentIndices?.includes(hovered.target) ?? false
  return false
}

function isTranslationHighlighted(wordIndex: number, tokens: Token[], hovered: HoveredPair | null): boolean {
  if (!hovered) return false
  if (hovered.target === wordIndex) return true
  if (hovered.source !== undefined) return tokens[hovered.source].alignmentIndices?.includes(wordIndex) ?? false
  return false
}

function furiganaReading(token: Token): string | null {
  if (!token.reading) return null
  const reading = katakanaToHiragana(token.reading)
  return reading !== token.surface ? reading : null
}

function ColoredTokens({
  tokens,
  withFurigana,
  hovered,
  onHover,
}: {
  tokens: Token[]
  withFurigana: boolean
  hovered: HoveredPair | null
  onHover: (pair: HoveredPair | null) => void
}) {
  return (
    <>
      {tokens.map((token, i) => {
        const color = colorForToken(tokens, i)
        const highlighted = isSourceHighlighted(i, tokens, hovered)
        const reading = withFurigana ? furiganaReading(token) : null
        return (
          <span
            key={i}
            className="yomitan-text"
            style={tokenBorderStyle(color, highlighted)}
            onMouseEnter={() => onHover({ source: i })}
            onMouseLeave={() => onHover(null)}
          >
            {reading ? (
              <ruby>
                {token.surface}
                <rt>{reading}</rt>
              </ruby>
            ) : (
              token.surface
            )}
          </span>
        )
      })}
    </>
  )
}

interface Props {
  onLineClick: (line: TimedLine) => void
  abLoop?: ABLoop
  position?: number
}

/** Renders the Japanese (primary) text honoring the furigana/romaji mode. */
function PrimaryText({ line, isActive, furiganaMode, colored, hovered, onHover }: {
  line: TimedLine
  isActive: boolean
  furiganaMode: FuriganaMode
  colored: boolean
  hovered: HoveredPair | null
  onHover: (pair: HoveredPair | null) => void
}) {
  const sizeClass = isActive ? 'text-xl sm:text-2xl font-semibold text-white' : 'text-base font-normal text-white/45 group-hover:text-white/75'
  const lineHoverClass = 'group-hover:underline decoration-white/30 underline-offset-4'
  const useColoredTokens = colored && line.tokens && line.tokens.length > 0
  const showFurigana = furiganaMode === 'furigana'

  if (showFurigana && line.furigana && !useColoredTokens) {
    return (
      <div
        lang="ja"
        className={['font-jp furigana-text yomitan-text select-text', lyricTextTransition, sizeClass, lineHoverClass].join(' ')}
        style={isActive ? { textShadow: '0 0 20px rgba(248,113,113,0.5)' } : undefined}
        dangerouslySetInnerHTML={{ __html: line.furigana }}
      />
    )
  }

  return (
    <div
      lang="ja"
      className={['font-jp yomitan-text select-text', lyricTextTransition, showFurigana ? 'furigana-text' : '', sizeClass, lineHoverClass].join(' ')}
      style={isActive ? { textShadow: '0 0 20px rgba(248,113,113,0.5)' } : undefined}
    >
      {useColoredTokens ? (
        <ColoredTokens tokens={line.tokens!} withFurigana={showFurigana} hovered={hovered} onHover={onHover} />
      ) : (
        line.original
      )}
      {furiganaMode === 'romaji' && line.reading && !isSameText(line.reading, line.original) && (
        <div className={isActive ? 'text-sm text-cinnabar-accent/80 mt-1' : 'text-xs text-white/30 mt-0.5'}>
          {line.reading}
        </div>
      )}
    </div>
  )
}

function ColoredTranslation({
  line,
  hovered,
  onHover,
}: {
  line: TimedLine
  hovered: HoveredPair | null
  onHover: (pair: HoveredPair | null) => void
}) {
  const translationLineWords = splitTranslationLines(line.translation)
  if (!line.tokens) return <>{line.translation}</>

  let wordOffset = 0
  return (
    <>
      {translationLineWords.map((words, lineIdx) => {
        const lineEl = words.map((word, i) => {
          const globalIndex = wordOffset + i
          const color = colorForTranslationWord(line.tokens!, globalIndex)
          const highlighted = isTranslationHighlighted(globalIndex, line.tokens!, hovered)
          return (
            <span
              key={globalIndex}
              style={tokenBorderStyle(color, highlighted)}
              onMouseEnter={() => onHover({ target: globalIndex })}
              onMouseLeave={() => onHover(null)}
            >
              {word}{i < words.length - 1 ? ' ' : ''}
            </span>
          )
        })
        wordOffset += words.length
        return (
          <span key={lineIdx}>
            {lineEl}
            {lineIdx < translationLineWords.length - 1 ? <br /> : null}
          </span>
        )
      })}
    </>
  )
}

function Line({ line, isActive, inLoopRegion, onLineClick, lineRef }: {
  line: TimedLine
  isActive: boolean
  inLoopRegion: boolean
  onLineClick: (line: TimedLine) => void
  lineRef?: React.Ref<HTMLDivElement>
}) {
  const { furiganaMode, showTranslation, lyricsLayout } = useLyricsStore()
  const [hoveredPair, setHoveredPair] = useState<HoveredPair | null>(null)
  const hasTranslation = hasVisibleTranslation(line)
  // A line whose translation duplicates the original has no second column, so it falls back to the stacked layout even in side-by-side mode.
  const sideBySide = lyricsLayout === 'sideBySide' && hasTranslation
  const colored = hasTranslation && (sideBySide || showTranslation)
  const translationHoverClass = isActive
    ? 'group-hover:underline decoration-white/25 underline-offset-4'
    : 'group-hover:underline group-hover:text-white/60 decoration-white/20 underline-offset-4'

  const translationEl = hasTranslation && (showTranslation || sideBySide) ? (
    <div
      lang="en"
      translate="no"
      className={[
      lyricTextTransition,
      isActive ? 'text-base italic text-white/70' : 'text-sm italic text-white/35',
      sideBySide ? 'text-left' : 'mt-1.5',
      translationHoverClass,
      'text-pretty select-text',
      line.translation.includes('\n') ? 'whitespace-pre-line' : '',
    ].join(' ')}>
      {colored && line.tokens ? (
        <ColoredTranslation line={line} hovered={hoveredPair} onHover={setHoveredPair} />
      ) : (
        line.translation
      )}
    </div>
  ) : null

  return (
    <div
      ref={lineRef}
      onClick={() => onLineClick(line)}
      className={[
        'group cursor-pointer rounded-xl',
        lyricLineTransition,
        isActive ? 'py-4 sm:py-6' : 'py-2.5 sm:py-3',
        sideBySide ? 'text-left' : 'text-center',
        'hover:bg-white/[0.04] active:bg-white/[0.06]',
        inLoopRegion && !isActive ? lyricRowLoopRegion : '',
        isActive ? lyricRowPlayheadActive : '',
      ].join(' ')}
    >
      {sideBySide ? (
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2 sm:gap-4 items-baseline max-w-3xl mx-auto w-full px-1">
          <PrimaryText
            line={line}
            isActive={isActive}
            furiganaMode={furiganaMode}
            colored={colored}
            hovered={hoveredPair}
            onHover={setHoveredPair}
          />
          {translationEl}
        </div>
      ) : (
        <div className={sideBySide ? '' : 'max-w-2xl mx-auto w-full'}>
          <PrimaryText
            line={line}
            isActive={isActive}
            furiganaMode={furiganaMode}
            colored={colored}
            hovered={hoveredPair}
            onHover={setHoveredPair}
          />
          {translationEl}
        </div>
      )}
    </div>
  )
}

export function LyricDisplay({ onLineClick, abLoop, position: _position }: Props) {
  const { lines, activeLine } = useLyricsStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const loopActive = abLoop ? isABLoopActive(abLoop) : false

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
      className="flex-1 min-h-0 overflow-y-auto py-[14vh] sm:py-[18vh] md:py-[16vh] lg:py-[20vh] px-4"
      style={{ touchAction: 'pan-y', scrollbarWidth: 'thin' }}
    >
      {lines.map((line, i) => {
        const isActive = i === activeLine
        const inLoopRegion = loopActive && abLoop!.a !== null && abLoop!.b !== null
          && lineOverlapsABLoop(line, i, lines, abLoop!.a!, abLoop!.b!)
        return (
          <Line
            key={i}
            line={line}
            isActive={isActive}
            inLoopRegion={inLoopRegion}
            onLineClick={onLineClick}
            lineRef={isActive ? activeRef : undefined}
          />
        )
      })}
    </div>
  )
}
