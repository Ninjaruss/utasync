import { useEffect, useRef, useState } from 'react'
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
import { db } from '../core/db/schema'
import { computeSyncState } from '../core/db/migrations'
import { ProcessProgress } from '../core/ui/ProcessProgress'
import { ConfirmDialog } from '../core/ui/ConfirmDialog'
import { alignSteps, alignStepIndex, type AlignStage } from './alignProgress'
import { preferredWhisperTimestampMode } from './alignTimestampMode'
import { detectSheetLanguage } from './whisperLanguage'
import { isRecoverableTranscriptionError } from './workerError'
import { resetWhisperTranscriber, transcribeAudio, type LoadProgress, type TranscribeProgressStatus } from './whisperTranscriber'
import { DEMUCS_OUTPUT_SAMPLE_RATE, isDemucsModelAvailable, refreshDemucsModelAvailability, separateVocals } from './demucsSeparator'
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
  const vocalSeparationDefault = useSettingsStore((s) => s.vocalSeparationEnabled)
  const setVocalSeparationEnabled = useSettingsStore((s) => s.setVocalSeparationEnabled)
  const [vocalSeparation, setVocalSeparation] = useState(vocalSeparationDefault)
  const [demucsReady, setDemucsReady] = useState<boolean | null>(null)
  const [vocalSeparationRun, setVocalSeparationRun] = useState(false)
  // D2: opt into the slower word-level Whisper pass for more reliable readings on
  // long songs (short songs already use word mode; lite tier always uses segment).
  const [accurateReadings, setAccurateReadings] = useState(accurateReadingsInitial)
  // D8: opt into whisper-medium (full tier only) for more accurate transcription
  // at the cost of a larger download and slower inference.
  const [highAccuracy, setHighAccuracy] = useState(false)
  const [stage, setStage] = useState<Stage>(() =>
    autoStart && tier !== 'manual' ? 'preparing' : 'idle',
  )
  const [progress, setProgress] = useState(0)
  const [transcribeMerging, setTranscribeMerging] = useState(false)
  const [transcribePhase, setTranscribePhase] = useState<TranscribeProgressStatus>('transcribing')
  const [loadDetail, setLoadDetail] = useState<string | null>(null)
  // Round-8 gap re-transcription: a status line shown during the aligning stage
  // while unaligned sections are being recovered ("Recovering N section(s)…").
  const [gapRecovery, setGapRecovery] = useState<string | null>(null)
  const [loadPhase, setLoadPhase] = useState<'download' | 'init'>('download')
  const [lastLoadProgress, setLastLoadProgress] = useState<LoadProgress | null>(null)
  const [error, setError] = useState('')
  const [lowConfidence, setLowConfidence] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const cancelledRef = useRef(false)

  const vocalSeparationSupported = canUseVocalSeparation(tier)
  const highAccuracySupported = canUseHighAccuracy(tier)
  // Reflect the selected model so the download-progress copy shows ~1.5GB during
  // a high-accuracy (medium) download, not the small model's ~240MB.
  const downloadHint = getWhisperDownloadHint(tier, highAccuracy && highAccuracySupported)

  useEffect(() => {
    if (!vocalSeparationSupported) return
    void refreshDemucsModelAvailability().then(setDemucsReady)
  }, [vocalSeparationSupported])

  useEffect(() => {
    if (!vocalSeparationSupported || stage !== 'idle') return
    void refreshDemucsModelAvailability().then(setDemucsReady)
  }, [vocalSeparationSupported, stage])

  const start = async () => {
    cancelledRef.current = false
    setError('')
    try {
      let audioData: Float32Array | null = null
      let sampleRate = 44100

      setStage('preparing')
      setProgress(0)
      setLoadDetail(null)

      const willSeparate =
        vocalSeparation
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
        // Buffer to transcribe; defaults to the whole song. The round-8 gap pass
        // passes a sub-window slice, reusing this crash-downgrade ladder.
        audio: Float32Array = audioData,
      ) => {
        const run = () =>
          transcribeAudio(audio, sampleRate, {
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
            setLoadDetail('Word-level pass failed (likely out of memory) — retrying with segment timestamps…')
          } else if (effectiveHighAccuracy) {
            effectiveHighAccuracy = false
            setLoadDetail('High-accuracy model failed — retrying with the standard model…')
          } else {
            throw e
          }
          setProgress(0)
          return await run()
        }
      }
      const toWords = (t: { chunks?: { text?: string; timestamp?: [number, number] }[] }): TranscriptWord[] =>
        (t.chunks ?? []).flatMap((c) => {
          const [start, end] = c.timestamp ?? []
          const word = c.text?.trim()
          if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
          return [{ word, startTime: start as number, endTime: end as number }]
        })

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
        const mixed = refineMixedLanguageAlignment(sheetRows, toWords(jaTranscript), toWords(enTranscript))
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
        const words = toWords(transcriptResult)
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
        const gapAudio = audioData
        const gapSampleRate = sampleRate
        const transcribeSlice = async (
          t0: number,
          t1: number,
          lang: typeof alignmentLanguage,
        ): Promise<TranscriptWord[]> => {
          const slice = gapAudio.subarray(
            Math.floor(t0 * gapSampleRate),
            Math.floor(t1 * gapSampleRate),
          )
          // Reuse the crash-downgrade ladder and the main pass's transcribe
          // options; inherit the effective timestamp mode. Words come back
          // slice-relative → offset by t0 to absolute song time.
          const sliceResult = await transcribeWithFallback(lang, (p) => p, undefined, slice)
          const offset = toWords(sliceResult).map((word) => ({
            ...word,
            startTime: word.startTime + t0,
            endTime: word.endTime + t0,
          }))
          return sanitizeTranscript(offset)
        }
        const gap = await reanalyzeGaps({
          refined,
          transcriptWords,
          sheetRows,
          alignmentLanguage,
          sourceLanguage: song.lyrics.sourceLanguage,
          transcribeSlice,
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

      const updated: Song = {
        ...song,
        lyrics: applyRefinedAlignment(
          { ...song.lyrics, alignmentMode: 'auto', transcriptWords },
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
      setError(e instanceof Error ? e.message : 'Auto-align failed')
      setStage('error')
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: kick off alignment on mount
    if (autoStart && tier !== 'manual') void start()
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
    transcribing: transcribeMerging
      ? transcribePhase === 'finalizing'
        ? 'Packaging transcript — almost ready (can take a few minutes on long songs)'
        : 'Finalizing transcript — merging chunks (can take a few minutes on long songs)'
      : tier === 'lite'
        ? 'On-device speech recognition — can take a few minutes on phones'
        : 'Running on-device speech recognition',
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
    : tier === 'lite' ? 'Transcription only'
    : 'Your device does not support on-device AI. Please use tap-sync instead.'

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

        {vocalSeparationSupported && stage === 'idle' && !autoStart && (
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
                ? 'Demucs model not installed (see docs/DEPLOYMENT.md). Transcription will run on the full mix.'
                : demucsReady === null
                  ? 'Checking for vocal separation model…'
                  : 'Slower, but helps on busy mixes with loud instrumentals.'}
            </span>
          </label>
        )}

        {stage === 'idle' && !autoStart && (
          <label className="flex items-start gap-3 rounded-xl bg-cinnabar-900/80 p-3 cursor-pointer touch-manipulation">
            <input
              type="checkbox"
              className="mt-1 accent-cinnabar-accent"
              checked={accurateReadings}
              onChange={(e) => setAccurateReadings(e.target.checked)}
            />
            <span className="text-sm text-white/80 text-pretty">
              <span className="font-medium text-white">Word-level timestamps (slower)</span>
              {' — '}
              More reliable furigana and readings on long songs. Timing accuracy varies by song.
            </span>
          </label>
        )}

        {highAccuracySupported && stage === 'idle' && !autoStart && (
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

        {stage === 'idle' && tier !== 'manual' && !autoStart && (
          <button onClick={start} className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium">
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
            ? <p className="text-yellow-400 text-sm">
                Alignment is approximate — the vocals were hard to transcribe, so per-line timings may be off.
                {vocalSeparationSupported && demucsReady === true && !vocalSeparationRun
                  ? ' Turn on Vocal separation and re-run for a cleaner result, or use tap-sync.'
                  : ' Try tap-sync or double-check your lyrics.'}
              </p>
            : <p className="text-green-400 text-sm">Lyrics aligned successfully.</p>
        )}

        <button onClick={requestClose} className="text-white/40 text-sm w-full text-center min-h-10 touch-manipulation">
          {stage === 'done' ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}

export default AutoAlignFlow
