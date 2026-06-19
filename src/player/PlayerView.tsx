import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { usePlayerStore } from './PlayerStore'
import { useLyricsStore } from '../lyrics/LyricsStore'
import { AudioEngine } from './AudioEngine'
import { LyricDisplay } from '../lyrics/LyricDisplay'
import { db } from '../core/db/schema'
import { YouTubePlayer, type YouTubePlayerHandle } from './YouTubePlayer'
import { extractVideoId } from '../sources/youtube'
import { ABLoopController } from './ABLoop'
import type { Song, TimedLine, Language } from '../core/types'
import { tokenizeJapanese } from '../language/japanese/tokenizer'
import { toRomaji, toFurigana } from '../language/japanese/phonetics'
import { detectGrammarPatterns } from '../language/japanese/grammar'
import { tokenizeEnglish } from '../language/english/tokenizer'
import { sentenceToIPA } from '../language/english/phonetics'
import { detectEnglishGrammar } from '../language/english/grammar'
import { TapSyncEditor } from './TapSyncEditor'
import { getDeviceTier } from '../ai-pipeline/capability'
import { linesAreTimed, chooseAutoAlignment, manualAlignMode, type AlignMode } from './alignmentPolicy'
import { EditMode } from '../lyrics/EditMode'
import { computeSyncState } from '../core/db/migrations'
import { hasVisibleTranslation } from '../lyrics/bilingual'
import { linesNeedEnrichment, linesNeedAlignment, lineNeedsAlignment, LYRICS_ENRICHMENT_VERSION } from '../lyrics/lyricsEnrichment'
import { alignLinesTokens, countEmbedBatches } from '../ai-pipeline/wordAligner'
import { splitTranslationWords } from '../language/wordColors'
import { LoadingOverlay } from '../core/ui/LoadingOverlay'
import { abPairError, abEndpointFromLine, isValidABPair } from './abLoopUtils'
import { exportAbLoopClip, abLoopHasTimedLyrics } from './abLoopExport'
import { getAudioFile } from '../core/opfs/audio'
import { PlayerControls } from './PlayerControls'
import { DisplayMenu } from './DisplayMenu'
import { modeToolbarRow } from '../core/ui/toolbarClasses'

const AutoAlignFlow = lazy(() => import('../ai-pipeline/AutoAlignFlow'))

async function enrichLines(lines: TimedLine[], sourceLanguage: Language): Promise<TimedLine[]> {
  return Promise.all(lines.map(async (line): Promise<TimedLine> => {
    try {
      if (sourceLanguage === 'ja') {
        const [tokens, reading, furigana] = await Promise.all([
          tokenizeJapanese(line.original),
          toRomaji(line.original),
          toFurigana(line.original),
        ])
        const grammarAnnotations = detectGrammarPatterns(line.original)
        return { ...line, tokens, reading, furigana, grammarAnnotations }
      } else {
        const tokens = tokenizeEnglish(line.original)
        const reading = await sentenceToIPA(line.original)
        const grammarAnnotations = detectEnglishGrammar(line.original)
        return { ...line, tokens, reading, grammarAnnotations }
      }
    } catch {
      return line
    }
  }))
}

/** Max texts per embed call on lite-tier phones to limit WebGPU memory spikes. */
const LITE_EMBED_BATCH_TEXTS = 64
/** Lines processed per chunk on lite tier so the UI can breathe between batches. */
const LITE_ALIGN_LINES_PER_CHUNK = 4

/**
 * Computes word-pair alignment for lines that have both tokens and a visible
 * translation, gated to non-manual device tiers (the embedding model can't
 * run on devices without WebGPU, same constraint as Auto-Align). Failures
 * (model load/run errors) degrade silently to no coloring rather than
 * blocking the rest of the song from displaying.
 * Batches embedding across lines (one or few round-trips per song).
 */
