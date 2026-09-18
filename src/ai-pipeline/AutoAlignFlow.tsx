import { useCallback, useEffect, useRef, useState } from 'react'
import { canUseVocalSeparation, getDeviceTier, probeWebGPUAdapter } from './capability'
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
import { Overlay } from '../core/ui/Overlay'
import { alignSteps, alignStepIndex, type AlignStage } from './alignProgress'
import { preferredWhisperTimestampMode } from './alignTimestampMode'
import { detectSheetLanguage } from './whisperLanguage'
import { isRecoverableTranscriptionError, classifyAlignError, isNetworkFailure } from './workerError'
import { resetWhisperTranscriber, transcribeAudio, type LoadProgress, type TranscribeProgressStatus } from './whisperTranscriber'
import { DEMUCS_OUTPUT_SAMPLE_RATE, SeparationAbandonedError, isDemucsModelAvailable, refreshDemucsModelAvailability, separateVocals } from './demucsSeparator'
import { formatEta } from './separationEta'
import { computeVocalActivityAsync, firstVocalOnset, type VocalActivitySignal } from './vocalActivity'
import { assessStemPass, assessStemQuality, warnIfStemPassWeak, warnIfStemRejected } from './stemQuality'
import { anchorLeadingEdge, backfillLateStartsToAcousticOnset } from '../lyrics/leadingEdgeAnchor'
import { computeLineMatchedSpans } from './contentAligner'
import { applyLrcPrior, usablePriorTimes } from '../lyrics/lrcPrior'
import { useSettingsStore } from '../payment/SettingsStore'
import { yieldToMainThread } from '../core/idle'

