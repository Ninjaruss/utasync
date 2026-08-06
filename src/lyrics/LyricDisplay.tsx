import { useCallback, useEffect, useRef, useState } from 'react'
import { useLyricsStore } from './LyricsStore'
import { useSettingsStore } from '../payment/SettingsStore'
import type { TimedLine, FuriganaMode, ReadingMode, Token } from '../core/types'
import { isSameText, hasVisibleTranslation } from './bilingual'
import { colorForToken, colorForTranslationWord, splitTranslationLines } from '../language/wordColors'
import { resolveTokenReading, lineRomajiFromTokens } from './readingDisplay'
import type { ABLoop, ABLoopPlaylistEntry } from '../core/types'
import { isABLoopActive, lyricLoopHighlight, type LyricLoopHighlight } from '../player/abLoopUtils'
import { lyricRowLoopRegion, lyricRowPlayheadActive, lyricRowPlaylistCurrent, lyricRowPlaylistRegion } from '../core/ui/toolbarClasses'
import { WordLookupPopover } from './WordLookupPopover'
import { hasJapanese } from '../language/japanese/wordLookup'
import { prefersReducedMotion } from '../core/ui/reducedMotion'

const lyricTextTransition =
  'transition-[color,font-size,font-weight,text-shadow] duration-300 ease-out'
const lyricLineTransition =
  'transition-[padding,background-color] duration-300 ease-out'

type HoveredPair = { source?: number; target?: number }

interface WordTap {
  token: Token
  rect: DOMRect
}

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

