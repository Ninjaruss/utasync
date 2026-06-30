import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useToast } from '../core/ui/Toast'
import { usePlayerStore } from './PlayerStore'
import { useLyricsStore } from '../lyrics/LyricsStore'
import { AudioEngine } from './AudioEngine'
import { LyricDisplay } from '../lyrics/LyricDisplay'
import { db } from '../core/db/schema'
import { YouTubePlayer, type YouTubePlayerHandle } from './YouTubePlayer'
import { youtubeErrorMessage, youtubeNeedsVisibleEmbed } from './youtubeEmbedPolicy'
import { resolveYouTubeVideoId } from '../sources/youtube'
import { ABLoopController } from './ABLoop'
import type { Song, TimedLine, Language, TimedTranscriptWord, SungPhrase, LineAlignmentQuality } from '../core/types'
import { enrichPhraseTokens } from '../lyrics/phraseEnrichment'
import { projectPhraseTokensToLines } from '../lyrics/phraseProjection'
import { repairPhraseTranslationOrder } from '../lyrics/phraseNormalize'
import {
  refineAlignmentWithPhrases,
  sheetRowsForAlignment,
  applyRefinedAlignment,
  shouldRefineStoredAlignment,
  transcriptWordsToAlignInput,
  realignSection,
  realignAllWeakSections,
} from '../lyrics/phraseAlignment'
import { summarizePhraseChanges, applySungLayout, revertToSheetLayout } from '../lyrics/phraseLayout'
import { tokenizeJapanese } from '../language/japanese/tokenizer'
import { toRomaji, toFurigana } from '../language/japanese/phonetics'
import { detectGrammarPatterns } from '../language/japanese/grammar'
import { tokenizeEnglish } from '../language/english/tokenizer'
import { sentenceToIPA } from '../language/english/phonetics'
import { detectEnglishGrammar } from '../language/english/grammar'
import { TapSyncEditor } from './TapSyncEditor'
import { getDeviceTier } from '../ai-pipeline/capability'
import { suggestsWordLevelAlignment } from '../ai-pipeline/alignTimestampMode'
import { linesAreTimed, chooseAutoAlignment, type AlignMode } from './alignmentPolicy'
import { EditMode } from '../lyrics/EditMode'
import { computeSyncState } from '../core/db/migrations'
import { hasVisibleTranslation } from '../lyrics/bilingual'
import { linesNeedEnrichment, linesNeedAlignment, lineNeedsAlignment, enrichmentMadeProgress, LYRICS_ENRICHMENT_VERSION } from '../lyrics/lyricsEnrichment'
import { runWhenIdle, yieldToMainThread } from '../core/idle'
import { alignLinesTokens, countEmbedBatches } from '../ai-pipeline/wordAligner'
import { preloadGlossLexicon } from '../ai-pipeline/lyricGloss'
import { preloadEmbedder } from '../ai-pipeline/textEmbedder'
import { buildAlignJobs } from '../lyrics/lineAligner'
import { reconcileLinesReadingsAsync, reconcileLineReadingsAsync } from '../ai-pipeline/readingReconciler'
import { fixAdjacentTranslationOrder } from '../ai-pipeline/translationOrder'
import { LoadingOverlay } from '../core/ui/LoadingOverlay'
import { linePlaybackStart } from '../lyrics/lineTiming'
import { abPairError, abLoopPatchFromLineTap, isValidABPair } from './abLoopUtils'
import { exportAbLoopClip, exportAbLoopPlaylistClip, abLoopHasTimedLyrics, abLoopPlaylistHasTimedLyrics, getValidPlaylistExportSegments, lyricHintForAbLoop } from './abLoopExport'
import { createPlaylistEntry, shouldAdvancePlaylistAfterCycle, wrapPlaylistIndex } from './abLoopPlaylist'
import { useAbLoopPlaylistStore } from './abLoopPlaylistStore'
import { getAudioFile } from '../core/opfs/audio'
import { PlayerControls } from './PlayerControls'
import { DisplayMenu } from './DisplayMenu'
import { YouTubePlaybackPanel } from './YouTubePlaybackPanel'
import { LyricsImportPanel } from '../lyrics/LyricsImportPanel'
import { attachAudioToSong } from '../sources/audioIngest'
import { resolveCoverArt } from '../sources/coverArt'
import { inferSourceLanguage } from '../sources/lyricsResolver'
import { WordColorProgressBanner } from './WordColorProgressBanner'
import { PlayEditToggle } from './PlayEditToggle'
import { ConfirmDialog } from '../core/ui/ConfirmDialog'
import { useConfirmedClose } from '../core/ui/useConfirmedClose'
import { displayToolbarRow } from '../core/ui/toolbarClasses'

const AutoAlignFlow = lazy(() => import('../ai-pipeline/AutoAlignFlow'))

/** Lines tokenized per slice so kuromoji work does not monopolize the main thread. */
const ENRICH_LINES_BATCH = 4
/** Pause between word-alignment chunks (ms). */
const ALIGN_CHUNK_YIELD_MS = 48