async function enrichAlignment(
  lines: TimedLine[],
  onProgress?: (done: number, total: number) => void,
): Promise<TimedLine[]> {
  if (getDeviceTier() === 'manual') return lines
  const indices = lines.map((line, i) => (lineNeedsAlignment(line) ? i : -1)).filter((i) => i >= 0)
  if (indices.length === 0) return lines

  try {
    const { embedTexts } = await import('../ai-pipeline/textEmbedder')

    const tier = getDeviceTier()
    const linesPerChunk = tier === 'lite' ? LITE_ALIGN_LINES_PER_CHUNK : indices.length
    const maxTextsPerBatch = tier === 'lite' ? LITE_EMBED_BATCH_TEXTS : undefined
    const updated = [...lines]
    const totalLines = indices.length

    let totalEmbedBatches = 0
    for (let chunkStart = 0; chunkStart < indices.length; chunkStart += linesPerChunk) {
      const chunkIndices = indices.slice(chunkStart, chunkStart + linesPerChunk)
      const jobs = chunkIndices.map((i) => ({
        tokens: lines[i].tokens!,
        targetWords: splitTranslationWords(lines[i].translation),
      }))
      totalEmbedBatches += countEmbedBatches(jobs, maxTextsPerBatch)
    }

    const useEmbedBatchProgress = totalEmbedBatches > 1
    let lineChunksDone = 0
    let embedBatchesDone = 0
    onProgress?.(0, useEmbedBatchProgress ? totalEmbedBatches : totalLines)

    for (let start = 0; start < indices.length; start += linesPerChunk) {
      const chunkIndices = indices.slice(start, start + linesPerChunk)
      const jobs = chunkIndices.map((i) => ({
        tokens: lines[i].tokens!,
        targetWords: splitTranslationWords(lines[i].translation),
      }))
      const embedWithProgress = (texts: string[]) =>
        embedTexts(texts, !useEmbedBatchProgress ? {
          onProgress: (done, total) => onProgress?.(done, total),
        } : undefined)
      const aligned = await alignLinesTokens(jobs, embedWithProgress, {
        maxTextsPerBatch,
        onBatchProgress: useEmbedBatchProgress
          ? () => {
              embedBatchesDone++
              onProgress?.(embedBatchesDone, totalEmbedBatches)
            }
          : undefined,
      })
      chunkIndices.forEach((lineIndex, j) => {
        updated[lineIndex] = { ...updated[lineIndex], tokens: aligned[j] }
      })
      if (!useEmbedBatchProgress) {
        lineChunksDone += chunkIndices.length
        onProgress?.(lineChunksDone, totalLines)
      }
      if (tier === 'lite' && start + linesPerChunk < indices.length) {
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    return updated
  } catch (e) {
    console.warn('word alignment failed', e)
    return lines
  }
}

interface Props {
  songId: string
  onBack: () => void
  onSettings?: () => void
  /** When true (fresh add-song), auto-align untimed lyrics once on open. */
  autoAlignOnOpen?: boolean
}

const SEEK_STEP_SEC = 5

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable
    || target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
  )
}

