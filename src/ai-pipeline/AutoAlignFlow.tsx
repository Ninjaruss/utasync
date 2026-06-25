import { useEffect, useRef, useState } from 'react'
import { canUseVocalSeparation, getDeviceTier } from './capability'
import { getWhisperDownloadHint } from './models'
import { decodeAudioFileToMono } from '../core/audio/decodeToMono'
import { getAudioFile } from '../core/opfs/audio'
import type { Song } from '../core/types'
import { alignLyrics, sanitizeTranscript, type TranscriptWord } from './aligner'
import { derivePhrases } from '../lyrics/phraseNormalize'
import { db } from '../core/db/schema'
import { computeSyncState } from '../core/db/migrations'
import { ProcessProgress } from '../core/ui/ProcessProgress'
import { ConfirmDialog } from '../core/ui/ConfirmDialog'
import { alignSteps, alignStepIndex, type AlignStage } from './alignProgress'
import { preferredWhisperTimestampMode } from './alignTimestampMode'
import { resetWhisperTranscriber, transcribeAudio, type LoadProgress, type TranscribeProgressStatus } from './whisperTranscriber'
import { isDemucsModelAvailable, refreshDemucsModelAvailability, separateVocals } from './demucsSeparator'
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

function loadTaskProgress(p: LoadProgress | null, phase: 'download' | 'init'): number | null {
  if (phase === 'init') return null
  if (!p) return null
  const pct = p.aggregateProgress ?? p.progress
  if (typeof pct !== 'number' || pct <= 0) return null
  // Per-file 100% is misleading when other files remain — prefer aggregate.
  if (pct >= 100 && p.phase !== 'download') return null
  return Math.min(99, pct)
}

export function AutoAlignFlow({ song, onComplete, onClose, autoStart = false }: Props) {
  const tier = getDeviceTier()
  const downloadHint = getWhisperDownloadHint(tier)
  const vocalSeparationDefault = useSettingsStore((s) => s.vocalSeparationEnabled)
  const setVocalSeparationEnabled = useSettingsStore((s) => s.setVocalSeparationEnabled)
  const [vocalSeparation, setVocalSeparation] = useState(vocalSeparationDefault)
  const [demucsReady, setDemucsReady] = useState<boolean | null>(null)
  const [vocalSeparationRun, setVocalSeparationRun] = useState(false)
  const [stage, setStage] = useState<Stage>(() =>
    autoStart && tier !== 'manual' ? 'preparing' : 'idle',
  )
  const [progress, setProgress] = useState(0)
  const [transcribeMerging, setTranscribeMerging] = useState(false)
  const [transcribePhase, setTranscribePhase] = useState<TranscribeProgressStatus>('transcribing')
  const [loadDetail, setLoadDetail] = useState<string | null>(null)
  const [loadPhase, setLoadPhase] = useState<'download' | 'init'>('download')
  const [lastLoadProgress, setLastLoadProgress] = useState<LoadProgress | null>(null)
  const [error, setError] = useState('')
  const [lowConfidence, setLowConfidence] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const cancelledRef = useRef(false)

  const vocalSeparationSupported = canUseVocalSeparation(tier)

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
            onProgress: (pct) => setProgress(pct),
            isCancelled: () => cancelledRef.current,
          })
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
      const timestampMode = preferredWhisperTimestampMode(tier, durationSec)

      let sawDownload = false
      const transcriptResult = await transcribeAudio(audioData, sampleRate, {
        language: song.lyrics.sourceLanguage,
        timestampMode,
        onLoadProgress: (p) => {
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
          if (!sawDownload) setLoadDetail(null)
          setLoadPhase('download')
          setStage('transcribing')
          setTranscribeMerging(false)
          setTranscribePhase('transcribing')
          setProgress(0)
        },
        onTranscribeProgress: ({ progress: pct, status }) => {
          if (status === 'merging' || status === 'finalizing') {
            setTranscribeMerging(true)
            setTranscribePhase(status)
            return
          }
          setTranscribeMerging(false)
          setTranscribePhase('transcribing')
          setProgress(pct)
        },
      })

      if (cancelledRef.current) return

      setTranscribeMerging(false)
      setTranscribePhase('transcribing')
      setStage('aligning')
      setProgress(0)
      await yieldToMainThread()
      const words: TranscriptWord[] = (transcriptResult.chunks ?? []).flatMap((c) => {
        const [start, end] = c.timestamp ?? []
        const word = c.text?.trim()
        if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
        return [{ word, startTime: start, endTime: end }]
      })
      const transcriptWords = sanitizeTranscript(words)

      // Weight against the sung (original) text — that's what the audio
      // transcript corresponds to, not the translation.
      const lineTexts = song.lyrics.lines.map((l) => l.original || l.translation)
      const { lines: aligned, mode, confidence, anchorSources } = alignLyrics(
        lineTexts, words, song.lyrics.lines, song.lyrics.sourceLanguage,
      )
      // Derive the canonical sung-phrase layer (Phase 1). Additive: the pasted
      // sheet (`lines`) is unchanged; the UI keeps rendering it by default (D1).
      const { phrases } = derivePhrases(aligned, transcriptWords, anchorSources)
      const updated: Song = {
        ...song,
        lyrics: {
          ...song.lyrics,
          lines: aligned,
          alignmentMode: 'auto',
          alignmentConfidence: confidence,
          transcriptWords,
          phrases,
        },
        syncState: computeSyncState({ ...song, lyrics: { ...song.lyrics, lines: aligned } }),
      }
      await db.songs.put(updated)

      setLowConfidence(mode === 'proportional')
      setStage('done')
      onComplete(updated)
    } catch (e: unknown) {
      if (cancelledRef.current) return
      setError(e instanceof Error ? e.message : 'Auto-align failed')
      setStage('error')
    }
  }

  useEffect(() => {
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
    aligning: 'Matching the transcript to your lyric lines',
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
            ? <p className="text-yellow-400 text-sm">Alignment is approximate — the audio didn't closely match these lyrics. Try tap-sync or double-check your lyrics.</p>
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