interface Props {
  song: Song
  onComplete: (updated: Song) => void
  onClose: () => void
  /** When true, begin alignment as soon as the flow opens (e.g. fresh audio upload). */
  autoStart?: boolean
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

/** Unverified lines (carrying sheet text but not corroborated by the audio) above
 * which the result screen offers the OTHER timestamp mode as a one-tap re-run.
 * Six mirrors the floor `accurateRealignReason` uses to call a result weak ("a
 * handful of stray rows belongs to the off-timing banner") — and it is deliberately
 * NOT tied to the overall confidence: measured live on the AKFG THE FIRST TAKE
 * recording, the mix pass was confident with 20 of 30 rows verified and still left
 * 4 lines more than 3s out, which the word→segment switch fixes. */
const MODE_RETRY_MIN_UNVERIFIED = 6

export function AutoAlignFlow({ song, onComplete, onClose, autoStart = false }: Props) {
  const tier = getDeviceTier()
  const vocalSeparationSupported = canUseVocalSeparation(tier)
  const vocalSeparationDefault = useSettingsStore((s) => s.vocalSeparationEnabled)
  const setVocalSeparationEnabled = useSettingsStore((s) => s.setVocalSeparationEnabled)
  // First-run download consent: the very first alignment pulls a ~240MB speech
  // model. Gate that first download behind an explicit prompt, remembered once.
  const modelDownloadConsented = useSettingsStore((s) => s.modelDownloadConsented)
  const setModelDownloadConsented = useSettingsStore((s) => s.setModelDownloadConsented)
  // Vocal isolation is the highest-impact accuracy lever, so it defaults ON on
  // capable (full-tier) devices — a destroyed stem is caught by the sanity guard
  // in start() and falls back to the raw mix, so default-on can't regress a song.
  // `vocalSeparationDefault` is tri-state: null = use this default, true/false =
  // an explicit user choice (always honored). The user can still uncheck it here.
  // A song whose stem already proved useless starts with the toggle OFF, so what
  // the screen shows matches what the run will do. Ticking it is then an explicit
  // "try anyway" (see vocalSeparationForced) rather than a no-op that looked on.
  const [vocalSeparation, setVocalSeparation] = useState(
    vocalSeparationSupported
      && (vocalSeparationDefault ?? true)
      && song.audioIsolationVerdict !== 'unusable',
  )
  const [demucsReady, setDemucsReady] = useState<boolean | null>(null)
  const [vocalSeparationRun, setVocalSeparationRun] = useState(false)
  // Whether the user (or the re-run affordance) asked for isolation directly, as
  // opposed to it being the remembered default. An explicit ask overrides the
  // per-song "isolation was useless here" memory below.
  const [vocalSeparationForced, setVocalSeparationForced] = useState(false)
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
  // The timestamp mode the last run used, so the low-confidence result can offer
  // the OTHER one (the only lever a user has over the long-form word-merge
  // failure — see alignTimestampMode.ts).
  const [lastTimestampMode, setLastTimestampMode] = useState<'word' | 'segment' | null>(null)
  // How many content-bearing lines the last run could NOT verify. Drives the
  // "different timestamps" offer below: a run can be perfectly confident overall
  // (so the low-confidence screen never appears) and still leave a handful of
  // lines 3s+ out — the case measured live on the AKFG THE FIRST TAKE recording,
  // where the mix pass scored 20/30 verified and still missed 4 lines by >3s.
  const [unverifiedLines, setUnverifiedLines] = useState(0)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const cancelledRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  // Long-run confirmation: holds the pending decision's resolver plus the
  // projected duration to show. Null when no question is outstanding.
  const [etaPrompt, setEtaPrompt] = useState<
    { projectedMs: number; decide: (choice: 'skip' | 'continue') => void } | null
  >(null)
  const [noGpuPrompt, setNoGpuPrompt] = useState<{ decide: (keepGoing: boolean) => void } | null>(null)
  const [remainingLabel, setRemainingLabel] = useState<string | null>(null)
  // Settles whichever prompt is open with its "give up" answer. Without it, a
  // cancel (or unmount) while a prompt is showing leaves start() awaiting a
  // promise that can never resolve.
  const resolveOpenPromptRef = useRef<(() => void) | null>(null)

  /** Single place that stops a run: flips the polled flag AND aborts the signal,
   * so a wedged worker is terminated instead of being politely asked. */
  const cancelRun = useCallback(() => {
    cancelledRef.current = true
    abortRef.current?.abort()
    resolveOpenPromptRef.current?.()
  }, [])

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

  const start = async (opts?: { forceVocalSeparation?: boolean; timestampMode?: 'word' | 'segment' }) => {
    cancelledRef.current = false
    abortRef.current = new AbortController()
    setEtaPrompt(null)
    setNoGpuPrompt(null)
    setRemainingLabel(null)
    resolveOpenPromptRef.current = null
    setError('')
    setErrorDetail(null)
    try {
      let audioData: Float32Array | null = null
      let sampleRate = 44100
      // The decoded mix as-is, retained so a stem that transcribes badly can be
      // discarded AFTER transcription without decoding again (see the
      // post-transcription stem guard below).
      let decodedMix: Float32Array | null = null
      let decodedMixRate = 44100
      // Whether a separated stem passed the sanity guard and is what we transcribe.
      // Distinct from `willSeparate`/`vocalSeparationRun` (separation was attempted):
      // a destroyed stem is rejected and we transcribe the raw mix instead.
      let stemAccepted = false
      // Per-song memory of whether isolation was worth its cost here. Set when a
      // stem is discarded (before or after transcription), cleared when a stem is
      // used — so the next align on this song skips a separation it would throw away.
      let isolationVerdict: 'unusable' | 'ok' | undefined
      // Stem vocal-activity envelope, computed once at separation and reused by the
      // leading-edge onset anchor below (stem-only) — null when running on the mix.
      let vocalSig: VocalActivitySignal | null = null

      setStage('preparing')
      setProgress(0)
      setLoadDetail(null)
      setRetryNotice(null)

      // Per-song memory: a stem that proved useless last time is not worth the
      // separation again (measured: ~17 minutes on a 6:33 track), so the remembered
      // verdict silences the default — but never an explicit ask.
      const isolationKnownUseless = song.audioIsolationVerdict === 'unusable'
      const isolationForced = opts?.forceVocalSeparation === true || vocalSeparationForced
      const willSeparate =
        (isolationForced || (vocalSeparation && !isolationKnownUseless))
        && vocalSeparationSupported
        && await isDemucsModelAvailable()
      setVocalSeparationRun(willSeparate)
      if (isolationKnownUseless && !isolationForced) {
        // Say it rather than silently ignoring the remembered default: the toggle
        // stays visible (now unchecked) and ticking it separates anyway.
        console.info('[AutoAlignFlow] isolation skipped — it produced no usable stem for this song before')
        setRetryNotice('Skipped vocal isolation — it did not help on this song before. Tick “Isolate vocals first” to try again anyway.')
      }

      if (song.audioStoredPath) {
        const file = await getAudioFile(song.id)
        const decoded = await decodeAudioFileToMono(file)
        audioData = decoded.data
        sampleRate = decoded.sampleRate
        // Retained separately: a stem that transcribes badly must be able to fall
        // back to the mix WITHOUT decoding again (see the post-transcription stem
        // guard below). `audioData`/`sampleRate` are reassigned to the stem when
        // isolation is accepted.
        decodedMix = decoded.data
        decodedMixRate = decoded.sampleRate
      }

      if (!audioData) { setError('No audio file found. Upload audio first.'); setStage('error'); return }

      // Cancel can land while the file is being decoded ("Preparing audio"). With
      // isolation off (or unavailable) nothing checked the flag again until AFTER
      // the model load and the whole transcription had run, so Stop still paid
      // minutes of CPU for a run it had already thrown away.
      if (cancelledRef.current) return

      // A definitive "no adapter" means separation WILL run on WASM — minutes
      // become tens of minutes. Ask before paying for the model download, not
      // after. Uses the same prompt machinery as the post-chunk-1 estimate.
      let separationAccepted = true
      if (willSeparate && !(await probeWebGPUAdapter())) {
        separationAccepted = await new Promise<boolean>((resolve) => {
          const decide = (keepGoing: boolean) => {
            resolveOpenPromptRef.current = null
            setNoGpuPrompt(null)
            resolve(keepGoing)
          }
          resolveOpenPromptRef.current = () => decide(false)
          setNoGpuPrompt({ decide })
        })
        if (cancelledRef.current) return
        if (!separationAccepted) {
          // The separation step never runs, so drop it from the progress steps
          // rather than showing a stage that will be skipped.
          setVocalSeparationRun(false)
          setRetryNotice('Skipped vocal isolation — aligning on the original mix instead.')
        }
      }

      if (willSeparate && separationAccepted) {
        setStage('separating')
        setProgress(0)
        try {
          const stem = await separateVocals(audioData, {
            sampleRate,
            durationSec: audioData.length / sampleRate,
            signal: abortRef.current.signal,
            onProgress: (pct) => setProgress(pct),
            isCancelled: () => cancelledRef.current,
            onProvider: (provider) => {
              // No automated test can exercise a real WebGPU device, so this log
              // is how a "separation took an hour" report gets diagnosed.
              console.info(`[AutoAlignFlow] vocal separation running on ${provider}`)
            },
            onLongEstimate: (projectedMs) =>
              new Promise<'skip' | 'continue'>((resolve) => {
                const decide = (choice: 'skip' | 'continue') => {
                  resolveOpenPromptRef.current = null
                  setEtaPrompt(null)
                  resolve(choice)
                }
                resolveOpenPromptRef.current = () => decide('skip')
                setEtaPrompt({ projectedMs, decide })
              }).then((choice) => {
                if (choice === 'continue') setRemainingLabel(formatEta(projectedMs))
                return choice
              }),
          })
          if (cancelledRef.current) return
          // Sanity-guard the stem BEFORE committing to it. Isolation usually helps,
          // but on some tracks Demucs destroys the vocal (near-silent stem) and
          // transcribing that is strictly worse than the raw mix. A rejected stem
          // falls back to the mix — identical to isolation being off — so the guard
          // can never regress a song. The vocal-activity envelope computed here is
          // reused by the leading-edge onset anchor below, so this adds no extra DSP.
          // Demucs returns vocals at ITS model rate (44100), never the decode rate;
          // on a 48kHz AudioContext (common on Firefox) keeping the decode rate
          // scaled every Whisper timestamp ~8.8% early and desynced the whole song —
          // so the stem path uses DEMUCS_OUTPUT_SAMPLE_RATE and the mix-fallback path
          // keeps the decode rate.
          const stemSig = await computeVocalActivityAsync(stem, DEMUCS_OUTPUT_SAMPLE_RATE, { source: 'stem' })
          const verdict = assessStemQuality(stemSig, stem.length / DEMUCS_OUTPUT_SAMPLE_RATE)
          if (verdict.usable) {
            audioData = stem
            sampleRate = DEMUCS_OUTPUT_SAMPLE_RATE
            stemAccepted = true
            isolationVerdict = 'ok'
            vocalSig = stemSig
          } else {
            // Keep the decoded mix (audioData/sampleRate unchanged) and transcribe
            // that. Surface it so the user understands why isolation had no effect.
            warnIfStemRejected('auto-align', verdict)
            isolationVerdict = 'unusable'
            setRetryNotice('Vocal isolation produced no usable vocals — aligning on the original mix instead.')
          }
        } catch (e) {
          if (cancelledRef.current) return
          // Isolation is default-on, so a Demucs failure must NEVER kill the align.
          // audioData is still the decoded mix here (it's only reassigned to the stem
          // on success), so just fall back to transcribing that — same as stored-song
          // gap recovery and the stem-quality guard. Isolation can only ever help or
          // no-op, never abort.
          setRemainingLabel(null)
          if (e instanceof SeparationAbandonedError) {
            console.warn(`[AutoAlignFlow] vocal isolation abandoned (${e.reason}) — aligning on the raw mix`)
            setRetryNotice(
              e.reason === 'skipped'
                ? 'Skipped vocal isolation — aligning on the original mix instead.'
                : e.reason === 'stalled'
                  ? 'Vocal isolation stopped responding — aligning on the original mix instead.'
                  : 'Vocal isolation was taking too long on this device — aligning on the original mix instead.',
            )
          } else {
            // The classified reason goes to the console for triage.
            console.warn('[AutoAlignFlow] vocal isolation failed — aligning on the raw mix:', classifyVocalSepError(e))
            setRetryNotice('Vocal isolation is unavailable here — aligning on the original mix instead.')
          }
        }
        if (cancelledRef.current) return
        setRemainingLabel(null)
        // The separation step is over, one way or another. An ETA prompt the user
        // left open (or a no-GPU prompt) would otherwise stay rendered over every
        // remaining stage — loading, transcribing, aligning — offering a decision
        // the run can no longer honour (a late answer is dropped by the host's own
        // `settled` guard). Clearing here also releases the pending promise.
        setEtaPrompt(null)
        setNoGpuPrompt(null)
        resolveOpenPromptRef.current = null
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
      // has a repetition-loop hallucination pathology that segment mode avoids. An
      // explicit per-run override (the low-confidence screen's "Try segment
      // timestamps") takes precedence over the policy, since the whole point is to
      // reach the OTHER mode than the one that just produced this result.
      const timestampMode = opts?.timestampMode
        ?? (useHighAccuracy ? 'segment' : preferredWhisperTimestampMode(tier, durationSec))
      // Remembered for the result screen: whether the run that just finished could
      // still be improved by switching modes.
      setLastTimestampMode(timestampMode)
      // Same reasoning as the separation-provider log: which of the two timestamp
      // modes produced a set of timings is otherwise unknowable from the result, and
      // it is the single biggest quality lever on the songs that fail. Also what a
      // headless run (the dev harness) reads back to prove the mode it requested.
      console.info(`[AutoAlignFlow] timestamp mode: ${timestampMode}`)

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
        // Non-null: the flow returns early when there is no audio, and nothing
        // between there and here clears it.
        const audio = audioData as Float32Array
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
            // Shown in the transcribing stage's detail area (loadDetail never
            // rendered there — the bar just snapped to 0 unexplained).
            // A load/interrupted-download failure lands in this same rung, so it
            // must not be described as memory pressure: that sends the user off to
            // close tabs for a problem that is their connection.
            setRetryNotice(
              isNetworkFailure(e)
                ? 'Downloading the speech model was interrupted — retrying…'
                : 'Word-level pass failed (likely out of memory) — retrying with segment timestamps…',
            )
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
      // One full transcribe+align pass over whatever `audioData`/`sampleRate`
      // currently hold. Extracted so the post-transcription stem guard below can
      // repeat it on the decoded mix when the stem's transcript turns out to be
      // unverifiable. Returns null when the user cancelled.
      const runPasses = async (): Promise<
        { refined: RefinedAlignment; transcriptWords: TranscriptWord[] } | null
      > => {
        let refined: RefinedAlignment
        let transcriptWords: TranscriptWord[]
        if (alignmentLanguage === 'mixed') {
          // Code-switching sheet: per-chunk language auto-detect garbles whichever
          // language loses each 30s window and collapses content-match confidence
          // to the proportional fallback. Transcribe twice with a forced language
          // instead and merge per line by alignment quality.
          const jaTranscript = await transcribeWithFallback('ja', (p) => p / 2)
          if (cancelledRef.current) return null
          // The EN pass always runs at segment granularity, regardless of the
          // user's word-mode setting: the merge only takes line-level times from
          // it, and Whisper's forced-EN word timestamps on sung vocals are
          // unreliable enough to fail the confidence gate and waste the pass.
          const enTranscript = await transcribeWithFallback('en', (p) => 50 + p / 2, 'segment')
          if (cancelledRef.current) return null

          setTranscribeMerging(false)
          setTranscribePhase('transcribing')
          setStage('aligning')
          setProgress(0)
          await yieldToMainThread()
          const mixed = refineMixedLanguageAlignment(sheetRows, chunksToWords(jaTranscript), chunksToWords(enTranscript), vocalSig ?? undefined)
          refined = mixed.refined
          transcriptWords = mixed.transcriptWords
        } else {
          const transcriptResult = await transcribeWithFallback(alignmentLanguage, (p) => p)
          if (cancelledRef.current) return null

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
            // Feed the accepted vocal stem's envelope to the acoustic label-honesty
            // gate (demotes confident lines that sit on non-vocal audio). Null when
            // isolation is off/failed/rejected → text-only, gate no-ops.
            { vocalActivity: vocalSig ?? undefined },
          )
        }
        return { refined, transcriptWords }
      }

      const firstPass = await runPasses()
      if (!firstPass) return
      let refined: RefinedAlignment = firstPass.refined
      let transcriptWords: TranscriptWord[] = firstPass.transcriptWords

      // Post-transcription stem guard. `assessStemQuality` (before transcription)
      // only catches a DESTROYED stem; it cannot see a stem that holds plenty of
      // vocal-band energy and still transcribes badly — measured live on AKFG
      // "Rock'n'Roll, Morning Light Falls on You" (THE FIRST TAKE), where isolation
      // cost 15.4s mean error against 2.8s on the mix, 0 of 30 rows verified
      // against 21. Falling back to the mix is exactly what isolation-off would
      // have done, so isolation still can never make a song worse than not using it.
      if (stemAccepted && decodedMix) {
        const verdict = assessStemPass(refined.lines, refined.lineAlignmentQuality, 'stem')
        if (verdict.weak) {
          warnIfStemPassWeak('auto-align', verdict)
          isolationVerdict = 'unusable'
          audioData = decodedMix
          sampleRate = decodedMixRate
          stemAccepted = false
          // The stem envelope describes audio we are no longer aligning: left in
          // place it would gate the mix alignment on a stem's bleed.
          vocalSig = null
          setRetryNotice('Vocal isolation produced a transcript it could not verify — re-aligning on the original mix…')
          setStage('transcribing')
          setProgress(0)
          const mixPass = await runPasses()
          if (!mixPass) return
          refined = mixPass.refined
          transcriptWords = mixPass.transcriptWords
          setRetryNotice(null)
        }
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
          refineOpts: { lyricsBase: song.lyrics, options: { vocalActivity: vocalSig ?? undefined } },
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

      // LRC-prior guardrail: when the song already carries OUTSIDE timing (a
      // pasted LRC, a subtitle, a lyrics-database entry), use it as a monotonic
      // prior so a confident-but-wrong transcript match can't drop a line onto
      // entirely different content. Pure — needs no audio/stem — and a no-op for
      // plain-text songs (all startTimes 0), so freshly-added untimed songs and
      // the offline corpus are byte-identical. Runs before the acoustic onset
      // anchor so that pass sharpens the opening within the prior.
      //
      // "Outside" excludes this pipeline's own output — see usablePriorTimes: a
      // re-run must not be anchored to the timings it is meant to improve.
      {
        const priorTimes = usablePriorTimes(song.lyrics, refined.lines.length)
        if (priorTimes) {
          const priorSpans = computeLineMatchedSpans(
            refined.lines.map((l) => l.original || l.translation),
            sanitizeTranscript(transcriptWords),
          )
          refined = { ...refined, lines: applyLrcPrior(refined.lines, priorSpans, priorTimes) }
        }
      }

      // Leading-edge onset anchor: if the aligner crammed the opening lines onto
      // an instrumental intro (no content anchor there, so they interpolate to
      // t=0), pull them forward to where the vocals actually begin. Stem-only —
      // a mis-heard intro transcript can't locate the onset (round-7 early-start
      // pull off transcript firstTime regressed; the acoustic envelope is the
      // signal that was missing then). Best-effort and a no-op without a vocal
      // stem, so non-isolated runs are byte-identical.
      if (audioData && stemAccepted && vocalSig) {
        try {
          const onset = firstVocalOnset(vocalSig)
          // Content-match spans double as the leading-edge anchor's trust signal
          // (which opening lines are real content vs interpolated filler) and the
          // late-start snapper's coverage gate. Text→transcript matching only, so
          // position-independent — computing once before either pass is correct.
          const spans = computeLineMatchedSpans(
            refined.lines.map((l) => l.original || l.translation),
            sanitizeTranscript(transcriptWords),
          )
          if (onset != null) {
            refined = { ...refined, lines: anchorLeadingEdge(refined.lines, onset, alignmentLanguage, { spans, transcriptWords }) }
          }
          // Late-start complement: after fixing a crammed opening, pull any line
          // whose start sits AFTER its true vocal onset back to the acoustic onset.
          refined = { ...refined, lines: backfillLateStartsToAcousticOnset(refined.lines, spans, vocalSig) }
        } catch {
          /* acoustic anchor is best-effort — never fail the align over it */
        }
      }

      const updated: Song = {
        ...song,
        // Only ever written by a run that actually tried isolation, so a plaintext
        // mix align cannot erase a previous verdict... except to CLEAR it when a
        // stem is used, which means the audio (or the model) now separates well.
        ...(isolationVerdict ? { audioIsolationVerdict: isolationVerdict } : {}),
        lyrics: applyRefinedAlignment(
          // Stamp gapRecoveryVersion here too: this flow already ran its own gap
          // re-transcription pass above, so a leftover unrecoverable hole (some are
          // rejected by accept-if-better) must NOT trip the stored-song auto-recovery
          // on the next open — it would re-decode + re-load Whisper to re-attempt the
          // exact same audio/text. applyRefinedAlignment doesn't carry it, so pass it
          // in the lyrics arg (mirrors transcriptWords).
          {
            ...song.lyrics,
            alignmentMode: 'auto',
            transcriptWords,
            gapRecoveryVersion: GAP_RECOVERY_VERSION,
            // Keep the envelope so drag re-timing can snap onto a real vocal
            // onset later without re-running Demucs. Only the STEM signal is
            // worth keeping: the mix-derived one is a weaker prior, and snapping
            // a vocal entry to a drum transient is worse than not snapping. An
            // undefined value here (isolation off, stem rejected, YouTube) drops
            // the field and correctly disables snapping rather than faking it.
            vocalActivity: stemAccepted && vocalSig ? vocalSig : undefined,
          },
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
      {
        const quality = refined.lineAlignmentQuality ?? []
        let unverified = 0
        for (let i = 0; i < refined.lines.length; i++) {
          const text = (refined.lines[i].original || refined.lines[i].translation || '').trim()
          if (text && quality[i] !== 'good') unverified++
        }
        setUnverifiedLines(unverified)
      }
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
    setVocalSeparationForced(true)
    void start({ forceVocalSeparation: true })
  }

  useEffect(() => {
    // Skip when the first-run consent prompt is showing; consentAndStart() runs it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: kick off alignment on mount
    if (willAutoStart && modelDownloadConsented) void start()
    return () => { cancelRun() }
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
    if (enabled) setVocalSeparationForced(true)
  }

  return (
    // This screen previously had no role, no aria-modal and no Escape/Back
    // handling at all — only its own "Cancel"/"Not now"/"Close" buttons.
    // <Overlay> adds those structurally; requestClose already carries the
    // right guard (route through the confirm when a run is in progress),
    // so wiring Escape/Back to it is a straightforward extension, not new
    // policy. items-end/md:items-center (row cross-axis) and justify-center
    // (row main-axis) become justify-end/md:justify-center and items-center
    // once flex-col is forced by the fullscreen placement.
    <Overlay
      onClose={requestClose}
      placement="fullscreen"
      label="Auto-Align Lyrics"
      backdropClassName="justify-end md:justify-center items-center bg-black/80 p-4"
    >
      <div className="relative bg-cinnabar-900 rounded-2xl p-6 max-w-sm w-full space-y-4 max-h-[90dvh] overflow-y-auto">
        {confirmCancel && (
          <ConfirmDialog
            title="Cancel auto-align?"
            message="Speech recognition and alignment are still running. Stopping now discards all progress."
            confirmLabel="Stop"
            cancelLabel="Keep running"
            onConfirm={() => {
              cancelRun()
              resetWhisperTranscriber()
              setConfirmCancel(false)
              onClose()
            }}
            onCancel={() => setConfirmCancel(false)}
          />
        )}

        {/* Only one dialog may own the overlay: the cancel confirmation wins,
            and its "Keep running" brings the pending question back.

            Both questions put "Keep going" on confirm and "Skip it" on cancel,
            which reads backwards next to the cancel dialog above but is
            deliberate: useModalDialog maps Escape to onCancel, so this is what
            makes Escape mean "back out of the expensive thing". Committing to a
            multi-minute CPU grind is the costly, hard-to-undo choice here — so
            it belongs on confirm, and skipping (which still yields aligned
            lyrics, just from the raw mix) is the safe default Escape lands on. */}
        {!confirmCancel && etaPrompt && (
          <ConfirmDialog
            title="This will take a while"
            message={`Isolating vocals will take ${formatEta(etaPrompt.projectedMs)} on this device. You can skip it and align on the original mix — slightly less accurate, but much faster.`}
            confirmLabel="Keep going"
            cancelLabel="Skip it"
            onConfirm={() => etaPrompt.decide('continue')}
            onCancel={() => etaPrompt.decide('skip')}
          />
        )}
        {!confirmCancel && noGpuPrompt && (
          <ConfirmDialog
            title="No GPU acceleration here"
            message="This browser can't use your GPU for vocal isolation, so it would run on the CPU — usually far longer than the song itself. You can skip it and align on the original mix: slightly less accurate, but much faster."
            confirmLabel="Keep going"
            cancelLabel="Skip it"
            onConfirm={() => noGpuPrompt.decide(true)}
            onCancel={() => noGpuPrompt.decide(false)}
          />
        )}

        <h2 className="text-white font-semibold text-lg">Auto-Align Lyrics</h2>
        <p className="text-white/50 text-sm">{tierNote}</p>

        {awaitingConsent && (
          <div className="space-y-3">
            <p className="text-sm text-white/80 text-pretty">
              <span className="font-medium text-white">First-song setup</span>
              {' — '}
              this downloads a ~240MB speech model
              {vocalSeparation && vocalSeparationSupported ? ' (plus a ~65MB vocal-isolation model)' : ''}
              {' '}once, then everything runs on your device.
            </p>
            <button
              type="button"
              onClick={consentAndStart}
              className="w-full py-3 bg-cinnabar-accent text-cinnabar-950 rounded-xl font-medium touch-manipulation"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full text-white/60 text-sm text-center min-h-10 touch-manipulation"
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
          <button onClick={beginAlign} className="w-full py-3 bg-cinnabar-accent text-cinnabar-950 rounded-xl font-medium">
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

        {stage === 'separating' && remainingLabel && (
          <p className="text-white/55 text-xs text-center">{remainingLabel} remaining</p>
        )}

        {stage === 'error' && (
          <div className="space-y-3">
            <p className="text-red-400 text-sm">{error}</p>
            {errorDetail && errorDetail !== error && (
              <details className="text-white/60 text-xs">
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
                className="w-full py-3 bg-cinnabar-accent text-cinnabar-950 rounded-xl font-medium touch-manipulation"
              >
                Try again
              </button>
            )}
          </div>
        )}
        {stage === 'done' && (
          <div className="space-y-3">
            {lowConfidence
              ? (
                <p className="text-yellow-400 text-sm">
                  Alignment is approximate — the vocals were hard to transcribe, so per-line timings may be off.
                  {vocalSeparationSupported && demucsReady === true && !vocalSeparationRun
                    ? ' Turn on “Isolate vocals first” and re-run for a cleaner result, or use Tap-through.'
                    : ' Try Tap-through or double-check your lyrics.'}
                </p>
              )
              : <p className="text-green-400 text-sm">Lyrics aligned successfully.</p>}
            {lowConfidence && vocalSeparationSupported && demucsReady === true && !vocalSeparationRun && (
              <button
                type="button"
                onClick={rerunWithVocalIsolation}
                className="w-full py-3 bg-cinnabar-accent text-cinnabar-950 rounded-xl font-medium touch-manipulation"
              >
                Re-run with vocal isolation
              </button>
            )}
            {/* The other timestamp mode. Offered when the result is flagged — or
                when enough individual lines stayed unverified, which is the shape a
                CONFIDENT word-mode run leaves behind: measured live on the AKFG THE
                FIRST TAKE recording, the mix pass came back confident with 20 of 30
                rows verified and still missed 4 lines by more than 3s, which the
                word→segment switch fixes (0.4s vs 2.8s mean error on that audio). */}
            {lastTimestampMode === 'word' && (lowConfidence || unverifiedLines >= MODE_RETRY_MIN_UNVERIFIED) && (
              <button
                type="button"
                onClick={() => void start({ timestampMode: 'segment' })}
                className="w-full py-3 bg-cinnabar-800 text-white/90 rounded-xl font-medium touch-manipulation border border-cinnabar-700"
              >
                Try again with segment timestamps
              </button>
            )}
          </div>
        )}

        {!awaitingConsent && (
          <button onClick={requestClose} className="text-white/60 text-sm w-full text-center min-h-10 touch-manipulation">
            {stage === 'done' ? 'Close' : 'Cancel'}
          </button>
        )}
      </div>
    </Overlay>
  )
}

export default AutoAlignFlow
