import { useEffect, useMemo, useRef, useState } from 'react'
import { canUseVocalSeparation, getDeviceTier } from './capability'
import { canUseHighAccuracy } from './inferenceBackend'
import { getWhisperDownloadHint } from './models'
import { decodeAudioFileToMono } from '../core/audio/decodeToMono'
import { getAudioFile } from '../core/opfs/audio'
import type { Song } from '../core/types'
import { sanitizeTranscript, LOW_CONFIDENCE_WARN_THRESHOLD, type TranscriptWord } from './aligner'
import { refineAlignmentWithPhrases, sheetRowsForAlignment, applyRefinedAlignment, type RefinedAlignment } from '../lyrics/phraseAlignment'
import { refineMixedLanguageAlignment } from './mixedLanguageAlign'
import { reanalyzeGaps } from './gapReanalyze'
import { GAP_RECOVERY_VERSION } from './gapRecovery'
import { createSliceTranscriber } from './sliceTranscriber'
import { chunksToWords } from './transcriptChunks'
import { db } from '../core/db/schema'
import { computeSyncState } from '../core/db/migrations'
import { ProcessProgress } from '../core/ui/ProcessProgress'
import { ConfirmDialog } from '../core/ui/ConfirmDialog'
import { alignSteps, alignStepIndex, type AlignStage } from './alignProgress'
import { preferredWhisperTimestampMode } from './alignTimestampMode'
import { detectSheetLanguage } from './whisperLanguage'
import { isRecoverableTranscriptionError, classifyAlignError } from './workerError'
import { resetWhisperTranscriber, transcribeAudio, type LoadProgress, type TranscribeProgressStatus } from './whisperTranscriber'
import { DEMUCS_OUTPUT_SAMPLE_RATE, isDemucsModelAvailable, refreshDemucsModelAvailability, separateVocals } from './demucsSeparator'
import { computeVocalActivity, firstVocalOnset } from './vocalActivity'
import { anchorLeadingEdge, backfillLateStartsToAcousticOnset } from '../lyrics/leadingEdgeAnchor'
import { computeLineMatchedSpans } from './contentAligner'
import { useSettingsStore } from '../payment/SettingsStore'
import { yieldToMainThread } from '../core/idle'

interface Props {
  song: Song
  onComplete: (updated: Song) => void
  onClose: () => void
  /** When true, begin alignment as soon as the flow opens (e.g. fresh audio upload). */
  autoStart?: boolean
  /** Pre-select the word-level "Accurate readings (slower)" pass (e.g. re-running to
   * fix merged-segment timing). */
  accurateReadings?: boolean
}

type Stage = 'idle' | AlignStage | 'done' | 'error'

function classifyVocalSepError(e: unknown): string {
  if (!(e instanceof Error)) return 'Vocal separation failed'
  const msg = e.message.toLowerCase()
  if (msg.includes('out of memory') || msg.includes('oom') || msg.includes('allocation failed')) {
    return 'Not enough memory for vocal separation — try closing other tabs and retrying'
  }
  if (msg.includes('onnx') || msg.includes('runtime') || msg.includes('backend')) {
    return 'Vocal separation model error — try reloading the page'
  }
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('load')) {
    return 'Failed to load vocal separation model — check your connection and retry'
  }
  return e.message || 'Vocal separation failed'
}

function formatLoadStatus(p: LoadProgress, downloadHint: string): string | null {
  if (p.status === 'retrying') {
    const step = p.file ? ` (${p.file})` : ''
    return `Model load failed${step} — retrying…`
  }
  if (p.phase === 'init' || p.status === 'initializing') {
    const step = p.file ? ` (${p.file})` : ''
    return `Initializing on-device runtime${step} — can take several minutes on first load`
  }
  if (p.status === 'done' && p.phase === 'download') {
    return 'Cached model files verified — initializing runtime…'
  }
  if (p.status === 'download' || p.status === 'progress') {
    const file = p.file
    const pct = p.aggregateProgress ?? p.progress
    if (file && typeof pct === 'number') {
      return `Downloading model files (${Math.round(pct)}%) — ${file}`
    }
    if (typeof pct === 'number' && pct > 0) {
      return `Downloading speech model (${Math.round(pct)}%)`
    }
    return `First run — downloading speech model (${downloadHint})`
  }
  if (p.status === 'initiate') return 'Checking for cached speech model…'
  return null
}