function ColoredTokens({
  tokens,
  withFurigana,
  withColoring,
  readingMode,
  hovered,
  onHover,
  onWordTap,
}: {
  tokens: Token[]
  withFurigana: boolean
  withColoring: boolean
  readingMode: ReadingMode
  hovered: HoveredPair | null
  onHover: (pair: HoveredPair | null) => void
  onWordTap?: (tap: WordTap) => void
}) {
  return (
    <>
      {tokens.map((token, i) => {
        const color = withColoring ? colorForToken(tokens, i) : null
        const highlighted = withColoring && isSourceHighlighted(i, tokens, hovered)
        const resolved = withFurigana ? resolveTokenReading(token, readingMode) : null
        const reading = resolved?.ruby ?? null
        const rubyTitle = resolved?.title
        const rubyClass = resolved?.source === 'sung'
          ? 'reading-audio'
          : token.readingMismatch
            ? 'reading-mismatch'
            : undefined
        // Only words that actually have a dictionary entry become controls, so
        // Tab doesn't stop on every particle and punctuation mark.
        const lookupable = !!onWordTap && hasJapanese(token.surface)
        const openLookup = (el: HTMLElement) =>
          onWordTap?.({ token, rect: el.getBoundingClientRect() })
        return (
          <span
            key={i}
            className="yomitan-text"
            style={tokenBorderStyle(color, highlighted)}
            onMouseEnter={() => onHover({ source: i })}
            onMouseLeave={() => onHover(null)}
            // role/tabIndex rather than a real <button>: a button resets the
            // ruby/inline typography the lyric line depends on.
            role={lookupable ? 'button' : undefined}
            tabIndex={lookupable ? 0 : undefined}
            aria-label={lookupable ? `Look up ${token.surface}` : undefined}
            onKeyDown={lookupable ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              e.stopPropagation()
              openLookup(e.currentTarget)
            } : undefined}
            onClick={onWordTap ? (e) => {
              if (!hasJapanese(token.surface)) return
              e.stopPropagation()
              openLookup(e.currentTarget)
            } : undefined}
          >
            {reading ? (
              <ruby className={rubyClass} title={rubyTitle}>
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
  playlistActive?: boolean
  playlistEntries?: ABLoopPlaylistEntry[]
  playlistIndex?: number
  /** Set while the user is placing an A or B loop point by tapping a line. */
  armingAB?: 'a' | 'b' | null
}

/** Renders the Japanese (primary) text honoring the furigana/romaji mode. */
function PrimaryText({ line, isActive, furiganaMode, readingMode, colored, hovered, onHover, onWordTap }: {
  line: TimedLine
  isActive: boolean
  furiganaMode: FuriganaMode
  readingMode: ReadingMode
  colored: boolean
  hovered: HoveredPair | null
  onHover: (pair: HoveredPair | null) => void
  onWordTap?: (tap: WordTap) => void
}) {
  const sizeClass = isActive ? 'text-xl sm:text-2xl font-semibold text-white' : 'text-base font-normal text-white/45 group-hover:text-white/75'
  const lineHoverClass = 'group-hover:underline decoration-white/30 underline-offset-4'
  const showFurigana = furiganaMode === 'furigana'
  const useTokenRender = line.tokens && line.tokens.length > 0 && (colored || showFurigana || (!!onWordTap && hasJapanese(line.original)))

  if (showFurigana && line.furigana && !useTokenRender) {
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
      {useTokenRender ? (
        <ColoredTokens
          tokens={line.tokens!}
          withFurigana={showFurigana}
          withColoring={colored}
          readingMode={readingMode}
          hovered={hovered}
          onHover={onHover}
          onWordTap={onWordTap}
        />
      ) : (
        line.original
      )}
      {furiganaMode === 'romaji' && (() => {
        const romaji = line.tokens?.length ? lineRomajiFromTokens(line.tokens, readingMode) : line.reading
        return romaji && !isSameText(romaji, line.original) ? (
          <div className={isActive ? 'text-sm text-cinnabar-accent/80 mt-1' : 'text-xs text-white/30 mt-0.5'}>
            {romaji}
          </div>
        ) : null
      })()}
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

  const lineOffsets: number[] = []
  translationLineWords.reduce((offset, words) => {
    lineOffsets.push(offset)
    return offset + words.length
  }, 0)

  return (
    <>
      {translationLineWords.map((words, lineIdx) => {
        const wordOffset = lineOffsets[lineIdx]
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

function loopHighlightClass(highlight: LyricLoopHighlight | null, isActive: boolean): string {
  if (isActive) return ''
  switch (highlight) {
    case 'ab': return lyricRowLoopRegion
    case 'playlist': return lyricRowPlaylistRegion
    case 'playlist-current': return lyricRowPlaylistCurrent
    default: return ''
  }
}

function Line({ line, isActive, loopHighlight, onLineClick, lineRef, onWordTap, armingAB }: {
  line: TimedLine
  isActive: boolean
  loopHighlight: LyricLoopHighlight | null
  onLineClick: (line: TimedLine) => void
  lineRef?: React.Ref<HTMLDivElement>
  onWordTap?: (tap: WordTap) => void
  armingAB?: 'a' | 'b' | null
}) {
  const { furiganaMode, showTranslation, lyricsLayout } = useLyricsStore()
  const readingMode = useSettingsStore((s) => s.readingMode)
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

  /* The row becomes a control except when its own words already are — nesting a
   * button inside a button is invalid, and there is nothing to seek to on the
   * line you are already on. While a loop point is being armed every row is a
   * target, including the active one, so word lookup steps aside. */
  const rowIsControl = !isActive || !!armingAB
  const rowLabel = armingAB
    ? `Set loop point ${armingAB.toUpperCase()} at ${line.original || line.translation}`
    : `Jump to ${line.original || line.translation}`

  return (
    <div
      ref={lineRef}
      onClick={() => onLineClick(line)}
      role={rowIsControl ? 'button' : undefined}
      tabIndex={rowIsControl ? 0 : undefined}
      aria-label={rowIsControl ? rowLabel : undefined}
      onKeyDown={rowIsControl ? (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onLineClick(line)
      } : undefined}
      className={[
        'group cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar-accent/60',
        lyricLineTransition,
        isActive ? 'py-4 sm:py-6' : 'py-2.5 sm:py-3',
        sideBySide ? 'text-left' : 'text-center',
        'hover:bg-white/[0.04] active:bg-white/[0.06]',
        loopHighlightClass(loopHighlight, isActive),
        isActive ? lyricRowPlayheadActive : '',
      ].join(' ')}
    >
      {sideBySide ? (
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2 sm:gap-4 items-baseline max-w-3xl mx-auto w-full px-1">
          <PrimaryText
            line={line}
            isActive={isActive}
            furiganaMode={furiganaMode}
            readingMode={readingMode}
            colored={colored}
            hovered={hoveredPair}
            onHover={setHoveredPair}
            onWordTap={onWordTap}
          />
          {translationEl}
        </div>
      ) : (
        <div className={sideBySide ? '' : 'max-w-2xl mx-auto w-full'}>
          <PrimaryText
            line={line}
            isActive={isActive}
            furiganaMode={furiganaMode}
            readingMode={readingMode}
            colored={colored}
            hovered={hoveredPair}
            onHover={setHoveredPair}
            onWordTap={onWordTap}
          />
          {translationEl}
        </div>
      )}
    </div>
  )
}

export function LyricDisplay({
  onLineClick,
  abLoop,
  position: _position,
  playlistActive = false,
  playlistEntries = [],
  playlistIndex = 0,
  armingAB = null,
}: Props) {
  const { lines, activeLine } = useLyricsStore()
  const tapLookupEnabled = useSettingsStore((s) => s.tapLookupEnabled)
  const [wordTap, setWordTap] = useState<WordTap | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const loopActive = abLoop ? isABLoopActive(abLoop) : false

  // Keep the active line centered as playback advances. The first centering
  // (mount, e.g. returning from Edit mode) jumps instantly so the user isn't
  // watching a long smooth scroll from the top of the song.
  //
  // Following pauses the moment the user scrolls for themselves: re-centering on
  // every line change made it impossible to read back over a phrase you just
  // missed, because the next line begins two to four seconds later and snapped
  // the view away again. It resumes when the user asks (the jump control), when
  // they tap a line to seek, or on its own once the active line is back on
  // screen — never on a timer, which would yank the view mid-sentence.
  const hasCentered = useRef(false)
  const [followPaused, setFollowPaused] = useState(false)

  const centerActiveLine = useCallback((smooth: boolean) => {
    const el = activeRef.current
    if (!el) return
    // An explicit `behavior` beats CSS scroll-behavior, so the reduced-motion
    // preference has to be checked here — this scroll fires every few seconds
    // for the length of a song, which is the app's most motion-heavy moment.
    el.scrollIntoView({
      block: 'center',
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
    })
  }, [])

  const resumeFollowing = useCallback(() => {
    setFollowPaused(false)
    centerActiveLine(true)
  }, [centerActiveLine])

  /** True when the active row is within the scroll viewport. */
  const activeLineOnScreen = useCallback(() => {
    const el = activeRef.current
    const box = containerRef.current
    if (!el || !box) return false
    const row = el.getBoundingClientRect()
    const view = box.getBoundingClientRect()
    return row.bottom > view.top && row.top < view.bottom
  }, [])

  useEffect(() => {
    if (!activeRef.current || followPaused) return
    centerActiveLine(hasCentered.current)
    hasCentered.current = true
  }, [activeLine, followPaused, centerActiveLine])

  // wheel/touchmove are unambiguous user intent; a plain `scroll` listener
  // cannot tell our own scrollIntoView apart from a finger.
  const pauseFollowing = useCallback(() => {
    if (activeLineOnScreen()) return
    setFollowPaused(true)
  }, [activeLineOnScreen])

  // Resume-only: scrolling back to where the song actually is means the user
  // wants to follow again. It never pauses, so the scroll events emitted by our
  // own smooth scrollIntoView can't strand the view mid-flight.
  const resumeIfBackOnScreen = useCallback(() => {
    if (followPaused && activeLineOnScreen()) setFollowPaused(false)
  }, [followPaused, activeLineOnScreen])

  if (lines.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6 py-12">
        <div className="w-10 h-10 rounded-2xl bg-cinnabar-900 border border-cinnabar-800 flex items-center justify-center text-cinnabar-accent/50 text-lg mb-1">♪</div>
        <p className="text-white/40 text-sm font-medium">No lyrics loaded</p>
        <p className="text-white/25 text-xs text-pretty max-w-[14rem] leading-relaxed">Switch to Edit mode to add or import lyrics for this song.</p>
      </div>
    )
  }

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
    <div
      ref={containerRef}
      onWheel={pauseFollowing}
      onTouchMove={pauseFollowing}
      onScroll={resumeIfBackOnScreen}
      /* Breathing room scaled by VIEWPORT HEIGHT, not width. The old
         sm:/md:/lg: steps keyed off width, so a landscape phone (wide but
         short) took the desktop-sized 14vh — 50px top AND bottom of a 101px
         scroll region, i.e. zero usable height, with the one visible line
         clipped through its own kanji. The clamp keeps the padding decorative
         on short screens and unchanged on tall ones. */
      className="flex-1 min-h-0 overflow-y-auto px-4 py-[clamp(0.5rem,8vh,3rem)] [@media(min-height:640px)]:py-[clamp(1rem,14vh,7rem)] [@media(min-height:900px)]:py-[16vh]"
      style={{ touchAction: 'pan-y', scrollbarWidth: 'thin' }}
    >
      {lines.map((line, i) => {
        const isActive = i === activeLine
        const loopHighlight = abLoop
          ? lyricLoopHighlight(
            line,
            i,
            lines,
            abLoop,
            loopActive,
            playlistActive,
            playlistEntries,
            playlistIndex,
          )
          : null
        return (
          <Line
            key={i}
            line={line}
            isActive={isActive}
            loopHighlight={loopHighlight}
            // Tapping a line seeks there, which IS a request to follow the song
            // again — so it clears a paused follow rather than leaving the user
            // staring at a jump chip they no longer need.
            onLineClick={(l) => { setFollowPaused(false); onLineClick(l) }}
            lineRef={isActive ? activeRef : undefined}
            armingAB={armingAB}
            // Only the ACTIVE line's words open the dictionary; tapping a word on
            // any other line falls through to the row's seek (jump to that line)
            // instead of being swallowed by the lookup. While arming a loop point
            // the whole row is the target, so lookup stands down — otherwise
            // tapping the Japanese opened a definition instead of placing the point.
            onWordTap={tapLookupEnabled && isActive && !armingAB ? setWordTap : undefined}
          />
        )
      })}
      {wordTap && (
        <WordLookupPopover
          token={wordTap.token}
          anchorRect={wordTap.rect}
          onClose={() => setWordTap(null)}
        />
      )}
    </div>

    {followPaused && (
      <button
        type="button"
        onClick={resumeFollowing}
        // Centred with auto margins rather than -translate-x-1/2: the
        // progress-enter keyframes animate `transform`, which overrides the
        // translate utility and left the chip hanging off to the right.
        className="absolute inset-x-0 mx-auto w-fit bottom-3 z-20 min-h-11 px-4 rounded-full border border-cinnabar-accent/50 bg-cinnabar-950/90 backdrop-blur-sm text-cinnabar-accent text-xs font-medium shadow-lg shadow-black/30 touch-manipulation transition-colors duration-150 ease-out animate-[progress-enter_180ms_ease-out_both]"
      >
        ↓ Jump to current line
      </button>
    )}
    </div>
  )
}