export function PlayerView({ songId, onBack, onSettings, autoAlignOnOpen = false }: Props) {
  const engineRef = useRef<AudioEngine | null>(null)
  if (engineRef.current === null) engineRef.current = new AudioEngine()
  const engine = engineRef.current
  const abLoopControllerRef = useRef<ABLoopController | null>(null)
  const ytRef = useRef<YouTubePlayerHandle>(null)
  // Tracks whether timestamp-scrubbing started playback, so onScrubEnd only
  // stops audio it itself started (leaves pre-existing playback alone).
  const scrubStartedPlayRef = useRef(false)
  const { playbackState, position, speed, volume, abLoop, armingAB, currentSongId, setPlaybackState, setPosition, setSpeed, setVolume, setABLoop, armAB, setCurrentSong } = usePlayerStore()
  const { lines, syncPosition, setLines, furiganaMode, showTranslation, lyricsLayout, setFuriganaMode, setShowTranslation, setLyricsLayout } = useLyricsStore()
  const [song, setSong] = useState<Song | null>(null)
  const [duration, setDuration] = useState(1)
  const [alignMode, setAlignMode] = useState<AlignMode | null>(null)
  const [mode, setMode] = useState<'play' | 'edit'>('play')
  const [lyricsLoading, setLyricsLoading] = useState<{ message: string; detail?: string } | null>(null)
  const [wordColorProgress, setWordColorProgress] = useState<{ done: number; total: number } | null>(null)
  const [abExporting, setAbExporting] = useState(false)
  const [abExportError, setAbExportError] = useState('')
  const [abExportIncludeSrt, setAbExportIncludeSrt] = useState(false)
  const speedPct = Math.round(speed * 100)
  const volumePct = Math.round(volume * 100)

  const runWordColoring = async (lines: TimedLine[]) => {
    const total = lines.filter(lineNeedsAlignment).length
    if (total === 0) return lines
    setWordColorProgress({ done: 0, total })
    try {
      return await enrichAlignment(lines, (done, t) => setWordColorProgress({ done, total: t }))
    } finally {
      setWordColorProgress(null)
    }
  }

  const runLyricsEnrichment = async (lines: TimedLine[], sourceLanguage: Language, enrichmentVersion?: number) => {
    let enriched = lines
    if (linesNeedEnrichment(lines, enrichmentVersion)) {
      setLyricsLoading({ message: 'Normalizing lyrics…', detail: 'Tokenizing and adding readings' })
      try {
        enriched = await enrichLines(lines, sourceLanguage)
      } finally {
        setLyricsLoading(null)
      }
    }
    return runWordColoring(enriched)
  }

  const runAlignmentOnly = async (lines: TimedLine[]) => runWordColoring(lines)

  const persistEnrichedLines = async (base: Song, enriched: TimedLine[], updateUi: boolean) => {
    const updated: Song = {
      ...base,
      lyrics: { ...base.lyrics, lines: enriched, enrichmentVersion: LYRICS_ENRICHMENT_VERSION },
    }
    await db.songs.put(updated)
    if (updateUi) {
      setSong(updated)
      setLines(enriched)
      syncPosition(usePlayerStore.getState().position)
    }
  }

  useEffect(() => {
    let cancelled = false
    db.songs.get(songId).then(async (s) => {
      if (!s || cancelled) return
      setSong(s)
      setLines(s.lyrics.lines)
      setMode('play') // a freshly opened song always lands in Play mode
      // Opening a different song starts from the top; reopening the same song
      // (e.g. after a trip to Settings) resumes the persisted position.
      const store = usePlayerStore.getState()
      const isNewSong = store.currentSongId !== songId
      if (isNewSong) setCurrentSong(songId) // resets position to 0
      const resumeAt = isNewSong ? 0 : store.position
      // Load locally-stored audio into the engine so playback works for
      // non-YouTube sources. Without this, play() is a no-op.
      if (s.audioStoredPath) {
        try {
          const file = await getAudioFile(s.id)
          const loadVolume = usePlayerStore.getState().volume
          await engine.load(file, loadVolume)
          if (!cancelled) {
            setDuration(engine.duration || 1)
            engine.setVolume(usePlayerStore.getState().volume)
            if (resumeAt > 0) {
              engine.seek(resumeAt)
              setPosition(resumeAt)
              syncPosition(resumeAt)
            }
          }
        } catch {
          // audio file missing or unreadable — leave controls inert
        }
      }
      const willAutoAlign = autoAlignOnOpen
        && chooseAutoAlignment(!!s.audioStoredPath, s.lyrics.lines, getDeviceTier()) !== null
      if (!willAutoAlign && linesAreTimed(s.lyrics.lines)) {
        if (linesNeedEnrichment(s.lyrics.lines, s.lyrics.enrichmentVersion)) {
          runLyricsEnrichment(s.lyrics.lines, s.lyrics.sourceLanguage, s.lyrics.enrichmentVersion)
            .then((enriched) => {
              void persistEnrichedLines(s, enriched, !cancelled)
            })
        } else if (linesNeedAlignment(s.lyrics.lines)) {
          runAlignmentOnly(s.lyrics.lines)
            .then((enriched) => {
              void persistEnrichedLines(s, enriched, !cancelled)
            })
        }
      }
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId])

  useEffect(() => {
    const e = engine
    e.onTimeUpdate((pos) => {
      setPosition(pos)
      syncPosition(pos)
      abLoopControllerRef.current?.tick()
    })
    e.onEnd(() => setPlaybackState('idle'))

    abLoopControllerRef.current = new ABLoopController(
      e,
      () => usePlayerStore.getState().abLoop,
      () => usePlayerStore.getState().position,
    )

    return () => {
      e.destroy()
      abLoopControllerRef.current?.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ytVideoId = song?.sourceUrl ? extractVideoId(song.sourceUrl) : null
  const isYouTube = !!ytVideoId && !song?.audioStoredPath
  // AutoAlignFlow can only decode locally stored audio (song.audioStoredPath),
  // not a YouTube stream — gate on that specifically, not "any active source".
  const hasAudio = !!song?.audioStoredPath

  const togglePlay = () => {
    if (playbackState === 'playing') {
      if (isYouTube) ytRef.current?.pause(); else engine.pause()
      setPlaybackState('paused')
    } else {
      if (isYouTube) ytRef.current?.play(); else engine.play()
      setPlaybackState('playing')
    }
  }

  const seek = (time: number) => {
    if (isYouTube) {
      ytRef.current?.seekTo(time)
    } else {
      engine.seek(time)
    }
    setPosition(time)
    syncPosition(time)
  }

  /** Jump to a lyric by index; sets activeLine directly so untimed lines still highlight correctly. */
  const goToLyricLine = (index: number) => {
    const lyricLines = useLyricsStore.getState().lines
    if (index < 0 || index >= lyricLines.length) return
    useLyricsStore.setState({ activeLine: index })
    const time = lyricLines[index].startTime
    if (isYouTube) ytRef.current?.seekTo(time)
    else engine.seek(time)
    setPosition(time)
  }

  const stepLyricLine = (delta: number) => {
    const { lines: lyricLines, activeLine } = useLyricsStore.getState()
    if (lyricLines.length === 0) return
    let next: number
    if (activeLine < 0) {
      if (delta < 0) return
      next = 0
    } else {
      next = activeLine + delta
    }
    if (next < 0 || next >= lyricLines.length) return
    goToLyricLine(next)
  }

  const onScrubStart = () => {
    if (usePlayerStore.getState().playbackState !== 'playing') {
      scrubStartedPlayRef.current = true
      if (isYouTube) ytRef.current?.play(); else engine.play()
      setPlaybackState('playing')
    }
  }

  const onScrubEnd = () => {
    if (scrubStartedPlayRef.current) {
      scrubStartedPlayRef.current = false
      if (isYouTube) ytRef.current?.pause(); else engine.pause()
      setPlaybackState('paused')
    }
  }

  const beginAlignment = (mode: AlignMode) => {
    if (mode === 'tap') { engine.play(); setPlaybackState('playing') }
    setAlignMode(mode)
  }

  useEffect(() => {
    if (!song || !autoAlignOnOpen) return
    const choice = chooseAutoAlignment(!!song.audioStoredPath, song.lyrics.lines, getDeviceTier())
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot route into alignment after add-song
    if (choice) beginAlignment(choice)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, autoAlignOnOpen])

  const applyAlignedSong = (updated: Song) => {
    setSong(updated)
    setLines(updated.lyrics.lines)
    setAlignMode(null)
    // Yield so Whisper/Demucs workers finish tearing down and release WebGPU
    // memory before we load the embedding model for word-pair coloring.
    const yieldMs = getDeviceTier() === 'lite' ? 150 : 0
    setTimeout(() => {
      runLyricsEnrichment(updated.lyrics.lines, updated.lyrics.sourceLanguage, updated.lyrics.enrichmentVersion)
        .then((enriched) => { void persistEnrichedLines(updated, enriched, true) })
    }, yieldMs)
  }

  const handleTapComplete = async (lines: TimedLine[]) => {
    if (!song) return
    const updated: Song = { ...song, lyrics: { ...song.lyrics, lines } }
    await db.songs.put(updated)
    applyAlignedSong(updated)
  }

  const handleEditLines = async (lines: TimedLine[]) => {
    if (!song) return
    setLines(lines)
    const updated: Song = {
      ...song,
      lyrics: { ...song.lyrics, lines, enrichmentVersion: undefined },
      syncState: computeSyncState({ ...song, lyrics: { ...song.lyrics, lines } }),
    }
    setSong(updated)
    await db.songs.put(updated)
    if (linesNeedEnrichment(lines, updated.lyrics.enrichmentVersion)) {
      enrichLines(lines, song.lyrics.sourceLanguage)
        .then(runWordColoring)
        .then((enriched) => {
          if (enriched.length === lines.length) void persistEnrichedLines(updated, enriched, true)
        })
    } else if (linesNeedAlignment(lines)) {
      runWordColoring(lines)
        .then((enriched) => {
          if (enriched.length === lines.length) void persistEnrichedLines(updated, enriched, true)
        })
    }
  }

  const progress = position / duration
  const isJapanese = song?.lyrics.sourceLanguage === 'ja'
  const hasTranslation = !!song?.lyrics.lines.some(hasVisibleTranslation)

  // Sync playback rate whenever speed changes or audio source becomes available.
  useEffect(() => {
    if (isYouTube) {
      ytRef.current?.setRate(speed)
    } else {
      engine.setRate(speed)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed, isYouTube])

  useEffect(() => {
    if (isYouTube) {
      ytRef.current?.setVolume(volume)
    } else {
      engine.setVolume(volume)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, isYouTube])

  useEffect(() => {
    if (alignMode) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        if (e.repeat) return
        togglePlay()
        return
      }

      if (e.code === 'ArrowLeft' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const pos = usePlayerStore.getState().position
        seek(Math.max(0, pos - SEEK_STEP_SEC))
        return
      }

      if (e.code === 'ArrowRight' || e.key === 'ArrowRight') {
        e.preventDefault()
        const pos = usePlayerStore.getState().position
        const end = Math.max(duration, engine.duration ?? 0)
        seek(Math.min(end, pos + SEEK_STEP_SEC))
        return
      }

      if (e.code === 'ArrowDown' || e.key === 'ArrowDown') {
        e.preventDefault()
        stepLyricLine(1)
        return
      }

      if (e.code === 'ArrowUp' || e.key === 'ArrowUp') {
        e.preventDefault()
        stepLyricLine(-1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alignMode, isYouTube, playbackState, position, duration])

  const cycleFurigana = () =>
    setFuriganaMode(furiganaMode === 'none' ? 'romaji' : furiganaMode === 'romaji' ? 'furigana' : 'none')

  const toggleArm = (which: 'a' | 'b') => armAB(armingAB === which ? null : which)
  const abLoopError = abPairError(abLoop.a, abLoop.b)
  const abExportCanIncludeSrt = !!(
    song
    && isValidABPair(abLoop.a, abLoop.b)
    && abLoopHasTimedLyrics(song.lyrics.lines, abLoop.a!, abLoop.b!)
  )

  const handleExportAbLoop = async () => {
    if (!song?.audioStoredPath || !isValidABPair(abLoop.a, abLoop.b)) return
    setAbExportError('')
    setAbExporting(true)
    try {
      const audioFile = await getAudioFile(song.id)
      await exportAbLoopClip({
        audioFile,
        lines: song.lyrics.lines,
        artist: song.artist,
        title: song.title,
        a: abLoop.a!,
        b: abLoop.b!,
        includeSrt: abExportIncludeSrt && abExportCanIncludeSrt,
      })
    } catch (e: unknown) {
      setAbExportError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setAbExporting(false)
    }
  }

  if (song && alignMode === 'tap') {
    return (
      <TapSyncEditor
        plainLines={song.lyrics.lines.map((l) => l.original)}
        translations={song.lyrics.lines.map((l) => l.translation)}
        audioPosition={() => engine.position}
        onComplete={handleTapComplete}
      />
    )
  }

  return (
    <div
      className="h-[100dvh] overflow-hidden bg-cinnabar-950 flex flex-col w-full max-w-7xl mx-auto md:border-x border-cinnabar-900/80"
      onClick={() => { if (armingAB) armAB(null) }}
    >
      {lyricsLoading && <LoadingOverlay message={lyricsLoading.message} detail={lyricsLoading.detail} />}
      {wordColorProgress && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-cinnabar-900/95 border border-cinnabar-800 shadow-lg"
          role="status"
          aria-live="polite"
        >
          <p className="text-white/70 text-xs whitespace-nowrap">
            Coloring word pairs… {wordColorProgress.done}/{wordColorProgress.total}
          </p>
        </div>
      )}
      {abExporting && (
        <LoadingOverlay message="Exporting A-B loop…" detail="Trimming audio and syncing subtitles" />
      )}
      {/* Top bar */}
      <header className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-cinnabar-900 shrink-0">
        <button onClick={onBack} className="shrink-0 min-h-11 min-w-11 px-2 text-white/40 hover:text-white text-xs touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]">← Back</button>
        {song && (
          <div className="flex-1 min-w-0 px-1">
            <p className="text-sm text-white/85 truncate font-medium text-balance">{song.title}</p>
            {song.artist && <p className="text-[11px] text-white/35 truncate text-pretty">{song.artist}</p>}
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex bg-white/8 rounded-full p-0.5 gap-0.5">
            <button onClick={() => setMode('play')}
              className={`text-[11px] px-3 py-1.5 rounded-[calc(9999px-2px)] touch-manipulation transition-[color,background-color] duration-150 ease-out ${mode === 'play' ? 'bg-cinnabar-accent text-white font-semibold' : 'text-white/50 hover:text-white/70'}`}>Play</button>
            <button onClick={() => setMode('edit')}
              className={`text-[11px] px-3 py-1.5 rounded-[calc(9999px-2px)] touch-manipulation transition-[color,background-color] duration-150 ease-out ${mode === 'edit' ? 'bg-cinnabar-accent text-white font-semibold' : 'text-white/50 hover:text-white/70'}`}>Edit</button>
          </div>
          <button onClick={() => onSettings?.()} className="shrink-0 min-h-11 min-w-11 px-2 text-white/40 hover:text-white text-xs touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]">Settings</button>
        </div>
      </header>

      {mode === 'play' && (isJapanese || hasTranslation) && (
        <div className={[modeToolbarRow, 'flex items-center justify-between gap-3'].join(' ')}>
          <p className="text-[11px] text-white/40 text-pretty">Lyrics display</p>
          <DisplayMenu
            isJapanese={isJapanese}
            hasTranslation={hasTranslation}
            furiganaMode={furiganaMode}
            showTranslation={showTranslation}
            lyricsLayout={lyricsLayout}
            wordPairColoringAvailable={getDeviceTier() !== 'manual'}
            onFuriganaCycle={cycleFurigana}
            onToggleTranslation={() => setShowTranslation(!showTranslation)}
            onToggleLayout={() => setLyricsLayout(lyricsLayout === 'sideBySide' ? 'stacked' : 'sideBySide')}
          />
        </div>
      )}

      {/* YouTube — audio only (kept mounted off-screen so it keeps playing) */}
      {isYouTube && (
        <YouTubePlayer
          ref={ytRef}
          videoId={ytVideoId}
          startSeconds={currentSongId === songId ? position : 0}
          audioOnly
        />
      )}

      {/* Main: lyrics + controls. Controls dock to the bottom on mobile, sidebar on md+. */}
      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div className="flex flex-1 min-h-0 flex-col min-w-0">
          {mode === 'play' ? (
            <LyricDisplay
              abLoop={abLoop}
              position={position}
              onLineClick={(line) => {
              if (armingAB) {
                const t = abEndpointFromLine(armingAB, line, abLoop.a)
                setABLoop({ [armingAB]: t })
                seek(t)
              } else {
                const idx = useLyricsStore.getState().lines.indexOf(line)
                if (idx >= 0) useLyricsStore.setState({ activeLine: idx })
                seek(line.startTime)
              }
            }} />
          ) : (
            <EditMode
              lines={lines}
              playhead={() => (isYouTube ? position : engine.position)}
              playheadPosition={position}
              seek={seek}
              onScrubStart={onScrubStart}
              onScrubEnd={onScrubEnd}
              hasAudio={hasAudio}
              title={song?.title ?? ''}
              artist={song?.artist ?? ''}
              sourceLanguage={song?.lyrics.sourceLanguage ?? 'ja'}
              onChangeLines={handleEditLines}
              onAutoAlign={() => beginAlignment('auto')}
            />
          )}
        </div>

        <PlayerControls
          mode={mode}
          playbackState={playbackState}
          position={position}
          duration={duration}
          progress={progress}
          speed={speed}
          speedPct={speedPct}
          volume={volume}
          volumePct={volumePct}
          onSpeedChange={(s) => {
            setSpeed(s)
            if (isYouTube) ytRef.current?.setRate(s)
            else engine.setRate(s)
          }}
          onVolumeChange={(v) => {
            setVolume(v)
            if (isYouTube) ytRef.current?.setVolume(v)
            else engine.setVolume(v)
          }}
          abLoop={abLoop}
          armingAB={armingAB}
          abLoopError={abLoopError}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onToggleArm={toggleArm}
          onClearAB={() => setABLoop({ a: null, b: null })}
          showAbExport={hasAudio && mode === 'play' && isValidABPair(abLoop.a, abLoop.b)}
          onExportAb={handleExportAbLoop}
          abExporting={abExporting}
          abExportError={abExportError}
          abExportCanIncludeSrt={abExportCanIncludeSrt}
          abExportIncludeSrt={abExportIncludeSrt}
          onAbExportIncludeSrtChange={setAbExportIncludeSrt}
          showRealign={!!song?.audioStoredPath && mode === 'play'}
          onRealign={() => beginAlignment(manualAlignMode(getDeviceTier()))}
        />
      </div>

      {song && alignMode === 'auto' && (
        <Suspense fallback={
          <LoadingOverlay message="Loading AI…" detail="Preparing auto-align tools" />
        }>
          <AutoAlignFlow
            song={song}
            autoStart={autoAlignOnOpen}
            onComplete={applyAlignedSong}
            onClose={() => setAlignMode(null)}
          />
        </Suspense>
      )}

    </div>
  )
}
