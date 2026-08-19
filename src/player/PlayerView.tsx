import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
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
import type { Song, TimedLine, Language, TimedTranscriptWord, SungPhrase, AlignmentLanguage } from '../core/types'
import { DragRetimeStrip } from './DragRetimeStrip'
import { Banner } from '../core/ui/Banner'
import { refitAroundAnchors, selectAnchorTargets, selectActiveAnchorTarget, type TimingAnchor } from '../lyrics/anchorRefit'
import { enrichPhraseTokens } from '../lyrics/phraseEnrichment'
import { projectPhraseTokensToLines } from '../lyrics/phraseProjection'
import { repairPhraseTranslationOrder, remapPhraseTranslations } from '../lyrics/phraseNormalize'
import {
  refineAlignmentWithPhrases,
  sheetRowsForAlignment,
  applyRefinedAlignment,
  shouldRefineStoredAlignment,
  needsMixedRealign,
  transcriptWordsToAlignInput,
} from '../lyrics/phraseAlignment'
import { summarizePhraseChanges, applySungLayout, revertToSheetLayout } from '../lyrics/phraseLayout'
import {
  recoverGapsForStoredSong,
  shouldAutoRecoverGaps,
  countRecoverableHoles,
} from '../ai-pipeline/gapRecovery'
import { tokenizeJapanese } from '../language/japanese/tokenizer'
import { toRomaji, toFurigana } from '../language/japanese/phonetics'
import { detectGrammarPatterns } from '../language/japanese/grammar'
import { tokenizeEnglish } from '../language/english/tokenizer'
import { sentenceToIPA } from '../language/english/phonetics'
import { detectEnglishGrammar } from '../language/english/grammar'
import { TapSyncEditor } from './TapSyncEditor'
import { getDeviceTier, canUseVocalSeparation } from '../ai-pipeline/capability'
import { useSettingsStore } from '../payment/SettingsStore'
import { detectSheetLanguage } from '../ai-pipeline/whisperLanguage'
import { accurateRealignReason } from '../ai-pipeline/alignTimestampMode'
import { linesAreTimed, chooseAutoAlignment, type AlignMode } from './alignmentPolicy'
import { EditMode } from '../lyrics/EditMode'
import { computeSyncState } from '../core/db/migrations'
import { hasVisibleTranslation } from '../lyrics/bilingual'
import { linesNeedEnrichment, linesNeedAlignment, lineNeedsAlignment, enrichmentMadeProgress, LYRICS_ENRICHMENT_VERSION } from '../lyrics/lyricsEnrichment'
import { describeReplaceLoss } from '../lyrics/replaceLyricsLoss'
import { retimeQuality } from '../lyrics/retimeQuality'
import { runWhenIdle, yieldToMainThread } from '../core/idle'
import { alignLinesTokens, countEmbedBatches } from '../ai-pipeline/wordAligner'
import { preloadGlossLexicon } from '../ai-pipeline/lyricGloss'
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
import { useModalDialog } from '../core/ui/useModalDialog'
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

/** Anything that owns its own keystrokes: a text field, a real control, or the
 * inside of an open dialog. The player's shortcuts live on `window`, so without
 * this they hijack every key on the page — Space on a focused button toggled
 * playback instead of pressing the button, and arrows inside a sheet seeked the
 * song. Lyric rows are plain divs and match nothing here, so clicking a lyric
 * and pressing Space still works. */