async function enrichLines(
  lines: TimedLine[],
  sourceLanguage: Language,
  transcriptWords?: TimedTranscriptWord[],
): Promise<TimedLine[]> {
  const enriched: TimedLine[] = []
  for (let i = 0; i < lines.length; i += ENRICH_LINES_BATCH) {
    const batch = lines.slice(i, i + ENRICH_LINES_BATCH)
    const batchResult = await Promise.all(batch.map(async (line): Promise<TimedLine> => {
      try {
        if (sourceLanguage === 'ja') {
          const [tokens, reading, furigana] = await Promise.all([
            tokenizeJapanese(line.original),
            toRomaji(line.original),
            toFurigana(line.original),
          ])
          const grammarAnnotations = detectGrammarPatterns(line.original, tokens)
          let withTokens: TimedLine = { ...line, tokens, reading, furigana, grammarAnnotations }
          if (transcriptWords?.length) {
            withTokens = await reconcileLineReadingsAsync(withTokens, transcriptWords)
          }
          return withTokens
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
    enriched.push(...batchResult)
    if (i + ENRICH_LINES_BATCH < lines.length) await yieldToMainThread(16)
  }
  return enriched
}

/**
 * Phase 2/2.3: enrich on the canonical sung phrases (which see the correct
 * transcript window and sung unit even when the paste split a sung breath across
 * rows) — tokenize, reconcile readings, then word-pair align per phrase — and
 * project the results back onto the display rows. Word-pair `alignmentIndices` are
 * re-expressed in each row's own translation space; cross-row links (EN on an
 * adjacent row) are dropped under the default sheet layout. Grammar is recomputed
 * from the projected tokens so indices stay valid. Passthrough rows resolve
 * identically to the line path; only merged/split rows change.
 */
async function enrichLinesViaPhrases(
  lines: TimedLine[],
  phrases: SungPhrase[],
  transcriptWords: TimedTranscriptWord[],
  onAlignProgress?: (done: number, total: number) => void,
): Promise<TimedLine[]> {
  const tokenized = await enrichPhraseTokens(phrases, transcriptWords, {
    tokenizePhrase: tokenizeJapanese,
    reconcilePhraseReadings: async (phrase, words) =>
      (await reconcileLineReadingsAsync(phrase, words)).tokens ?? [],
  })
  // With tokens now present, the re-pair detector can correct adjacent phrases
  // whose EN clauses were front-loaded onto the wrong sung unit.
  let enrichedPhrases = repairPhraseTranslationOrder(tokenized)

  // Word-pair the sung phrases with the same batched embedder as the line path,
  // so each clause aligns within its own scope (the split-row win). Degrades to
  // no coloring on embedder failure without losing the readings above.
  if (canRunWordAlignment() && wantsWordPairColoring()) {
    try {
      const aligned = await enrichAlignment(enrichedPhrases as TimedLine[], onAlignProgress)
      enrichedPhrases = enrichedPhrases.map((p, i) => ({ ...p, tokens: aligned[i].tokens }))
    } catch {
      /* word coloring unavailable; keep readings */
    }
  }

  const projected = projectPhraseTokensToLines(lines, enrichedPhrases)
  return projected.map((line) =>
    line.tokens?.length
      ? { ...line, grammarAnnotations: detectGrammarPatterns(line.original, line.tokens) }
      : line,
  )
}

/** Max texts per embed call — limits peak WebGPU / WASM memory per batch. */
const LITE_EMBED_BATCH_TEXTS = 64
const FULL_EMBED_BATCH_TEXTS = 96
/** Lines processed per chunk so the UI can breathe between batches. */
const LITE_ALIGN_LINES_PER_CHUNK = 4
const FULL_ALIGN_LINES_PER_CHUNK = 8

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
    const linesPerChunk = tier === 'lite' ? LITE_ALIGN_LINES_PER_CHUNK : FULL_ALIGN_LINES_PER_CHUNK
    const maxTextsPerBatch = tier === 'lite' ? LITE_EMBED_BATCH_TEXTS : FULL_EMBED_BATCH_TEXTS
    const updated = [...lines]
    const totalLines = indices.length

    let totalEmbedBatches = 0
    for (let chunkStart = 0; chunkStart < indices.length; chunkStart += linesPerChunk) {
      const overlapStart = chunkStart > 0 ? chunkStart - 1 : chunkStart
      const chunkEnd = Math.min(chunkStart + linesPerChunk, indices.length)
      const chunkIndices = indices.slice(overlapStart, chunkEnd)
      const jobs = buildAlignJobs(lines, chunkIndices)
      totalEmbedBatches += countEmbedBatches(jobs, maxTextsPerBatch)
    }

    const useEmbedBatchProgress = totalEmbedBatches > 1
    let lineChunksDone = 0
    let embedBatchesDone = 0
    onProgress?.(0, useEmbedBatchProgress ? totalEmbedBatches : totalLines)

    for (let start = 0; start < indices.length; start += linesPerChunk) {
      const overlapStart = start > 0 ? start - 1 : start
      const chunkEnd = Math.min(start + linesPerChunk, indices.length)
      const chunkIndices = indices.slice(overlapStart, chunkEnd)
      const jobs = buildAlignJobs(lines, chunkIndices)
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
        lineChunksDone += chunkEnd - start
        onProgress?.(lineChunksDone, totalLines)
      }
      if (tier === 'lite' && start + linesPerChunk < indices.length) {
        await yieldToMainThread(ALIGN_CHUNK_YIELD_MS)
      } else if (start + linesPerChunk < indices.length) {
        await yieldToMainThread(24)
      }
    }
    return updated
  } catch (e) {
    console.warn('word alignment failed', e)
    throw e
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

function wantsWordPairColoring(): boolean {
  const { showTranslation, lyricsLayout } = useLyricsStore.getState()
  return showTranslation || lyricsLayout === 'sideBySide'
}

function canRunWordAlignment(): boolean {
  return getDeviceTier() !== 'manual'
}

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
  const toast = useToast()
  const engineRef = useRef<AudioEngine | null>(null)
  if (engineRef.current === null) engineRef.current = new AudioEngine()
  const engine = engineRef.current
  const abLoopControllerRef = useRef<ABLoopController | null>(null)
  const ytRef = useRef<YouTubePlayerHandle>(null)
  // Tracks whether timestamp-scrubbing started playback, so onScrubEnd only
  // stops audio it itself started (leaves pre-existing playback alone).
  const scrubStartedPlayRef = useRef(false)
  const { playbackState, position, duration, speed, volume, abLoop, armingAB, currentSongId, setPlaybackState, setPosition, setDuration, setSpeed, setVolume, setABLoop, armAB, setCurrentSong } = usePlayerStore()
  const { lines, syncPosition, setLines, furiganaMode, showTranslation, lyricsLayout, setFuriganaMode, setShowTranslation, setLyricsLayout } = useLyricsStore()
  const [song, setSong] = useState<Song | null>(null)
  const [alignMode, setAlignMode] = useState<AlignMode | null>(null)
  const [alignAccurateReadings, setAlignAccurateReadings] = useState(false)
  const [accurateReadingsDismissed, setAccurateReadingsDismissed] = useState(false)
  const [mode, setMode] = useState<'play' | 'edit'>('play')
  const [lyricsLoading, setLyricsLoading] = useState<{ message: string; detail?: string } | null>(null)
  const [wordColorProgress, setWordColorProgress] = useState<{ done: number; total: number } | null>(null)
  const [abExporting, setAbExporting] = useState(false)
  const [abExportKind, setAbExportKind] = useState<'loop' | 'playlist' | null>(null)
  const [abExportError, setAbExportError] = useState('')
  const [abExportIncludeSrt, setAbExportIncludeSrt] = useState(false)
  const [attachingAudio, setAttachingAudio] = useState(false)
  const [attachAudioError, setAttachAudioError] = useState('')
  const [localAudioLoadFailed, setLocalAudioLoadFailed] = useState(false)
  const [showLyricsReimport, setShowLyricsReimport] = useState(false)
  const [phrasingBusy, setPhrasingBusy] = useState(false)
  const [localRealigning, setLocalRealigning] = useState<Set<number>>(new Set())
  const {
    setBusy: setLyricsReimportBusy,
    confirming: confirmLyricsReimportClose,
    requestClose: requestLyricsReimportClose,
    confirm: confirmLyricsReimportCloseNow,
    cancel: cancelLyricsReimportClose,
  } = useConfirmedClose(() => setShowLyricsReimport(false))
  const seekRef = useRef<(time: number) => void>(() => {})
  const enrichmentJobRef = useRef(0)
  const wordColorJobRef = useRef(0)
  const playlistCyclesRef = useRef(0)
  const onLoopCycleRef = useRef<() => void>(() => {})
  const {
    playlists,
    playlistActive,
    playlistIndex,
    playlistRepeatCount,
    addEntry,
    removeEntry,
    renameEntry,
    moveEntry,
    clearPlaylist,
    setPlaylistActive,
    setPlaylistIndex,
    setPlaylistRepeatCount,
    resetSession,
  } = useAbLoopPlaylistStore()
  const playlistEntries = playlists[songId] ?? []
  const speedPct = Math.round(speed * 100)
  const volumePct = Math.round(volume * 100)

  const runWordColoring = async (lines: TimedLine[]) => {
    const ordered = fixAdjacentTranslationOrder(lines)
    const total = ordered.filter(lineNeedsAlignment).length
    if (total === 0 || !canRunWordAlignment()) return ordered
    const jobId = ++wordColorJobRef.current
    setWordColorProgress({ done: 0, total })
    try {
      const result = await enrichAlignment(ordered, (done, t) => {
        if (wordColorJobRef.current === jobId) setWordColorProgress({ done, total: t })
      })
      return wordColorJobRef.current === jobId ? result : ordered
    } catch {
      toast('Word coloring unavailable — embedding model could not load', 'warning')
      return ordered
    } finally {
      if (wordColorJobRef.current === jobId) setWordColorProgress(null)
    }
  }

  const runLyricsEnrichment = async (
    lines: TimedLine[],
    sourceLanguage: Language,
    enrichmentVersion?: number,
    transcriptWords?: TimedTranscriptWord[],
    phrases?: SungPhrase[],
  ) => {
    let enriched = lines
    if (linesNeedEnrichment(lines, enrichmentVersion)) {
      setLyricsLoading({ message: 'Normalizing lyrics…', detail: 'Tokenizing and adding readings' })
      try {
        enriched = await enrichLines(lines, sourceLanguage, transcriptWords)
      } finally {
        setLyricsLoading(null)
      }
    } else if (transcriptWords?.length && sourceLanguage === 'ja') {
      enriched = await reconcileLinesReadingsAsync(lines, transcriptWords)
    }
    // Phase 2: prefer phrase-level reconciliation when a canonical phrase layer
    // exists; falls back silently to the line-based readings above on any error.
    if (phrases?.length && transcriptWords?.length && sourceLanguage === 'ja') {
      const jobId = ++wordColorJobRef.current
      try {
        enriched = await enrichLinesViaPhrases(enriched, phrases, transcriptWords, (done, total) => {
          if (wordColorJobRef.current === jobId) setWordColorProgress({ done, total })
        })
      } catch {
        /* keep line-based enrichment */
      } finally {
        if (wordColorJobRef.current === jobId) setWordColorProgress(null)
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

  const deferBackgroundEnrichment = (base: Song, linesToProcess: TimedLine[], isCancelled: () => boolean) => {
    if (!canRunWordAlignment() || !linesAreTimed(linesToProcess) || !wantsWordPairColoring()) return () => {}
    const needsEnrich = linesNeedEnrichment(linesToProcess, base.lyrics.enrichmentVersion)
    const needsAlign = linesNeedAlignment(linesToProcess, base.lyrics.enrichmentVersion)
    if (!needsEnrich && !needsAlign) return () => {}

    const jobId = ++enrichmentJobRef.current
    return runWhenIdle(() => {
      if (isCancelled() || enrichmentJobRef.current !== jobId) return
      const persistIfProgress = (enriched: TimedLine[]) => {
        if (
          !isCancelled()
          && enrichmentJobRef.current === jobId
          && enrichmentMadeProgress(linesToProcess, enriched, base.lyrics.enrichmentVersion)
        ) {
          void persistEnrichedLines(base, enriched, true)
        }
      }
      if (needsEnrich) {
        runLyricsEnrichment(
          linesToProcess,
          base.lyrics.sourceLanguage,
          base.lyrics.enrichmentVersion,
          base.lyrics.transcriptWords,
          base.lyrics.phrases,
        )
          .then(persistIfProgress)
      } else {
        runAlignmentOnly(linesToProcess).then(persistIfProgress)
      }
    }, 6000)
  }

  useEffect(() => {
    let cancelled = false
    let cancelIdle = () => {}
    enrichmentJobRef.current++
    db.songs.get(songId).then(async (s) => {
      if (!s || cancelled) return
      let loaded = s
      if (shouldRefineStoredAlignment(s.lyrics)) {
        try {
          const sheetRows = sheetRowsForAlignment(s.lyrics)
          const refined = refineAlignmentWithPhrases(
            sheetRows,
            transcriptWordsToAlignInput(s.lyrics.transcriptWords),
            s.lyrics.sourceLanguage,
            s.lyrics,
          )
          if (refined.phrases.length && !cancelled) {
            loaded = { ...s, lyrics: applyRefinedAlignment(s.lyrics, refined) }
            await db.songs.put(loaded)
          }
        } catch {
          /* leave alignment as-is; playback still works */
        }
      }
      setSong(loaded)
      setLines(loaded.lyrics.lines)
      setLocalAudioLoadFailed(false)
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
            setDuration(Math.max(engine.duration, 0))
            engine.setVolume(usePlayerStore.getState().volume)
            if (resumeAt > 0) {
              engine.seek(resumeAt)
              setPosition(resumeAt)
              syncPosition(resumeAt)
            }
          }
        } catch {
          if (!cancelled) setLocalAudioLoadFailed(true)
        }
      }
      const willAutoAlign = autoAlignOnOpen
        && chooseAutoAlignment(!!s.audioStoredPath, s.lyrics.lines, getDeviceTier(), true, s.lyrics.alignmentMode) !== null
      if (!willAutoAlign) {
        cancelIdle = deferBackgroundEnrichment(loaded, loaded.lyrics.lines, () => cancelled)
      }
    })
    return () => {
      cancelled = true
      enrichmentJobRef.current++
      cancelIdle()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId])

  useEffect(() => {
    if (canRunWordAlignment()) {
      preloadGlossLexicon()
      preloadEmbedder()
    }
  }, [])

  useEffect(() => {
    resetSession()
    playlistCyclesRef.current = 0
  }, [songId, resetSession])

  useEffect(() => {
    if (!song || !canRunWordAlignment() || !wantsWordPairColoring() || !linesNeedAlignment(lines, song.lyrics.enrichmentVersion)) return
    const cancel = deferBackgroundEnrichment(song, lines, () => false)
    return cancel
  // Intentionally omit `lines` — pairing/edit handlers run alignment directly; this
  // effect only re-queues when translation display toggles or the song changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTranslation, lyricsLayout, song?.id])

  useEffect(() => {
    const e = engine
    e.onTimeUpdate((pos) => {
      setPosition(pos)
      syncPosition(pos)
    })
    e.onEnd(() => setPlaybackState('idle'))

    abLoopControllerRef.current = new ABLoopController(
      (t) => seekRef.current(t),
      () => usePlayerStore.getState().abLoop,
      () => usePlayerStore.getState().position,
      () => onLoopCycleRef.current(),
    )

    return () => {
      e.destroy()
      abLoopControllerRef.current?.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    abLoopControllerRef.current?.tick()
  }, [position])

  const ytVideoId = song ? resolveYouTubeVideoId(song) : null
  const hasStoredAudio = !!song?.audioStoredPath
  const localAudioPlayable = hasStoredAudio && !localAudioLoadFailed
  const isYouTube = !!ytVideoId && !localAudioPlayable
  const canPlayback = isYouTube || localAudioPlayable
  const showYouTubeVideo = youtubeNeedsVisibleEmbed()
  const lyricsUntimed = lines.length > 0 && !linesAreTimed(lines)
  const onYouTubeError = (code: number) => toast(youtubeErrorMessage(code), 'warning')

  const togglePlay = () => {
    if (!canPlayback) return
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
    abLoopControllerRef.current?.syncPosition(time)
  }
  useEffect(() => {
    seekRef.current = seek
  })

  /** Stops loop playlist + manual A/B loop so the user can navigate freely. */
  const interruptPracticeLoops = () => {
    if (useAbLoopPlaylistStore.getState().playlistActive) {
      setPlaylistActive(false)
      playlistCyclesRef.current = 0
    }
    const { abLoop: loop } = usePlayerStore.getState()
    if (isValidABPair(loop.a, loop.b)) {
      setABLoop({ a: null, b: null })
    }
  }

  /** Jump to a lyric by index; sets activeLine directly so untimed lines still highlight correctly. */
  const goToLyricLine = (index: number) => {
    const lyricLines = useLyricsStore.getState().lines
    if (index < 0 || index >= lyricLines.length) return
    interruptPracticeLoops()
    useLyricsStore.setState({ activeLine: index })
    seek(linePlaybackStart(lyricLines[index]))
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

  const pausePlayback = () => {
    if (isYouTube) ytRef.current?.pause()
    else engine.pause()
    if (usePlayerStore.getState().playbackState === 'playing') {
      setPlaybackState('paused')
    }
  }

  const beginAlignment = (mode: AlignMode, accurateReadings = false) => {
    setAlignAccurateReadings(accurateReadings)
    if (mode === 'tap') {
      if (isYouTube) ytRef.current?.play()
      else engine.play()
      setPlaybackState('playing')
    } else {
      pausePlayback()
    }
    setAlignMode(mode)
  }

  useEffect(() => {
    if (!song || !autoAlignOnOpen) return
    const choice = chooseAutoAlignment(!!song.audioStoredPath, song.lyrics.lines, getDeviceTier(), canPlayback, song.lyrics.alignmentMode)
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
      const before = updated.lyrics.lines
      runLyricsEnrichment(
        before,
        updated.lyrics.sourceLanguage,
        updated.lyrics.enrichmentVersion,
        updated.lyrics.transcriptWords,
        updated.lyrics.phrases,
      )
        .then((enriched) => {
          if (enrichmentMadeProgress(before, enriched, updated.lyrics.enrichmentVersion)) {
            void persistEnrichedLines(updated, enriched, true)
          }
        })
    }, yieldMs)
  }

  // Switch the rendered rows to the canonical sung phrases (Phase 3, D1 opt-in).
  // The phrase rows already carry reconciled tokens; re-run enrichment so each new
  // row gets its own furigana/grammar, then persist with the sheet snapshot intact.
  const applySungPhrasing = async () => {
    if (!song?.lyrics.phrases?.length || phrasingBusy) return
    setPhrasingBusy(true)
    try {
      const applied = applySungLayout(song.lyrics)
      const base: Song = { ...song, lyrics: applied }
      await db.songs.put(base)
      setSong(base)
      setLines(applied.lines)
      const enriched = await runLyricsEnrichment(
        applied.lines,
        applied.sourceLanguage,
        applied.enrichmentVersion,
        applied.transcriptWords,
      )
      await persistEnrichedLines(base, enriched, true)
    } finally {
      setPhrasingBusy(false)
    }
  }

  const restoreSheetPhrasing = async () => {
    if (!song?.lyrics.sheetLinesSnapshot || phrasingBusy) return
    setPhrasingBusy(true)
    try {
      const reverted = revertToSheetLayout(song.lyrics)
      const base: Song = { ...song, lyrics: reverted }
      await db.songs.put(base)
      setSong(base)
      setLines(reverted.lines)
    } finally {
      setPhrasingBusy(false)
    }
  }

  const handleTapComplete = async (lines: TimedLine[]) => {
    if (!song) return
    const updated: Song = {
      ...song,
      lyrics: { ...song.lyrics, lines },
      syncState: computeSyncState({ ...song, lyrics: { ...song.lyrics, lines } }),
    }
    await db.songs.put(updated)
    applyAlignedSong(updated)
  }

  const handleEditLines = async (lines: TimedLine[]) => {
    if (!song) return
    setLines(lines)
    const timingChanged = lines.some(
      (l, i) =>
        l.startTime !== song.lyrics.lines[i]?.startTime
        || l.endTime !== song.lyrics.lines[i]?.endTime,
    )
    const updated: Song = {
      ...song,
      lyrics: {
        ...song.lyrics,
        lines,
        enrichmentVersion: undefined,
        ...(timingChanged ? { lineAlignmentQuality: undefined } : {}),
      },
      syncState: computeSyncState({ ...song, lyrics: { ...song.lyrics, lines } }),
    }
    setSong(updated)
    await db.songs.put(updated)
    if (linesNeedEnrichment(lines, updated.lyrics.enrichmentVersion)) {
      enrichLines(lines, song.lyrics.sourceLanguage, song.lyrics.transcriptWords)
        .then(runWordColoring)
        .then((enriched) => {
          if (
            enriched.length === lines.length
            && enrichmentMadeProgress(lines, enriched, updated.lyrics.enrichmentVersion)
          ) {
            void persistEnrichedLines(updated, enriched, true)
          }
        })
    } else if (linesNeedAlignment(lines, updated.lyrics.enrichmentVersion) && canRunWordAlignment()) {
      runWordColoring(lines)
        .then((enriched) => {
          if (enriched.length === lines.length && enrichmentMadeProgress(lines, enriched, updated.lyrics.enrichmentVersion)) {
            void persistEnrichedLines(updated, enriched, true)
          }
        })
    }
  }

  const handleLocalRealign = async (lineIndex: number) => {
    if (!song?.lyrics.transcriptWords?.length) return
    setLocalRealigning((prev) => new Set([...prev, lineIndex]))
    try {
      const words = transcriptWordsToAlignInput(song.lyrics.transcriptWords)
      const { lines, lineAlignmentQuality, anchorSources } = realignSection(
        song.lyrics.lines,
        lineIndex,
        words,
        song.lyrics.lineAlignmentQuality ?? song.lyrics.lines.map(() => 'needs_review' as LineAlignmentQuality),
        song.lyrics.sourceLanguage,
        song.lyrics.anchorSources as Parameters<typeof realignSection>[5],
      )
      const updated: Song = {
        ...song,
        lyrics: {
          ...song.lyrics,
          lines,
          lineAlignmentQuality,
          anchorSources: anchorSources as Song['lyrics']['anchorSources'],
          enrichmentVersion: undefined,
        },
        syncState: computeSyncState({ ...song, lyrics: { ...song.lyrics, lines } }),
      }
      setSong(updated)
      setLines(lines)
      await db.songs.put(updated)
      if (linesNeedEnrichment(lines, updated.lyrics.enrichmentVersion)) {
        enrichLines(lines, song.lyrics.sourceLanguage, song.lyrics.transcriptWords)
          .then(runWordColoring)
          .then((enriched) => {
            if (
              enriched.length === lines.length
              && enrichmentMadeProgress(lines, enriched, updated.lyrics.enrichmentVersion)
            ) {
              void persistEnrichedLines(updated, enriched, true)
            }
          })
      } else if (linesNeedAlignment(lines, updated.lyrics.enrichmentVersion) && canRunWordAlignment()) {
        runWordColoring(lines)
          .then((enriched) => {
            if (enriched.length === lines.length && enrichmentMadeProgress(lines, enriched, updated.lyrics.enrichmentVersion)) {
              void persistEnrichedLines(updated, enriched, true)
            }
          })
      }
    } finally {
      setLocalRealigning((prev) => {
        const next = new Set(prev)
        next.delete(lineIndex)
        return next
      })
    }
  }

  const handleRealignAllWeak = async () => {
    if (!song?.lyrics.transcriptWords?.length) return
    if (!song.lyrics.lineAlignmentQuality?.length) return
    const words = transcriptWordsToAlignInput(song.lyrics.transcriptWords)
    await yieldToMainThread()
    const { lines, lineAlignmentQuality, anchorSources } = realignAllWeakSections(
      song.lyrics.lines,
      words,
      song.lyrics.lineAlignmentQuality,
      song.lyrics.sourceLanguage,
      song.lyrics.anchorSources as Parameters<typeof realignAllWeakSections>[4],
    )
    const updated: Song = {
      ...song,
      lyrics: {
        ...song.lyrics,
        lines,
        lineAlignmentQuality,
        anchorSources: anchorSources as Song['lyrics']['anchorSources'],
        enrichmentVersion: undefined,
      },
      syncState: computeSyncState({ ...song, lyrics: { ...song.lyrics, lines } }),
    }
    setSong(updated)
    setLines(lines)
    await db.songs.put(updated)
    if (linesNeedEnrichment(lines, updated.lyrics.enrichmentVersion)) {
      enrichLines(lines, song.lyrics.sourceLanguage, song.lyrics.transcriptWords)
        .then(runWordColoring)
        .then((enriched) => {
          if (
            enriched.length === lines.length
            && enrichmentMadeProgress(lines, enriched, updated.lyrics.enrichmentVersion)
          ) {
            void persistEnrichedLines(updated, enriched, true)
          }
        })
    } else if (linesNeedAlignment(lines, updated.lyrics.enrichmentVersion) && canRunWordAlignment()) {
      runWordColoring(lines)
        .then((enriched) => {
          if (enriched.length === lines.length && enrichmentMadeProgress(lines, enriched, updated.lyrics.enrichmentVersion)) {
            void persistEnrichedLines(updated, enriched, true)
          }
        })
    }
  }

  const progress = duration > 0 ? Math.min(1, position / duration) : 0
  const isJapanese = song?.lyrics.sourceLanguage === 'ja'
  const weakLineCount = song?.lyrics.lineAlignmentQuality?.filter(
    (q) => q === 'needs_review' || q === 'approximate',
  ).length ?? 0
  const hasTranslation = !!song?.lyrics.lines.some(hasVisibleTranslation)

  const sungLayoutActive = song?.lyrics.phraseLayout === 'sung'
  const phraseSheetRows = sungLayoutActive ? (song?.lyrics.sheetLinesSnapshot ?? []) : (song?.lyrics.lines ?? [])
  const phraseChanges =
    song?.lyrics.phrases?.length ? summarizePhraseChanges(phraseSheetRows, song.lyrics.phrases) : []

  // The segment-mode transcript grouped multiple lines into shared chunks, so
  // per-line timing is approximate — offer the word-level re-align for tighter sync.
  const suggestWordLevelAlign =
    !!song
    && suggestsWordLevelAlignment(song.lyrics.lines, song.lyrics.transcriptWords, getDeviceTier())
    && hasStoredAudio

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
        interruptPracticeLoops()
        const pos = usePlayerStore.getState().position
        seek(Math.max(0, pos - SEEK_STEP_SEC))
        return
      }

      if (e.code === 'ArrowRight' || e.key === 'ArrowRight') {
        e.preventDefault()
        interruptPracticeLoops()
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

  const applyPlaylistEntry = (entry: { a: number; b: number }, index: number) => {
    setABLoop({ a: entry.a, b: entry.b })
    setPlaylistIndex(index)
    playlistCyclesRef.current = 0
    seek(entry.a)
  }

  useEffect(() => {
    onLoopCycleRef.current = () => {
      const state = useAbLoopPlaylistStore.getState()
      if (!state.playlistActive) return
      const entries = state.playlists[songId] ?? []
      if (entries.length === 0) return

      playlistCyclesRef.current += 1
      const repeatCount = state.playlistRepeatCount
      if (!shouldAdvancePlaylistAfterCycle(playlistCyclesRef.current, repeatCount)) return

      playlistCyclesRef.current = 0
      const nextIndex = wrapPlaylistIndex(state.playlistIndex, entries.length)
      applyPlaylistEntry(entries[nextIndex], nextIndex)
    }
  })

  const handleSaveToPlaylist = () => {
    if (!isValidABPair(abLoop.a, abLoop.b)) return
    const hint = song ? lyricHintForAbLoop(song.lyrics.lines, abLoop.a!, abLoop.b!) : null
    addEntry(songId, createPlaylistEntry(abLoop.a!, abLoop.b!, hint ?? undefined))
  }

  const handleTogglePlaylist = () => {
    if (playlistActive) {
      setPlaylistActive(false)
      playlistCyclesRef.current = 0
      setABLoop({ a: null, b: null })
      return
    }
    if (playlistEntries.length === 0) return
    setPlaylistActive(true)
    applyPlaylistEntry(playlistEntries[0], 0)
  }

  const handleLoadPlaylistEntry = (entry: { id: string; a: number; b: number }, index: number) => {
    applyPlaylistEntry(entry, index)
  }

  const abExportCanIncludeSrt = !!(
    song
    && (
      (isValidABPair(abLoop.a, abLoop.b)
        && abLoopHasTimedLyrics(song.lyrics.lines, abLoop.a!, abLoop.b!))
      || abLoopPlaylistHasTimedLyrics(song.lyrics.lines, playlistEntries)
    )
  )
  const validPlaylistExportEntries = getValidPlaylistExportSegments(playlistEntries)
  const showPlaylistExport = localAudioPlayable && validPlaylistExportEntries.length > 0

  const handleAttachLocalAudio = async (file: File) => {
    if (!song) return
    setAttachAudioError('')
    setAttachingAudio(true)
    try {
      const { audioStoredPath } = await attachAudioToSong(song.id, file)
      const albumArtUrl = await resolveCoverArt({
        title: song.title,
        artist: song.artist,
        audioFile: file,
        youtubeThumbnailUrl: song.albumArtUrl,
      })
      const updated: Song = { ...song, audioStoredPath, ...(albumArtUrl ? { albumArtUrl } : {}) }
      await db.songs.put(updated)
      const audioFile = await getAudioFile(song.id)
      const loadVolume = usePlayerStore.getState().volume
      await engine.load(audioFile, loadVolume)
      setDuration(Math.max(engine.duration, 0))
      engine.setVolume(loadVolume)
      const resumeAt = usePlayerStore.getState().position
      if (resumeAt > 0) {
        engine.seek(resumeAt)
        setPosition(resumeAt)
        syncPosition(resumeAt)
      }
      setSong(updated)
      setLocalAudioLoadFailed(false)
    } catch (e: unknown) {
      setAttachAudioError(e instanceof Error ? e.message : 'Could not add audio file')
    } finally {
      setAttachingAudio(false)
    }
  }

  const handleReplaceLyrics = async (imported: TimedLine[]) => {
    if (!song) return
    setShowLyricsReimport(false)
    const sourceLanguage = inferSourceLanguage(imported)
    const translationLanguage: Language = sourceLanguage === 'ja' ? 'en' : 'ja'
    const updated: Song = {
      ...song,
      lyrics: {
        ...song.lyrics,
        lines: imported,
        sourceLanguage,
        translationLanguage,
        enrichmentVersion: undefined,
        transcriptWords: undefined,
      },
      syncState: computeSyncState({ ...song, lyrics: { ...song.lyrics, lines: imported } }),
    }
    setSong(updated)
    setLines(imported)
    await db.songs.put(updated)
    if (linesNeedEnrichment(imported, undefined)) {
      runLyricsEnrichment(imported, sourceLanguage)
        .then((enriched) => {
          if (enrichmentMadeProgress(imported, enriched, undefined)) {
            void persistEnrichedLines(updated, enriched, true)
          }
        })
    }
  }

  const handleExportAbLoop = async () => {
    if (!song?.audioStoredPath || !isValidABPair(abLoop.a, abLoop.b)) return
    setAbExportError('')
    setAbExportKind('loop')
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
      setAbExportKind(null)
    }
  }

  const handleExportAbLoopPlaylist = async () => {
    if (!song?.audioStoredPath || validPlaylistExportEntries.length === 0) return
    setAbExportError('')
    setAbExportKind('playlist')
    setAbExporting(true)
    try {
      const audioFile = await getAudioFile(song.id)
      await exportAbLoopPlaylistClip({
        audioFile,
        lines: song.lyrics.lines,
        artist: song.artist,
        title: song.title,
        entries: playlistEntries,
        includeSrt: abExportIncludeSrt && abExportCanIncludeSrt,
      })
    } catch (e: unknown) {
      setAbExportError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setAbExporting(false)
      setAbExportKind(null)
    }
  }

  if (song && alignMode === 'tap') {
    return (
      <TapSyncEditor
        plainLines={song.lyrics.lines.map((l) => l.original)}
        translations={song.lyrics.lines.map((l) => l.translation)}
        audioPosition={() => position}
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
      {abExporting && (
        <LoadingOverlay
          message={abExportKind === 'playlist' ? 'Exporting loop playlist…' : 'Exporting A-B loop…'}
          detail="Trimming audio and syncing subtitles"
        />
      )}
      {/* Top bar */}
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-cinnabar-900 shrink-0">
        <button onClick={onBack} className="shrink-0 min-h-11 min-w-11 flex items-center justify-center text-white/40 hover:text-white text-xs touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]">← Back</button>
        {song && (
          <div className="flex-1 min-w-0 px-1">
            <p className="text-sm text-white/85 truncate font-medium">{song.title}</p>
            {song.artist && <p className="text-[11px] text-white/35 truncate">{song.artist}</p>}
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <PlayEditToggle mode={mode} onChange={setMode} />
          <button onClick={() => onSettings?.()} className="shrink-0 min-h-11 min-w-11 flex items-center justify-center text-white/40 hover:text-white text-xs touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]">Settings</button>
        </div>
      </header>

      {wordColorProgress && (
        <WordColorProgressBanner done={wordColorProgress.done} total={wordColorProgress.total} />
      )}

      {/* Stored audio failed to load and there is no YouTube fallback: playback is
          disabled, so offer a way to re-attach a file rather than a dead player. */}
      {localAudioLoadFailed && !isYouTube && hasStoredAudio && (
        <div className="shrink-0 px-3 sm:px-4 py-2.5 border-b border-cinnabar-900/80 bg-cinnabar-950/80 flex items-center gap-3">
          <p className="text-[11px] text-amber-400/90 text-pretty leading-snug flex-1">
            Couldn&apos;t load this song&apos;s audio file. {attachAudioError || 'It may be missing or in an unsupported format.'}
          </p>
          <label className="shrink-0 px-2.5 py-1.5 rounded-lg bg-cinnabar-accent text-white text-[11px] font-medium min-h-8 inline-flex items-center touch-manipulation cursor-pointer">
            {attachingAudio ? 'Adding…' : 'Re-attach audio'}
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              disabled={attachingAudio}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleAttachLocalAudio(file)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      )}

      {mode === 'play' && lyricsUntimed && canPlayback && (
        <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-cinnabar-900/80 bg-cinnabar-950/80">
          <p className="text-[11px] text-white/45 text-pretty">
            Lyrics are not timed yet. Open Edit → Tap-through to stamp each line while the song plays
            {hasStoredAudio ? ', or use Auto-align.' : ', or add an audio file for AI align.'}
          </p>
        </div>
      )}

      {mode === 'play' && suggestWordLevelAlign && !accurateReadingsDismissed && (
        <div className="shrink-0 px-3 sm:px-4 py-2.5 border-b border-cinnabar-900/80 bg-cinnabar-950/80 flex items-start gap-3">
          <p className="text-[11px] text-white/55 text-pretty leading-snug flex-1">
            Some lines share one block in the audio analysis, so their timing is approximate.
            Re-align with <span className="text-white/80">Accurate readings</span> for tighter per-line sync (slower).
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => beginAlignment('auto', true)}
              className="px-2.5 py-1.5 rounded-lg bg-cinnabar-accent text-white text-[11px] font-medium min-h-8 touch-manipulation"
            >
              Re-align
            </button>
            <button
              type="button"
              onClick={() => setAccurateReadingsDismissed(true)}
              aria-label="Dismiss"
              className="text-white/35 hover:text-white/70 text-xs min-h-8 px-1 touch-manipulation"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {mode === 'play' && (isJapanese || hasTranslation || phraseChanges.length > 0) && (
        <div className={`${displayToolbarRow} md:py-2.5 py-2`}>
          <p className="text-xs text-white/40 text-pretty shrink-0 hidden sm:block">Lyrics display</p>
          <DisplayMenu
            isJapanese={isJapanese}
            hasTranslation={hasTranslation}
            furiganaMode={furiganaMode}
            showTranslation={showTranslation}
            lyricsLayout={lyricsLayout}
            wordPairColoringAvailable={getDeviceTier() !== 'manual'}
            phrasingAvailable={phraseChanges.length > 0}
            sungLayoutActive={sungLayoutActive}
            phrasingBusy={phrasingBusy}
            onFuriganaCycle={cycleFurigana}
            onToggleTranslation={() => setShowTranslation(!showTranslation)}
            onToggleLayout={() => setLyricsLayout(lyricsLayout === 'sideBySide' ? 'stacked' : 'sideBySide')}
            onTogglePhrasing={sungLayoutActive ? restoreSheetPhrasing : applySungPhrasing}
          />
        </div>
      )}

      {isYouTube && !showYouTubeVideo && (
        <YouTubePlayer
          ref={ytRef}
          videoId={ytVideoId}
          startSeconds={currentSongId === songId ? position : 0}
          audioOnly
          onError={onYouTubeError}
        />
      )}

      {/* Main: lyrics + controls. Controls dock to the bottom on mobile, sidebar on md+. */}
      <div className="flex flex-1 min-h-0 flex-col md:flex-row md:items-stretch">
        <div className="flex flex-1 min-h-0 flex-col min-w-0">
          {mode === 'play' ? (
            <LyricDisplay
              abLoop={abLoop}
              position={position}
              playlistActive={playlistActive}
              playlistEntries={playlistEntries}
              playlistIndex={playlistIndex}
              onLineClick={(line) => {
              if (armingAB) {
                const patch = abLoopPatchFromLineTap(armingAB, line, abLoop)
                setABLoop(patch)
                const t = patch[armingAB]
                if (t !== undefined) seek(t)
              } else {
                interruptPracticeLoops()
                const idx = useLyricsStore.getState().lines.indexOf(line)
                if (idx >= 0) useLyricsStore.setState({ activeLine: idx })
                seek(linePlaybackStart(line))
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
              hasLocalAudio={hasStoredAudio}
              title={song?.title ?? ''}
              artist={song?.artist ?? ''}
              sourceLanguage={song?.lyrics.sourceLanguage ?? 'ja'}
              onChangeLines={handleEditLines}
              onAutoAlign={() => beginAlignment('auto')}
              showTapSync={canPlayback && lyricsUntimed}
              onTapSync={() => beginAlignment('tap')}
              onReplaceLyrics={() => setShowLyricsReimport(true)}
              onPausePlayback={pausePlayback}
              lineAlignmentQuality={song?.lyrics.lineAlignmentQuality}
              showAlignmentQuality={song?.lyrics.alignmentMode === 'auto'}
              onLocalRealign={song?.lyrics.transcriptWords?.length ? handleLocalRealign : undefined}
              onRealignAllWeak={song?.lyrics.transcriptWords?.length ? handleRealignAllWeak : undefined}
              localRealigning={localRealigning}
              weakLineCount={weakLineCount}
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
          showAbExport={localAudioPlayable && mode === 'play' && isValidABPair(abLoop.a, abLoop.b)}
          onExportAb={handleExportAbLoop}
          abExporting={abExporting}
          abExportError={abExportError}
          abExportCanIncludeSrt={abExportCanIncludeSrt}
          abExportIncludeSrt={abExportIncludeSrt}
          onAbExportIncludeSrtChange={setAbExportIncludeSrt}
          playlistEntries={playlistEntries}
          playlistActive={playlistActive}
          playlistIndex={playlistIndex}
          playlistRepeatCount={playlistRepeatCount}
          onPlaylistRepeatCountChange={setPlaylistRepeatCount}
          canSaveToPlaylist={isValidABPair(abLoop.a, abLoop.b)}
          onSaveToPlaylist={handleSaveToPlaylist}
          onTogglePlaylist={handleTogglePlaylist}
          onLoadPlaylistEntry={handleLoadPlaylistEntry}
          onMovePlaylistEntry={(from, to) => moveEntry(songId, from, to)}
          onRemovePlaylistEntry={(entryId) => removeEntry(songId, entryId)}
          onRenamePlaylistEntry={(entryId, label) => renameEntry(songId, entryId, label)}
          onClearPlaylist={() => clearPlaylist(songId)}
          showPlaylistExport={showPlaylistExport}
          onExportPlaylist={handleExportAbLoopPlaylist}
          playlistExporting={abExporting}
          playlistExportError={abExportError}
          headerSlot={
            isYouTube && ytVideoId ? (
              <YouTubePlaybackPanel
                ref={showYouTubeVideo ? ytRef : undefined}
                embedVisible={showYouTubeVideo}
                videoId={ytVideoId}
                startSeconds={currentSongId === songId ? position : 0}
                position={position}
                duration={duration}
                playbackState={playbackState}
                mode={mode}
                onError={onYouTubeError}
                onAttach={handleAttachLocalAudio}
                attaching={attachingAudio}
                attachError={attachAudioError || undefined}
              />
            ) : null
          }
        />
      </div>

      {showLyricsReimport && song && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
          onClick={requestLyricsReimportClose}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-2xl bg-cinnabar-950 border border-cinnabar-800 p-4 max-h-[min(90dvh,32rem)] flex flex-col overflow-hidden"
            role="dialog"
            aria-label="Replace lyrics"
            aria-modal="true"
          >
            {confirmLyricsReimportClose && (
              <ConfirmDialog
                title="Close lyric search?"
                message="Lyrics are still being fetched. Closing now will cancel the search."
                confirmLabel="Close"
                cancelLabel="Keep searching"
                onConfirm={confirmLyricsReimportCloseNow}
                onCancel={cancelLyricsReimportClose}
              />
            )}
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="text-sm font-semibold text-white">Replace lyrics</h3>
              <button
                type="button"
                aria-label="Close"
                onClick={requestLyricsReimportClose}
                className="text-white/40 min-h-10 min-w-10 flex items-center justify-center hover:text-white/70"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
            <LyricsImportPanel
              title={song.title}
              artist={song.artist}
              videoId={ytVideoId}
              sourceLanguage={song.lyrics.sourceLanguage}
              onApply={handleReplaceLyrics}
              onCancel={requestLyricsReimportClose}
              onBusyChange={setLyricsReimportBusy}
              applyLabel="Replace lyrics"
            />
            </div>
          </div>
        </div>
      )}

      {song && alignMode === 'auto' && (
        <Suspense fallback={
          <LoadingOverlay message="Loading AI…" detail="Preparing auto-align tools" />
        }>
          <AutoAlignFlow
            song={song}
            autoStart={autoAlignOnOpen}
            accurateReadings={alignAccurateReadings}
            onComplete={applyAlignedSong}
            onClose={() => setAlignMode(null)}
          />
        </Suspense>
      )}

    </div>
  )
}