// Operator hint for a missing Demucs model — logged (once) instead of rendered:
// the UI shows plain user copy, deployment docs belong in the console.
let demucsMissingWarned = false
function noteDemucsModelMissing() {
  if (demucsMissingWarned) return
  demucsMissingWarned = true
  console.warn('Demucs model not installed (see docs/DEPLOYMENT.md). Transcription will run on the full mix.')
}

function loadTaskProgress(p: LoadProgress | null, phase: 'download' | 'init'): number | null {
  if (phase === 'init') return null
  if (!p) return null
  const pct = p.aggregateProgress ?? p.progress
  if (typeof pct !== 'number' || pct <= 0) return null
  // Per-file 100% is misleading when other files remain — prefer aggregate.
  if (pct >= 100 && p.phase !== 'download') return null
  return Math.min(99, pct)
}

export function AutoAlignFlow({ song, onComplete, onClose, autoStart = false, accurateReadings: accurateReadingsInitial = false }: Props) {
  const tier = getDeviceTier()
  const vocalSeparationSupported = canUseVocalSeparation(tier)
  const vocalSeparationDefault = useSettingsStore((s) => s.vocalSeparationEnabled)
  const setVocalSeparationEnabled = useSettingsStore((s) => s.setVocalSeparationEnabled)
  // First-run download consent: the very first alignment pulls a ~240MB speech
  // model. Gate that first download behind an explicit prompt, remembered once.
  const modelDownloadConsented = useSettingsStore((s) => s.modelDownloadConsented)
  const setModelDownloadConsented = useSettingsStore((s) => s.setModelDownloadConsented)
  // Code-switching (mixed JA/EN) songs transcribe poorly on the full mix — their
  // dense bilingual sections are exactly the coverage-bound regions that hurt
  // alignment accuracy most. Default vocal isolation ON for them on capable
  // devices (highest-impact accuracy lever); the user can still uncheck it.
  const isMixedSong = useMemo(
    () =>
      detectSheetLanguage(
        sheetRowsForAlignment(song.lyrics).map((r) => r.original || r.translation),
        song.lyrics.sourceLanguage,
      ) === 'mixed',
    [song.lyrics],
  )
  const [vocalSeparation, setVocalSeparation] = useState(
    vocalSeparationDefault || (isMixedSong && vocalSeparationSupported),
  )
  const [demucsReady, setDemucsReady] = useState<boolean | null>(null)
  const [vocalSeparationRun, setVocalSeparationRun] = useState(false)
  // D2: opt into the slower word-level Whisper pass for more reliable readings on
  // long songs (short songs already use word mode; lite tier always uses segment).
  const [accurateReadings, setAccurateReadings] = useState(accurateReadingsInitial)
  // D8: opt into whisper-medium (full tier only) for more accurate transcription
  // at the cost of a larger download and slower inference.
  const [highAccuracy, setHighAccuracy] = useState(false)
  // Show the one-time first-run download prompt instead of auto-starting when the
  // user has never consented to the model download.
  const willAutoStart = autoStart && tier !== 'manual'
  const [awaitingConsent, setAwaitingConsent] = useState(() => willAutoStart && !modelDownloadConsented)
  const [stage, setStage] = useState<Stage>(() =>
    willAutoStart && modelDownloadConsented ? 'preparing' : 'idle',
  )
  const [progress, setProgress] = useState(0)
  const [transcribeMerging, setTranscribeMerging] = useState(false)
  const [transcribePhase, setTranscribePhase] = useState<TranscribeProgressStatus>('transcribing')
  const [loadDetail, setLoadDetail] = useState<string | null>(null)
  // Crash-downgrade retry notice: without it, a recoverable WASM crash mid-
  // transcription just snaps the progress bar to 0 with no explanation (the
  // transcribing stage never showed loadDetail). Held until the retry finishes.
  const [retryNotice, setRetryNotice] = useState<string | null>(null)
  // Round-8 gap re-transcription: a status line shown during the aligning stage
  // while unaligned sections are being recovered ("Recovering N section(s)…").
  const [gapRecovery, setGapRecovery] = useState<string | null>(null)
  const [loadPhase, setLoadPhase] = useState<'download' | 'init'>('download')
  const [lastLoadProgress, setLastLoadProgress] = useState<LoadProgress | null>(null)
  const [error, setError] = useState('')
  // Raw exception text for the error stage's collapsible "details" disclosure —
  // the user sees friendly copy, power users can still expand the real message.
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [lowConfidence, setLowConfidence] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const cancelledRef = useRef(false)

  const highAccuracySupported = canUseHighAccuracy(tier)
  // Reflect the selected model so the download-progress copy shows ~1.5GB during
  // a high-accuracy (medium) download, not the small model's ~240MB.
  const downloadHint = getWhisperDownloadHint(tier, highAccuracy && highAccuracySupported)

  useEffect(() => {
    if (!vocalSeparationSupported) return
    void refreshDemucsModelAvailability().then((ready) => {
      setDemucsReady(ready)
      if (!ready) noteDemucsModelMissing()
    })
  }, [vocalSeparationSupported])

  useEffect(() => {
    if (!vocalSeparationSupported || stage !== 'idle') return
    void refreshDemucsModelAvailability().then((ready) => {
      setDemucsReady(ready)
      if (!ready) noteDemucsModelMissing()
    })
  }, [vocalSeparationSupported, stage])

  const start = async (opts?: { forceVocalSeparation?: boolean }) => {
    cancelledRef.current = false
    setError('')
    setErrorDetail(null)
    try {
      let audioData: Float32Array | null = null
      let sampleRate = 44100

      setStage('preparing')
      setProgress(0)
      setLoadDetail(null)
      setRetryNotice(null)

      const willSeparate =
        (opts?.forceVocalSeparation || vocalSeparation)
        && vocalSeparationSupported
        && await isDemucsModelAvailable()
      setVocalSeparationRun(willSeparate)

      if (song.audioStoredPath) {
        const file = await getAudioFile(song.id)
        const decoded = await decodeAudioFileToMono(file)
        audioData = decoded.data
        sampleRate = decoded.sampleRate
      }

      if (!audioData) { setError('No audio file found. Upload audio first.'); setStage('error'); return }

      if (willSeparate) {
        setStage('separating')
        setProgress(0)
        try {
          audioData = await separateVocals(audioData, {
            sampleRate,
            onProgress: (pct) => setProgress(pct),
            isCancelled: () => cancelledRef.current,
          })
          // Demucs returns vocals at ITS model rate, not the decode rate. On a
          // 48kHz AudioContext (common on Firefox), keeping the old rate scaled
          // every Whisper timestamp ~8.8% early — the whole song desynced.
          sampleRate = DEMUCS_OUTPUT_SAMPLE_RATE
        } catch (e) {
          if (cancelledRef.current) return
          setError(classifyVocalSepError(e))
          setStage('error')
          return
        } finally {
          // no-op
        }
        if (cancelledRef.current) return
      }

      // First run downloads the Whisper model
      // as its own phase so the progress bar resetting per file isn't mistaken
      // for transcription stalling.
      setStage('loading')
      setProgress(0)
      setLoadPhase('download')
      setLastLoadProgress(null)
      setLoadDetail('Checking cached model files…')

      const durationSec = audioData.length / sampleRate
      const useHighAccuracy = highAccuracy && highAccuracySupported
      // High-accuracy (whisper-medium) forces segment mode — its word-timestamp mode
      // has a repetition-loop hallucination pathology that segment mode avoids.
      const timestampMode = useHighAccuracy
        ? 'segment'
        : preferredWhisperTimestampMode(tier, durationSec, { accurateReadings })

      // Detect the alignment language from the sheet itself: the stored song
      // language defaults to 'ja', which would force Japanese transcription
      // onto English or mixed-language lyrics.
      const sheetRows = sheetRowsForAlignment(song.lyrics)
      const alignmentLanguage = detectSheetLanguage(
        sheetRows.map((r) => r.original || r.translation),
        song.lyrics.sourceLanguage,
      )

      let sawDownload = false
      let modelAnnounced = false
      const transcribeOptions = (
        language: typeof alignmentLanguage,
        scaleProgress: (pct: number) => number,
      ) => ({
        language,
        highAccuracy: useHighAccuracy,
        timestampMode,
        onLoadProgress: (p: LoadProgress) => {
          setLastLoadProgress(p)
          if (p.phase === 'init' || p.status === 'initializing') {
            setLoadPhase('init')
          } else if (p.status === 'download' || p.status === 'progress' || p.status === 'done') {
            setLoadPhase('download')
          }
          const detail = formatLoadStatus(p, downloadHint)
          if (detail) {
            sawDownload = true
            setLoadDetail(detail)
          }
          const pct = p.aggregateProgress ?? p.progress
          if (typeof pct === 'number') setProgress(pct)
        },
        onModelLoaded: () => {
          if (modelAnnounced) return // second mixed-language pass reuses the warm model
          modelAnnounced = true
          if (!sawDownload) setLoadDetail(null)
          setLoadPhase('download')
          setStage('transcribing')
          setTranscribeMerging(false)
          setTranscribePhase('transcribing')
          setProgress(0)
        },
        onTranscribeProgress: ({ progress: pct, status }: { progress: number; status: TranscribeProgressStatus }) => {
          if (status === 'merging' || status === 'finalizing') {
            setTranscribeMerging(true)
            setTranscribePhase(status)
            return
          }
          setTranscribeMerging(false)
          setTranscribePhase('transcribing')
          setProgress(scaleProgress(pct))
        },
      })
      // Runtime fallback ladder: a WASM crash (usually OOM) or a stalled merge on
      // the heavier configurations downgrades and retries instead of failing the
      // whole flow — word timestamps fall back to segment, whisper-medium falls
      // back to whisper-small. Downgrades stick for the rest of this run (the
      // second mixed-language pass must not re-attempt what just crashed).
      let effectiveTimestampMode = timestampMode
      let effectiveHighAccuracy = useHighAccuracy
      const transcribeWithFallback = async (
        language: typeof alignmentLanguage,
        scaleProgress: (pct: number) => number,
        // Per-call downgrade to segment timestamps that leaves the user's mode
        // intact for the other pass (used by the EN-forced mixed pass below).
        timestampModeOverride?: 'segment',
      ) => {
        const run = () =>
          transcribeAudio(audioData, sampleRate, {
            ...transcribeOptions(language, scaleProgress),
            timestampMode: timestampModeOverride ?? effectiveTimestampMode,
            highAccuracy: effectiveHighAccuracy,
          })
        try {
          return await run()
        } catch (e) {
          if (cancelledRef.current || !isRecoverableTranscriptionError(e)) throw e
          if (effectiveTimestampMode === 'word' && !timestampModeOverride) {
            effectiveTimestampMode = 'segment'
            // Shown in the transcribing stage's detail area (loadDetail never
            // rendered there — the bar just snapped to 0 unexplained).
            setRetryNotice('Word-level pass failed (likely out of memory) — retrying with segment timestamps…')
          } else if (effectiveHighAccuracy) {
            effectiveHighAccuracy = false
            const notice = 'High-accuracy model failed — retrying with the standard model…'
            setRetryNotice(notice)
            // The standard model may still need to download/initialize, so flip
            // back to the loading stage (and let onModelLoaded re-announce the
            // return to transcribing) instead of leaving a dead transcribe bar.
            modelAnnounced = false
            setStage('loading')
            setLoadPhase('download')
            setLastLoadProgress(null)
            setLoadDetail(notice)
          } else {
            throw e
          }
          setProgress(0)
          try {
            return await run()
          } finally {
            setRetryNotice(null)
          }
        }
      }
      let refined: RefinedAlignment
      let transcriptWords: TranscriptWord[]
      if (alignmentLanguage === 'mixed') {
        // Code-switching sheet: per-chunk language auto-detect garbles whichever
        // language loses each 30s window and collapses content-match confidence
        // to the proportional fallback. Transcribe twice with a forced language
        // instead and merge per line by alignment quality.
        const jaTranscript = await transcribeWithFallback('ja', (p) => p / 2)
        if (cancelledRef.current) return
        // The EN pass always runs at segment granularity, regardless of the
        // user's word-mode setting: the merge only takes line-level times from
        // it, and Whisper's forced-EN word timestamps on sung vocals are
        // unreliable enough to fail the confidence gate and waste the pass.
        const enTranscript = await transcribeWithFallback('en', (p) => 50 + p / 2, 'segment')
        if (cancelledRef.current) return

        setTranscribeMerging(false)
        setTranscribePhase('transcribing')
        setStage('aligning')
        setProgress(0)
        await yieldToMainThread()
        const mixed = refineMixedLanguageAlignment(sheetRows, chunksToWords(jaTranscript), chunksToWords(enTranscript))
        refined = mixed.refined
        transcriptWords = mixed.transcriptWords
      } else {
        const transcriptResult = await transcribeWithFallback(alignmentLanguage, (p) => p)
        if (cancelledRef.current) return

        setTranscribeMerging(false)
        setTranscribePhase('transcribing')
        setStage('aligning')
        setProgress(0)
        await yieldToMainThread()
        const words = chunksToWords(transcriptResult)
        transcriptWords = sanitizeTranscript(words)
        refined = refineAlignmentWithPhrases(
          sheetRows,
          words,
          alignmentLanguage,
          song.lyrics,
        )
      }

      // Round-8 gap re-transcription: where the aligner left a HOLE (a run of
      // un-anchored lines between good anchors) even though vocals are audible,
      // re-transcribe just that ≤30s window (forced-language slice) and re-align
      // it, keeping the result only if it strictly improves. Both the mixed and
      // single-language branches above feed their assigned refined/transcriptWords
      // here. Fresh-Auto-align only (re-refine in PlayerView has no audioData).
      if (!cancelledRef.current) {
        // Re-use the main pass's exact progress callbacks (language-independent) so
        // the slice transcriber updates the UI the same way the main passes do. It
        // carries its OWN crash-downgrade ladder, seeded from the main pass's
        // effective modes, so a slice downgrade can't affect the (already-finished)
        // main passes.
        const { onLoadProgress: sliceLoadProgress, onTranscribeProgress: sliceTranscribeProgress } =
          transcribeOptions(alignmentLanguage, (p) => p)
        const sliceTx = createSliceTranscriber({
          audioData,
          sampleRate,
          isCancelled: () => cancelledRef.current,
          highAccuracy: effectiveHighAccuracy,
          timestampMode: effectiveTimestampMode,
          onLoadProgress: sliceLoadProgress,
          onTranscribeProgress: sliceTranscribeProgress,
        })
        const gap = await reanalyzeGaps({
          refined,
          transcriptWords,
          sheetRows,
          alignmentLanguage,
          sourceLanguage: song.lyrics.sourceLanguage,
          transcribeSlice: sliceTx.transcribe,
          isCancelled: () => cancelledRef.current,
          refineOpts: { lyricsBase: song.lyrics },
          onProgress: (n) => {
            setGapRecovery(
              n > 0 ? `Recovering ${n} unaligned section${n === 1 ? '' : 's'}…` : null,
            )
          },
        })
        if (cancelledRef.current) return
        setGapRecovery(null)
        refined = gap.refined
        transcriptWords = gap.transcriptWords
      }

      // Leading-edge onset anchor: if the aligner crammed the opening lines onto
      // an instrumental intro (no content anchor there, so they interpolate to
      // t=0), pull them forward to where the vocals actually begin. Stem-only —
      // a mis-heard intro transcript can't locate the onset (round-7 early-start
      // pull off transcript firstTime regressed; the acoustic envelope is the
      // signal that was missing then). Best-effort and a no-op without a vocal
      // stem, so non-isolated runs are byte-identical.
      if (audioData && willSeparate) {
        try {
          const vocalSig = computeVocalActivity(audioData, sampleRate, { source: 'stem' })
          const onset = firstVocalOnset(vocalSig)
          if (onset != null) {
            refined = { ...refined, lines: anchorLeadingEdge(refined.lines, onset, alignmentLanguage) }
          }
          // Late-start complement: after fixing a crammed opening, pull any line
          // whose start sits AFTER its true vocal onset back to the acoustic onset.
          const spans = computeLineMatchedSpans(
            refined.lines.map((l) => l.original || l.translation),
            sanitizeTranscript(transcriptWords),
          )
          refined = { ...refined, lines: backfillLateStartsToAcousticOnset(refined.lines, spans, vocalSig) }
        } catch {
          /* acoustic anchor is best-effort — never fail the align over it */
        }
      }

      const updated: Song = {
        ...song,
        lyrics: applyRefinedAlignment(
          // Stamp gapRecoveryVersion here too: this flow already ran its own gap
          // re-transcription pass above, so a leftover unrecoverable hole (some are
          // rejected by accept-if-better) must NOT trip the stored-song auto-recovery
          // on the next open — it would re-decode + re-load Whisper to re-attempt the
          // exact same audio/text. applyRefinedAlignment doesn't carry it, so pass it
          // in the lyrics arg (mirrors transcriptWords).
          { ...song.lyrics, alignmentMode: 'auto', transcriptWords, gapRecoveryVersion: GAP_RECOVERY_VERSION },
          refined,
        ),
        syncState: computeSyncState({ ...song, lyrics: { ...song.lyrics, lines: refined.lines } }),
      }
      await db.songs.put(updated)

      // Warn when the content match is weak, not only when it fully falls back to
      // proportional — a mediocre 0.5–0.7 confidence (dense/bilingual tracks Whisper
      // mis-transcribes) still ships unreliable per-line timings silently otherwise.
      setLowConfidence(
        refined.mode === 'proportional' || refined.confidence < LOW_CONFIDENCE_WARN_THRESHOLD,
      )
      setStage('done')
      onComplete(updated)
    } catch (e: unknown) {
      if (cancelledRef.current) return
      setError(classifyAlignError(e))
      setErrorDetail(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }

  // Gate the first-ever model download behind an explicit prompt; every run after
  // the flag is set proceeds straight to start().
  const beginAlign = () => {
    if (!modelDownloadConsented) {
      setAwaitingConsent(true)
      return
    }
    void start()
  }

  const consentAndStart = () => {
    setModelDownloadConsented(true)
    setAwaitingConsent(false)
    void start()
  }

  // Low-confidence result → let the user re-run once with vocal isolation in a
  // single tap (pre-selects the option so start() actually separates this time).
  const rerunWithVocalIsolation = () => {
    setVocalSeparation(true)
    setVocalSeparationEnabled(true)
    void start({ forceVocalSeparation: true })
  }

  useEffect(() => {
    // Skip when the first-run consent prompt is showing; consentAndStart() runs it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: kick off alignment on mount
    if (willAutoStart && modelDownloadConsented) void start()
    return () => { cancelledRef.current = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeSteps = alignSteps(tier, vocalSeparationRun)
  const activeStage: AlignStage | null =
    stage === 'preparing' || stage === 'separating' || stage === 'loading' || stage === 'transcribing' || stage === 'aligning'
      ? stage
      : null
  const taskProgress =
    activeStage === 'aligning' || activeStage === 'preparing'
      ? null
      : activeStage === 'transcribing' && transcribeMerging
        ? null
      : activeStage === 'loading'
        ? loadTaskProgress(lastLoadProgress, loadPhase)
        : progress > 0
          ? progress
          : null

  const stageDetail: Partial<Record<AlignStage, string>> = {
    preparing: 'Reading and decoding your audio file — longer songs take longer here',
    separating: 'Isolating vocals before transcription',
    loading: loadDetail ?? `Checking cached model files (first run downloads ${downloadHint})`,
    transcribing: retryNotice ?? (transcribeMerging
      ? transcribePhase === 'finalizing'
        ? 'Packaging transcript — almost ready (can take a few minutes on long songs)'
        : 'Finalizing transcript — merging chunks (can take a few minutes on long songs)'
      : tier === 'lite'
        ? 'On-device speech recognition — can take a few minutes on phones'
        : 'Running on-device speech recognition'),
    aligning: gapRecovery ?? 'Matching the transcript to your lyric lines',
  }

  const taskStatus =
    activeStage && (taskProgress == null || activeStage === 'aligning' || activeStage === 'loading')
      ? stageDetail[activeStage] ?? null
      : null

  const loadingSubsteps = activeStage === 'loading' && loadPhase === 'init'
    ? [
        { label: 'Model files downloaded', state: 'done' as const },
        { label: 'Initializing on-device runtime', state: 'active' as const },
      ]
    : activeStage === 'loading' && (lastLoadProgress?.filesCompleted ?? 0) > 0
      ? [
          { label: 'Downloading model files', state: 'active' as const },
          { label: 'Initializing on-device runtime', state: 'pending' as const },
        ]
      : undefined

  const stepsWithDetail = activeSteps.map((step, i) => {
    const keys: AlignStage[] = vocalSeparationRun
      ? ['preparing', 'separating', 'loading', 'transcribing', 'aligning']
      : ['preparing', 'loading', 'transcribing', 'aligning']
    const key = keys[i]
    const extra = key ? stageDetail[key] : undefined
    return extra ? { ...step, detail: extra } : step
  })

  const isProcessing = activeStage !== null

  // Browser back / refresh / tab-close would silently kill a multi-minute run.
  // The in-app Cancel is confirmed (ConfirmDialog below); this guards the escape
  // routes it can't. Registered only while actively processing, removed again on
  // done/error/idle and on unmount.
  useEffect(() => {
    if (!isProcessing) return
    const warnBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '' // legacy Chromium requires returnValue for the prompt
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [isProcessing])

  const requestClose = () => {
    if (stage === 'done' || stage === 'error') {
      onClose()
      return
    }
    if (isProcessing) setConfirmCancel(true)
    else onClose()
  }

  const tierNote =
    vocalSeparationRun ? 'Vocal separation + transcription'
    : tier === 'full' ? 'Transcription (optional vocal separation available)'
    : tier === 'lite' ? 'Listens to your song on this device and times each lyric line.'
    : 'Your device does not support on-device AI. Please use Tap-through instead.'

  const toggleVocalSeparation = (enabled: boolean) => {
    setVocalSeparation(enabled)
    setVocalSeparationEnabled(enabled)
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end md:items-center justify-center z-50 p-4">
      <div className="relative bg-cinnabar-900 rounded-2xl p-6 max-w-sm w-full space-y-4 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {confirmCancel && (
          <ConfirmDialog
            title="Cancel auto-align?"
            message="Speech recognition and alignment are still running. Stopping now discards all progress."
            confirmLabel="Stop"
            cancelLabel="Keep running"
            onConfirm={() => {
              cancelledRef.current = true
              resetWhisperTranscriber()
              setConfirmCancel(false)
              onClose()
            }}
            onCancel={() => setConfirmCancel(false)}
          />
        )}

        <h2 className="text-white font-semibold text-lg">Auto-Align Lyrics</h2>
        <p className="text-white/50 text-sm">{tierNote}</p>

        {awaitingConsent && (
          <div className="space-y-3">
            <p className="text-sm text-white/80 text-pretty">
              <span className="font-medium text-white">First-song setup</span>
              {' — '}
              this downloads a ~240MB speech model once, then everything runs on your device.
            </p>
            <button
              type="button"
              onClick={consentAndStart}
              className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium touch-manipulation"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full text-white/40 text-sm text-center min-h-10 touch-manipulation"
            >
              Not now
            </button>
          </div>
        )}

        {vocalSeparationSupported && stage === 'idle' && !autoStart && !awaitingConsent && (
          <label className="flex items-start gap-3 rounded-xl bg-cinnabar-900/80 p-3 cursor-pointer touch-manipulation">
            <input
              type="checkbox"
              className="mt-1 accent-cinnabar-accent"
              checked={vocalSeparation}
              disabled={demucsReady === false}
              onChange={(e) => toggleVocalSeparation(e.target.checked)}
            />
            <span className="text-sm text-white/80 text-pretty">
              <span className="font-medium text-white">Isolate vocals first</span>
              {' — '}
              {demucsReady === false
                ? "Vocal isolation isn't available right now — alignment will run on the full mix."
                : demucsReady === null
                  ? 'Checking for vocal separation model…'
                  : 'Slower, but helps on busy mixes with loud instrumentals.'}
            </span>
          </label>
        )}

        {stage === 'idle' && !autoStart && !awaitingConsent && (
          <label className="flex items-start gap-3 rounded-xl bg-cinnabar-900/80 p-3 cursor-pointer touch-manipulation">
            <input
              type="checkbox"
              className="mt-1 accent-cinnabar-accent"
              checked={accurateReadings}
              onChange={(e) => setAccurateReadings(e.target.checked)}
            />
            <span className="text-sm text-white/80 text-pretty">
              <span className="font-medium text-white">Accurate timing (slower)</span>
              {' — '}
              Better furigana and tighter line timing on long songs.
            </span>
          </label>
        )}

        {highAccuracySupported && stage === 'idle' && !autoStart && !awaitingConsent && (
          <label className="flex items-start gap-3 rounded-xl bg-cinnabar-900/80 p-3 cursor-pointer touch-manipulation">
            <input
              type="checkbox"
              className="mt-1 accent-cinnabar-accent"
              checked={highAccuracy}
              onChange={(e) => setHighAccuracy(e.target.checked)}
            />
            <span className="text-sm text-white/80 text-pretty">
              <span className="font-medium text-white">High accuracy (slower)</span>
              {' · '}
              {getWhisperDownloadHint(tier, true)}
              {' — '}
              Uses a larger speech model for more accurate transcription.
            </span>
          </label>
        )}

        {stage === 'idle' && tier !== 'manual' && !autoStart && !awaitingConsent && (
          <button onClick={beginAlign} className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium">
            Start Auto-Align
          </button>
        )}

        {(stage !== 'idle' || autoStart) && stage !== 'error' && stage !== 'done' && activeStage && (
          <ProcessProgress
            steps={stepsWithDetail}
            currentStepIndex={alignStepIndex(tier, activeStage, vocalSeparationRun)}
            taskProgress={taskProgress}
            taskStatus={taskStatus}
            taskSubsteps={loadingSubsteps}
            showElapsed={taskProgress == null}
          />
        )}

        {stage === 'error' && (
          <div className="space-y-3">
            <p className="text-red-400 text-sm">{error}</p>
            {errorDetail && errorDetail !== error && (
              <details className="text-white/40 text-xs">
                <summary className="cursor-pointer touch-manipulation select-none">Technical details</summary>
                <p className="mt-1 break-words font-mono text-white/50">{errorDetail}</p>
              </details>
            )}
            {tier !== 'manual' && (
              <button
                type="button"
                onClick={() => {
                  resetWhisperTranscriber()
                  void start()
                }}
                className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium touch-manipulation"
              >
                Try again
              </button>
            )}
          </div>
        )}
        {stage === 'done' && (
          lowConfidence
            ? <div className="space-y-3">
                <p className="text-yellow-400 text-sm">
                  Alignment is approximate — the vocals were hard to transcribe, so per-line timings may be off.
                  {vocalSeparationSupported && demucsReady === true && !vocalSeparationRun
                    ? ' Turn on “Isolate vocals first” and re-run for a cleaner result, or use Tap-through.'
                    : ' Try Tap-through or double-check your lyrics.'}
                </p>
                {vocalSeparationSupported && demucsReady === true && !vocalSeparationRun && (
                  <button
                    type="button"
                    onClick={rerunWithVocalIsolation}
                    className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium touch-manipulation"
                  >
                    Re-run with vocal isolation
                  </button>
                )}
              </div>
            : <p className="text-green-400 text-sm">Lyrics aligned successfully.</p>
        )}

        {!awaitingConsent && (
          <button onClick={requestClose} className="text-white/40 text-sm w-full text-center min-h-10 touch-manipulation">
            {stage === 'done' ? 'Close' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  )
}

export default AutoAlignFlow