const KEYSTROKE_OWNER = [
  'button', 'a[href]', 'input', 'textarea', 'select',
  '[role="switch"]', '[role="slider"]', '[role="button"]',
  '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || !!target.closest(KEYSTROKE_OWNER)
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
  const { lines, syncPosition, setLines, furiganaMode, showTranslation, lyricsLayout, setFuriganaMode, setShowTranslation, setLyricsLayout, clozeMode, clozeDifficulty, setClozeMode, setClozeDifficulty } = useLyricsStore()
  const [song, setSong] = useState<Song | null>(null)
  const activeLine = useLyricsStore((s) => s.activeLine)
  const [alignMode, setAlignMode] = useState<AlignMode | null>(null)
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
  const [pendingReplace, setPendingReplace] = useState<{ imported: TimedLine[]; loss: string } | null>(null)
  const [songMissing, setSongMissing] = useState(false)
  const [phrasingBusy, setPhrasingBusy] = useState(false)
  const [recoveringGaps, setRecoveringGaps] = useState(false)
  const [recoverGapsStatus, setRecoverGapsStatus] = useState<string | null>(null)
  // Gap recovery re-transcribes on the same isolated vocal stem the fresh align
  // uses, when the device supports it and the user hasn't turned isolation off
  // (null = default-on). recoverGapsForStoredSong still verifies the model + guards
  // the stem, so this is a cheap intent flag.
  const vocalSeparationEnabled = useSettingsStore((s) => s.vocalSeparationEnabled)
  const gapRecoveryIsolatesVocals =
    canUseVocalSeparation(getDeviceTier()) && (vocalSeparationEnabled ?? true)
  const {
    setBusy: setLyricsReimportBusy,
    confirming: confirmLyricsReimportClose,
    requestClose: requestLyricsReimportClose,
    confirm: confirmLyricsReimportCloseNow,
    cancel: cancelLyricsReimportClose,
  } = useConfirmedClose(() => setShowLyricsReimport(false))
  const lyricsReimportRef = useRef<HTMLDivElement>(null)
  // Escape routes through requestClose so it inherits the "lyrics are still
  // being fetched" guard rather than cancelling a search silently.
  // Gated on `song` too, because that is what the dialog's own render is gated
  // on — enabling the hook while the element is absent would leave it unarmed.
  useModalDialog(lyricsReimportRef, requestLyricsReimportClose, showLyricsReimport && !!song)
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
      if (cancelled) return
      // A bookmarked or shared link to a song that has since been deleted used
      // to render an empty player: no lyrics, dead controls, no explanation.
      if (!s) {
        setSongMissing(true)
        return
      }
      let loaded = s
      if (shouldRefineStoredAlignment(s.lyrics)) {
        try {
          const sheetRows = sheetRowsForAlignment(s.lyrics)
          const refined = refineAlignmentWithPhrases(
            sheetRows,
            transcriptWordsToAlignInput(s.lyrics.transcriptWords),
            detectSheetLanguage(
              sheetRows.map((r) => r.original || r.translation),
              s.lyrics.sourceLanguage,
            ),
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
      // The refinement above awaits a Dexie write, and the last `cancelled`
      // check was before it. A superseded load resuming here would overwrite the
      // current song's state with the previous one's — and force Play mode,
      // ejecting a user who had since switched to Edit.
      if (cancelled) return

      setSong(loaded)
      setLines(loaded.lyrics.lines)
      setLocalAudioLoadFailed(false)
      // Opening a different song starts from the top; reopening the same song
      // (e.g. after a trip to Settings) resumes the persisted position.
      const store = usePlayerStore.getState()
      const isNewSong = store.currentSongId !== songId
      // Only a genuinely new song lands in Play mode. Re-running this effect for
      // the song already open — a refresh, a return from Settings — used to
      // throw the user out of Edit mode mid-edit for no reason they could see.
      if (isNewSong) setMode('play')
      if (isNewSong) setCurrentSong(songId) // resets position to 0
      const resumeAt = isNewSong ? 0 : store.position
      // Load locally-stored audio into the engine so playback works for
      // non-YouTube sources. Without this, play() is a no-op. Keep the fetched
      // File so gap recovery below can reuse it (no second OPFS read).
      let audioFile: File | null = null
      if (s.audioStoredPath) {
        try {
          audioFile = await getAudioFile(s.id)
          const loadVolume = usePlayerStore.getState().volume
          await engine.load(audioFile, loadVolume)
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
        // Auto gap recovery (round 9, R9-2), once per song: re-transcribe garbled
        // gaps of an already-stored song. Independent of the version-gated
        // re-refine above (that never re-transcribes). accept-if-better makes it
        // safe on any song (mixed included); gapRecoveryVersion is stamped even
        // when nothing is filled, so Whisper isn't re-loaded on every open.
        if (!cancelled && shouldAutoRecoverGaps(loaded.lyrics, { willAutoAlign, hasAudio: !!s.audioStoredPath })) {
          // Flip the busy flag SYNCHRONOUSLY (before the decode/model-load await) so
          // the manual "Recover N sections" button — which guards on recoveringGaps —
          // can't fire a second concurrent recovery during this window (duplicate
          // decode + racing db.put). onProgress only fires after the model loads.
          setRecoveringGaps(true)
          setRecoverGapsStatus('Recovering…')
          try {
            const result = await recoverGapsForStoredSong({
              lyrics: loaded.lyrics,
              songId: s.id,
              audioFile: audioFile ?? undefined,
              isCancelled: () => cancelled,
              onProgress: (n) => {
                if (!cancelled) {
                  setRecoverGapsStatus(n > 0 ? `Recovering ${n} section${n === 1 ? '' : 's'}…` : 'Recovering…')
                }
              },
              isolateVocals: gapRecoveryIsolatesVocals,
              onSeparating: () => { if (!cancelled) setRecoverGapsStatus('Isolating vocals…') },
              highAccuracy: false,
              timestampMode: 'segment',
            })
            if (result && !cancelled) {
              loaded = { ...loaded, lyrics: result.lyrics }
              await db.songs.put(loaded)
              if (!cancelled) {
                setSong(loaded)
                setLines(loaded.lyrics.lines)
              }
            }
          } catch {
            /* leave alignment as-is; playback still works */
          } finally {
            if (!cancelled) {
              setRecoveringGaps(false)
              setRecoverGapsStatus(null)
            }
          }
        }
        if (!cancelled) cancelIdle = deferBackgroundEnrichment(loaded, loaded.lyrics.lines, () => cancelled)
      }
    })
    return () => {
      cancelled = true
      enrichmentJobRef.current++
      cancelIdle()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId])

  // Learn the track length from playback and keep it. YouTube songs have no
  // duration until the iframe reports one, and songs added before durationSec
  // existed have none either — but LRCLIB matching leans on it heavily (it is
  // the main thing telling two masters of the same song apart), so the first
  // real value is worth storing.
  //
  // Never overwrite: a duration parsed from file metadata is exact, and a
  // polled one is not. Absent-only keeps the better value.
  //
  // Reads the STORE's duration, not engine.duration. engine.load() only runs
  // for songs with stored audio (see the load effect above), so on a
  // YouTube-only song engine.duration is permanently 0 — and YouTube is the
  // case this exists for. YouTubePlayer pushes its polled length straight to
  // the store, so the store is the one source both providers feed.
  //
  // currentSongId guards against reading a length belonging to a different
  // song: setCurrentSong resets duration to 0 on a song change, but the guard
  // makes that ordering explicit rather than assumed.
  useEffect(() => {
    if (!song || song.durationSec != null) return
    if (currentSongId !== song.id) return
    if (!Number.isFinite(duration) || duration <= 0) return
    const updated: Song = { ...song, durationSec: duration }
    void db.songs.put(updated).then(() => setSong(updated))
  }, [song, duration, currentSongId])

  useEffect(() => {
    if (canRunWordAlignment()) {
      preloadGlossLexicon()
      // Dynamic so the embedder (and its transformers dependency chain) stays
      // out of the main chunk; every other call site already imports it lazily.
      void import('../ai-pipeline/textEmbedder').then(({ preloadEmbedder }) => preloadEmbedder())
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
  // Tap-to-anchor: the few rows the aligner was least sure of. When one of them is
  // the active line in Play mode, offer a one-tap pin — the tap becomes ground
  // truth for that line and refitAroundAnchors re-fits LOCALLY around it (confident
  // lines outside the pinned span are never shifted).
  const anchorTargets =
    song?.lyrics.alignmentMode === 'auto'
      ? selectAnchorTargets(song.lyrics.lines, song.lyrics.lineAlignmentQuality, {
          // An anchor normally retires a line. Not when the user was clamped by
          // the edge of the drag window: that commit deliberately left the line
          // flagged, and suppressing it here would strand it one anchor short of
          // truth with no way back. Each pass re-centres on the new start, so
          // walking a badly-placed line converges rather than looping.
          alreadyAnchored: (song.lyrics.timingAnchors ?? [])
            .map((a) => a.lineIndex)
            .filter((i) => song.lyrics.lineAlignmentQuality?.[i] === 'good'),
        })
      : []
  // Latched rather than an exact match on the active line: see
  // selectActiveAnchorTarget — a flagged line's stored timing is wrong, so the
  // real vocal lands after the app has already moved on.
  const anchorTargetSuggested =
    mode === 'play' ? selectActiveAnchorTarget(activeLine, anchorTargets) : null
  // Once the user starts adjusting a line, that line stays the target until they
  // commit or leave Play mode. Without this latch the control destroys itself:
  // dragging seeks for live feedback, seeking recomputes activeLine, and the
  // recomputed target no longer matches — so the strip unmounts mid-drag.
  const [retimingLine, setRetimingLine] = useState<number | null>(null)
  const anchorTargetActive = mode === 'play' ? (retimingLine ?? anchorTargetSuggested) : null
  // Restore the whole song to a pre-tap snapshot (undo for the instantly-persisted
  // tap-anchor). Reverts the anchor, the refit, and the cleared uncertainty flag.
  const restoreSong = async (snapshot: Song) => {
    setLines(snapshot.lyrics.lines)
    setSong(snapshot)
    await db.songs.put(snapshot)
  }
  const handleTapAnchor = async (lineIndex: number, time: number, opts?: { clamped?: boolean }) => {
    if (!song) return
    const prevSong = song
    const anchors: TimingAnchor[] = [
      ...(song.lyrics.timingAnchors ?? []).filter((a) => a.lineIndex !== lineIndex),
      { lineIndex, time, source: 'user' },
    ]
    const newLines = refitAroundAnchors(
      song.lyrics.lines,
      anchors,
      song.lyrics.sourceLanguage as AlignmentLanguage,
      { quality: song.lyrics.lineAlignmentQuality },
    )
    // A time the user settled on IS ground truth for this row — clear its
    // uncertainty flag so it drops out of the remaining targets. A CLAMPED one is
    // not: they ran out of slider before they found the spot. Marking that 'good'
    // is precisely how wrong timing used to get locked in and never revisited, so
    // the flag stays and the line is offered again, re-centred on its new start.
    const quality = song.lyrics.lineAlignmentQuality ? [...song.lyrics.lineAlignmentQuality] : undefined
    if (quality && !opts?.clamped) quality[lineIndex] = 'good'
    const lyrics = {
      ...song.lyrics,
      lines: newLines,
      timingAnchors: anchors,
      ...(quality ? { lineAlignmentQuality: quality } : {}),
    }
    const updated: Song = { ...song, lyrics, syncState: computeSyncState({ ...song, lyrics }) }
    setLines(newLines)
    setSong(updated)
    await db.songs.put(updated)
    toast(
      opts?.clamped ? `Line ${lineIndex + 1} moved as far as the slider reaches — adjust again` : `Line ${lineIndex + 1} re-timed`,
      'info',
      { label: 'Undo', onClick: () => void restoreSong(prevSong) },
    )
  }
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

  const seek = (time: number, opts?: { fromRetime?: boolean }) => {
    // Any seek the re-timing strip did NOT cause means the user has moved on, so
    // let go of the line they were adjusting. Without this the latch below never
    // released without a commit, and the strip followed the user around the song
    // offering to re-time audio they were nowhere near.
    if (!opts?.fromRetime) setRetimingLine(null)
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
      // The points have to go — keeping them would drag the playhead straight
      // back to the loop the user just navigated away from. But placing an A–B
      // pair is real work, and losing it to a stray line tap with no notice was
      // silent data loss, so it comes back with one tap.
      const previous = { a: loop.a, b: loop.b }
      setABLoop({ a: null, b: null })
      toast('A–B loop cleared.', 'info', {
        label: 'Undo',
        onClick: () => setABLoop(previous),
      })
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

  const beginAlignment = (mode: AlignMode) => {
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

  // Manual gap recovery (round 9, R9-2): re-transcribe the recoverable gaps of a
  // stored song on demand from the EditMode banner. OVERRIDES the once-guard —
  // re-attempts even at the current gapRecoveryVersion (auto only runs once).
  const handleRecoverGaps = async () => {
    if (!song || !hasStoredAudio || recoveringGaps) return
    setRecoveringGaps(true)
    setRecoverGapsStatus('Recovering…')
    try {
      const result = await recoverGapsForStoredSong({
        lyrics: song.lyrics,
        songId: song.id,
        isCancelled: () => false,
        onProgress: (n) =>
          setRecoverGapsStatus(n > 0 ? `Recovering ${n} section${n === 1 ? '' : 's'}…` : 'Recovering…'),
        isolateVocals: gapRecoveryIsolatesVocals,
        onSeparating: () => setRecoverGapsStatus('Isolating vocals…'),
        highAccuracy: false,
        timestampMode: 'segment',
      })
      if (!result) {
        toast('No unaligned sections to recover.', 'info')
        return
      }
      const updated = { ...song, lyrics: result.lyrics }
      await db.songs.put(updated)
      setSong(updated)
      setLines(updated.lyrics.lines)
      toast(
        result.filledCount > 0
          ? `Recovered ${result.filledCount} section${result.filledCount === 1 ? '' : 's'}.`
          : 'The audio could not be re-heard for these sections.',
        result.filledCount > 0 ? 'info' : 'warning',
      )
    } catch {
      toast('Gap recovery failed — try again.', 'warning')
    } finally {
      setRecoveringGaps(false)
      setRecoverGapsStatus(null)
    }
  }

  // Cheap enough to memoize on the song reference (not per frame): reconstructs the
  // alignment view + runs pure hole detection. Only auto-aligned songs qualify.
  const recoverableGapCount = useMemo(
    () => (song && song.lyrics.alignmentMode === 'auto' ? countRecoverableHoles(song.lyrics) : 0),
    [song],
  )

  /** Adopt a newly-timed song. `closeFlow` is false for auto-align: closing in
   * the same tick the flow reaches its 'done' stage meant its success screen —
   * and the low-confidence warning with its "re-run with vocal isolation"
   * button — rendered for zero frames, so the modal just vanished and the user
   * had no idea whether the result was trustworthy. The flow closes itself
   * through its own Close button instead. Tap-through has no result screen, so
   * it still closes on completion. */
  const applyAlignedSong = (updated: Song, { closeFlow = true }: { closeFlow?: boolean } = {}) => {
    setSong(updated)
    setLines(updated.lyrics.lines)
    if (closeFlow) setAlignMode(null)
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
      // Sync phrase translations from current sheet lines before projecting onto
      // phrase rows, so hasTranslation stays true and side-by-side can be used.
      const freshPhrases = remapPhraseTranslations(song.lyrics.lines, song.lyrics.phrases)
      const applied = applySungLayout({ ...song.lyrics, phrases: freshPhrases })
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
    const translationChanged = lines.some((l, i) => l.translation !== song.lyrics.lines[i]?.translation)
    const phrases = song.lyrics.phrases?.length && translationChanged
      ? remapPhraseTranslations(lines, song.lyrics.phrases)
      : song.lyrics.phrases
    const updated: Song = {
      ...song,
      lyrics: {
        ...song.lyrics,
        lines,
        enrichmentVersion: undefined,
        // Clear the flag only on the lines actually retimed — a hand edit is
        // ground truth for THAT line and says nothing about the others.
        ...(timingChanged
          ? { lineAlignmentQuality: retimeQuality(song.lyrics.lineAlignmentQuality, song.lyrics.lines, lines) }
          : {}),
        ...(phrases !== song.lyrics.phrases ? { phrases } : {}),
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

  const progress = duration > 0 ? Math.min(1, position / duration) : 0
  const isJapanese = song?.lyrics.sourceLanguage === 'ja'
  const hasTranslation = !!song?.lyrics.lines.some(hasVisibleTranslation)

  const sungLayoutActive = song?.lyrics.phraseLayout === 'sung'
  const phraseSheetRows = sungLayoutActive ? (song?.lyrics.sheetLinesSnapshot ?? []) : (song?.lyrics.lines ?? [])
  const phraseChanges =
    song?.lyrics.phrases?.length ? summarizePhraseChanges(phraseSheetRows, song.lyrics.phrases) : []

  // Why a more powerful re-align pass is recommended: 'segment-blocks' (the
  // transcript grouped multiple lines into shared chunks) or 'weak-labels'
  // (many lines could not be verified against the audio). Drives the Edit-mode
  // hint; the Play-mode "Accurate readings" banner keys on segment-blocks only.
  const realignReason = song
    ? accurateRealignReason(
        song.lyrics.lines,
        song.lyrics.transcriptWords,
        song.lyrics.lineAlignmentQuality,
        getDeviceTier(),
      )
    : null
  const suggestWordLevelAlign = realignReason === 'segment-blocks' && hasStoredAudio

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

  /** Replacing overwrites `lines` wholesale — hand-tapped timing and an attached
   * translation go with it, and nothing brings them back. Confirm first, naming
   * exactly what is lost; silent when the import carries its own timing or
   * translation, so the dialog stays meaningful. */
  const handleReplaceLyrics = async (imported: TimedLine[]) => {
    if (!song) return
    const loss = describeReplaceLoss(song.lyrics.lines, imported)
    if (loss) {
      setPendingReplace({ imported, loss })
      return
    }
    await applyReplaceLyrics(imported)
  }

  const applyReplaceLyrics = async (imported: TimedLine[]) => {
    if (!song) return
    setPendingReplace(null)
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

  if (songMissing) {
    return (
      <div role="alert" className="h-full bg-cinnabar-950 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-cinnabar-900 border border-cinnabar-800 flex items-center justify-center text-cinnabar-accent/70 text-xl">♪</div>
        <p className="text-white/80 text-sm font-medium text-balance">This song isn't in your library</p>
        <p className="text-white/60 text-xs text-pretty max-w-[18rem] leading-relaxed">
          It may have been deleted, or the link came from another device — songs are stored
          on the device that added them, not in an account.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-2 min-h-11 px-4 rounded-xl bg-cinnabar-accent text-white text-sm font-medium touch-manipulation active:scale-[0.97] transition-transform"
        >
          Back to library
        </button>
      </div>
    )
  }

  return (
    <div
      className="h-full overflow-hidden bg-cinnabar-950 flex flex-col w-full max-w-7xl mx-auto md:border-x border-cinnabar-900/80"
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
        <button onClick={onBack} className="shrink-0 min-h-11 min-w-11 flex items-center justify-center text-white/65 hover:text-white text-xs touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]">← Back</button>
        {song && (
          <div className="flex-1 min-w-0 px-1">
            <p className="text-sm text-white/85 truncate font-medium">{song.title}</p>
            {song.artist && <p className="text-[11px] text-white/60 truncate">{song.artist}</p>}
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <PlayEditToggle mode={mode} onChange={setMode} />
          <button onClick={() => onSettings?.()} className="shrink-0 min-h-11 min-w-11 flex items-center justify-center text-white/65 hover:text-white text-xs touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]">Settings</button>
        </div>
      </header>

      {wordColorProgress && (
        <WordColorProgressBanner done={wordColorProgress.done} total={wordColorProgress.total} />
      )}

      {/* Stored audio failed to load and there is no YouTube fallback: playback is
          disabled, so offer a way to re-attach a file rather than a dead player. */}
      {localAudioLoadFailed && !isYouTube && hasStoredAudio && (
        <Banner
          severity="error"
          actionSlot={
            <label className="shrink-0 self-start px-2.5 py-1.5 rounded-lg bg-cinnabar-accent text-white text-[11px] font-semibold min-h-8 inline-flex items-center touch-manipulation cursor-pointer">
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
          }
        >
          Couldn&apos;t load this song&apos;s audio file. {attachAudioError || 'It may be missing or in an unsupported format.'}
        </Banner>
      )}

      {mode === 'play' && canPlayback && anchorTargetActive !== null && (
        <DragRetimeStrip
          lineIndex={anchorTargetActive}
          lineText={lines[anchorTargetActive]?.original}
          startSec={lines[anchorTargetActive]?.startTime ?? 0}
          remaining={anchorTargets.length}
          onPreview={(t) => {
            // Latch the line before seeking — seek recomputes activeLine, which
            // would otherwise drop the target out from under this control. The
            // flag is what stops seek() from releasing the latch it just set.
            setRetimingLine(anchorTargetActive)
            seek(t, { fromRetime: true })
          }}
          onCommit={(i, t, o) => {
            setRetimingLine(null)
            void handleTapAnchor(i, t, o)
          }}
        />
      )}

      {mode === 'play' && lyricsUntimed && canPlayback && (
        <Banner severity="info">
          Lyrics aren&apos;t timed yet. Open Edit → Tap-through to time each line as the song plays
          {hasStoredAudio ? ', or use Auto-align.' : ', or add an audio file for AI align.'}
        </Banner>
      )}

      {/* Approximate-timing note. Deliberately does NOT push word-level "Re-align":
          that pass is measurably worse on long tracks (the exact case this fires
          for). The reliable fix is tapping a line as it plays — the tap-anchor
          prompt above already offers that — or fine-tuning in Edit. */}
      {mode === 'play' && suggestWordLevelAlign && !accurateReadingsDismissed && (
        <Banner
          severity="info"
          onDismiss={() => setAccurateReadingsDismissed(true)}
        >
          Some line timings are approximate — tap a line as it plays to fix it, or fine-tune in Edit.
        </Banner>
      )}

      {mode === 'play' && (isJapanese || hasTranslation || phraseChanges.length > 0) && (
        <div className={`${displayToolbarRow} md:py-2.5 py-2`}>
          <p className="text-xs text-white/60 text-pretty shrink-0 hidden sm:block">Lyrics display</p>
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
            clozeMode={clozeMode}
            clozeDifficulty={clozeDifficulty}
            onToggleCloze={() => setClozeMode(!clozeMode)}
            onClozeDifficulty={setClozeDifficulty}
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
      {/* Sidebar beside the lyrics on a wide OR short-and-wide viewport. A phone
          held sideways used to stack header + toolbar + dock down a 360px
          viewport, leaving under one lyric row visible. */}
      <div className="flex flex-1 min-h-0 flex-col md:flex-row md:items-stretch [@media(max-height:520px)_and_(min-width:560px)]:flex-row [@media(max-height:520px)_and_(min-width:560px)]:items-stretch">
        <div className="flex flex-1 min-h-0 flex-col min-w-0">
          {mode === 'play' ? (
            <LyricDisplay
              abLoop={abLoop}
              armingAB={armingAB}
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
              // Not gated on lyricsUntimed: the songs that most need re-timing
              // are the ones that already have (wrong) timings, and a partial
              // tap pass leaves timings behind — which used to hide the tool
              // that produced them.
              showTapSync={canPlayback}
              autoAlignSupported={getDeviceTier() !== 'manual'}
              onTapSync={() => beginAlignment('tap')}
              onReplaceLyrics={() => setShowLyricsReimport(true)}
              onPausePlayback={pausePlayback}
              lineAlignmentQuality={song?.lyrics.lineAlignmentQuality}
              showAlignmentQuality={song?.lyrics.alignmentMode === 'auto'}
              needsMixedRealign={song ? needsMixedRealign(song.lyrics) : false}
              recoverableGapCount={recoverableGapCount}
              onRecoverGaps={handleRecoverGaps}
              recoveringGaps={recoveringGaps}
              recoverGapsStatus={recoverGapsStatus}
              alignmentConfidence={song?.lyrics.alignmentConfidence}
              accurateRealignReason={hasStoredAudio ? realignReason : null}
              onFixTiming={
                anchorTargets.length > 0 && canPlayback
                  ? () => { setMode('play'); goToLyricLine(anchorTargets[0]) }
                  : undefined
              }
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
            // YouTube honours only a fixed set of rates, so the store records
            // what was actually applied rather than what was asked for.
            if (isYouTube) setSpeed(ytRef.current?.setRate(s) ?? s)
            else { setSpeed(s); engine.setRate(s) }
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
            ref={lyricsReimportRef}
            tabIndex={-1}
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
                className="text-white/60 min-h-10 min-w-10 flex items-center justify-center hover:text-white/70"
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
              durationSec={song.durationSec}
              onApply={handleReplaceLyrics}
              onCancel={requestLyricsReimportClose}
              onBusyChange={setLyricsReimportBusy}
              applyLabel="Replace lyrics"
            />
            </div>
          </div>
        </div>
      )}

      {/* Overlay, NOT an early return: tap-through has to be rendered inside the
          main tree because that tree owns <YouTubePlayer>. Returning early
          unmounted the iframe and its position ticker, so the clock froze at
          0:00 and every tap on a YouTube song recorded the same timestamp. */}
      {pendingReplace && (
        <ConfirmDialog
          title="Replace lyrics?"
          message={pendingReplace.loss}
          confirmLabel="Replace"
          cancelLabel="Keep what I have"
          onConfirm={() => { void applyReplaceLyrics(pendingReplace.imported) }}
          onCancel={() => setPendingReplace(null)}
        />
      )}

      {song && alignMode === 'tap' && (
        <TapSyncEditor
          plainLines={song.lyrics.lines.map((l) => l.original)}
          translations={song.lyrics.lines.map((l) => l.translation)}
          audioPosition={() => position}
          onComplete={handleTapComplete}
          onCancel={() => setAlignMode(null)}
          isPlaying={playbackState === 'playing'}
          onTogglePlay={togglePlay}
          onSeek={seek}
          volume={volume}
          onVolumeChange={(v) => {
            setVolume(v)
            if (isYouTube) ytRef.current?.setVolume(v)
            else engine.setVolume(v)
          }}
          speed={speed}
          onSpeedChange={(s) => {
            // YouTube honours only a fixed set of rates, so the store records
            // what was actually applied rather than what was asked for.
            if (isYouTube) setSpeed(ytRef.current?.setRate(s) ?? s)
            else { setSpeed(s); engine.setRate(s) }
          }}
        />
      )}

      {song && alignMode === 'auto' && (
        <Suspense fallback={
          <LoadingOverlay message="Loading AI…" detail="Preparing auto-align tools" />
        }>
          <AutoAlignFlow
            song={song}
            autoStart={autoAlignOnOpen}
            onComplete={(updated) => applyAlignedSong(updated, { closeFlow: false })}
            onClose={() => setAlignMode(null)}
          />
        </Suspense>
      )}

    </div>
  )
}
