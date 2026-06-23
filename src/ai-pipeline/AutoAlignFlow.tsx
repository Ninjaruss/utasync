import { useEffect, useRef, useState } from 'react'
import { getDeviceTier } from './capability'
import { getWhisperDownloadHint } from './models'
import { decodeAudioFileToMono } from '../core/audio/decodeToMono'
import { getAudioFile } from '../core/opfs/audio'
import type { Song } from '../core/types'
import { alignLyrics, type TranscriptWord } from './aligner'
import { db } from '../core/db/schema'
import { ProcessProgress } from '../core/ui/ProcessProgress'
import { ConfirmDialog } from '../core/ui/ConfirmDialog'
import { alignSteps, alignStepIndex, type AlignStage } from './alignProgress'
import { resetWhisperTranscriber, transcribeAudio, type LoadProgress } from './whisperTranscriber'

interface Props {
  song: Song
  onComplete: (updated: Song) => void
  onClose: () => void
  /** When true, begin alignment as soon as the flow opens (e.g. fresh audio upload). */
  autoStart?: boolean
}

type Stage = 'idle' | AlignStage | 'done' | 'error'

function formatLoadStatus(p: LoadProgress, downloadHint: string): string | null {
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
  const [stage, setStage] = useState<Stage>(() =>
    autoStart && tier !== 'manual' ? 'preparing' : 'idle',
  )
  const [progress, setProgress] = useState(0)
  const [loadDetail, setLoadDetail] = useState<string | null>(null)
  const [loadPhase, setLoadPhase] = useState<'download' | 'init'>('download')
  const [lastLoadProgress, setLastLoadProgress] = useState<LoadProgress | null>(null)
  const [error, setError] = useState('')
  const [lowConfidence, setLowConfidence] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const cancelledRef = useRef(false)
  const demucsWorkerRef = useRef<Worker | null>(null)

  const start = async () => {
    setError('')
    try {
      let audioData: Float32Array | null = null
      let sampleRate = 44100

      setStage('preparing')
      setProgress(0)
      setLoadDetail(null)

      if (song.audioStoredPath) {
        const file = await getAudioFile(song.id)
        const decoded = await decodeAudioFileToMono(file)
        audioData = decoded.data
        sampleRate = decoded.sampleRate
      }

      if (!audioData) { setError('No audio file found. Upload audio first.'); setStage('error'); return }

      if (tier === 'full') {
        setStage('separating')
        setProgress(0)
        const worker = new Worker(new URL('./demucs.worker.ts', import.meta.url), { type: 'module' })
        demucsWorkerRef.current = worker
        worker.postMessage({ type: 'load' })
        await new Promise<void>((res, rej) => {
          worker.onmessage = (e) => {
            if (e.data.type === 'loaded') {
              worker.postMessage({ type: 'separate', payload: { audioData } })
            } else if (e.data.type === 'result') {
              audioData = e.data.payload
              worker.terminate()
              demucsWorkerRef.current = null
              res()
            } else if (e.data.type === 'error') { rej(e.data.payload) }
            else if (e.data.type === 'progress') setProgress(e.data.payload.progress ?? 0)
          }
        })
        if (cancelledRef.current) return
      }

      // First run downloads the Whisper model (~240MB, file by file); show that
      // as its own phase so the progress bar resetting per file isn't mistaken
      // for transcription stalling.
      setStage('loading')
      setProgress(0)
      setLoadPhase('download')
      setLastLoadProgress(null)
      setLoadDetail('Checking cached model files…')

      let sawDownload = false
      const transcriptResult = await transcribeAudio(audioData, sampleRate, {
        language: song.lyrics.sourceLanguage,
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
          setProgress(0)
        },
        onTranscribeProgress: (pct) => setProgress(pct),
      })

      if (cancelledRef.current) return

      setStage('aligning')
      const words: TranscriptWord[] = (transcriptResult.chunks ?? []).flatMap((c) => {
        const [start, end] = c.timestamp ?? []
        const word = c.text?.trim()
        if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
        return [{ word, startTime: start, endTime: end }]
      })

      // Weight against the sung (original) text — that's what the audio
      // transcript corresponds to, not the translation.
      const lineTexts = song.lyrics.lines.map((l) => l.original || l.translation)
      const { lines: aligned, mode, confidence } = alignLyrics(
        lineTexts, words, song.lyrics.lines, song.lyrics.sourceLanguage,
      )
      const updated: Song = {
        ...song,
        lyrics: { ...song.lyrics, lines: aligned, alignmentMode: 'auto', alignmentConfidence: confidence },
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeSteps = alignSteps(tier)
  const activeStage: AlignStage | null =
    stage === 'preparing' || stage === 'separating' || stage === 'loading' || stage === 'transcribing' || stage === 'aligning'
      ? stage
      : null
  const taskProgress =
    activeStage === 'aligning' || activeStage === 'preparing'
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
    transcribing: tier === 'lite'
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
    const keys: AlignStage[] = tier === 'full'
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
    tier === 'full' ? 'Vocal separation + transcription'
    : tier === 'lite' ? 'Transcription only (no vocal separation)'
    : 'Your device does not support on-device AI. Please use tap-sync instead.'

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
              demucsWorkerRef.current?.terminate()
              demucsWorkerRef.current = null
              setConfirmCancel(false)
              onClose()
            }}
            onCancel={() => setConfirmCancel(false)}
          />
        )}

        <h2 className="text-white font-semibold text-lg">Auto-Align Lyrics</h2>
        <p className="text-white/50 text-sm">{tierNote}</p>

        {stage === 'idle' && tier !== 'manual' && !autoStart && (
          <button onClick={start} className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium">
            Start Auto-Align
          </button>
        )}

        {(stage !== 'idle' || autoStart) && stage !== 'error' && stage !== 'done' && activeStage && (
          <ProcessProgress
            steps={stepsWithDetail}
            currentStepIndex={alignStepIndex(tier, activeStage)}
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
