import { useEffect, useState } from 'react'
import { getDeviceTier } from './capability'
import { WHISPER_DOWNLOAD_HINT } from './models'
import { getAudioFile } from '../core/opfs/audio'
import type { Song } from '../core/types'
import { alignLyrics, type TranscriptWord } from './aligner'
import { db } from '../core/db/schema'
import { ProcessProgress } from '../core/ui/ProcessProgress'
import { alignSteps, alignStepIndex, type AlignStage } from './alignProgress'
import { transcribeAudio, type LoadProgress } from './whisperTranscriber'

interface Props {
  song: Song
  onComplete: (updated: Song) => void
  onClose: () => void
  /** When true, begin alignment as soon as the flow opens (e.g. fresh audio upload). */
  autoStart?: boolean
}

type Stage = 'idle' | AlignStage | 'done' | 'error'

function formatLoadStatus(p: LoadProgress): string | null {
  if (p.status === 'download' || p.status === 'progress') {
    const file = (p as { file?: string; name?: string }).file
      ?? (p as { file?: string; name?: string }).name
    if (file && typeof p.progress === 'number') {
      return `Downloading ${file} (${Math.round(p.progress)}%)`
    }
    if (typeof p.progress === 'number' && p.progress > 0) {
      return `Downloading speech model (${Math.round(p.progress)}%)`
    }
    return `First run — downloading speech model (${WHISPER_DOWNLOAD_HINT})`
  }
  if (p.status === 'initiate') return 'Checking for cached speech model…'
  return null
}

export function AutoAlignFlow({ song, onComplete, onClose, autoStart = false }: Props) {
  const tier = getDeviceTier()
  const [stage, setStage] = useState<Stage>(() =>
    autoStart && tier !== 'manual' ? 'preparing' : 'idle',
  )
  const [progress, setProgress] = useState(0)
  const [loadDetail, setLoadDetail] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [lowConfidence, setLowConfidence] = useState(false)

  const start = async () => {
    try {
      let audioData: Float32Array | null = null
      let sampleRate = 44100

      setStage('preparing')
      setProgress(0)
      setLoadDetail(null)

      if (song.audioStoredPath) {
        const file = await getAudioFile(song.id)
        const arrayBuffer = await file.arrayBuffer()
        const ctx = new AudioContext()
        const decoded = await ctx.decodeAudioData(arrayBuffer)
        audioData = decoded.getChannelData(0)
        sampleRate = decoded.sampleRate
        await ctx.close()
      }

      if (!audioData) { setError('No audio file found. Upload audio first.'); setStage('error'); return }

      if (tier === 'full') {
        setStage('separating')
        setProgress(0)
        const worker = new Worker(new URL('./demucs.worker.ts', import.meta.url), { type: 'module' })
        worker.postMessage({ type: 'load' })
        await new Promise<void>((res, rej) => {
          worker.onmessage = (e) => {
            if (e.data.type === 'loaded') {
              worker.postMessage({ type: 'separate', payload: { audioData } })
            } else if (e.data.type === 'result') {
              audioData = e.data.payload
              worker.terminate()
              res()
            } else if (e.data.type === 'error') { rej(e.data.payload) }
            else if (e.data.type === 'progress') setProgress(e.data.payload.progress ?? 0)
          }
        })
      }

      // First run downloads the Whisper model (~240MB, file by file); show that
      // as its own phase so the progress bar resetting per file isn't mistaken
      // for transcription stalling.
      setStage('loading')
      setProgress(0)
      setLoadDetail('Loading speech model from cache…')

      let sawDownload = false
      const transcriptResult = await transcribeAudio(audioData, sampleRate, {
        onLoadProgress: (p) => {
          const detail = formatLoadStatus(p)
          if (detail) {
            sawDownload = true
            setLoadDetail(detail)
          }
          if (typeof p.progress === 'number') setProgress(p.progress)
        },
        onModelLoaded: () => {
          if (!sawDownload) setLoadDetail(null)
          setStage('transcribing')
          setProgress(0)
        },
        onTranscribeProgress: (pct) => setProgress(pct),
      })

      setStage('aligning')
      const words: TranscriptWord[] = transcriptResult.chunks?.map((c) => ({
        word: c.text,
        startTime: c.timestamp[0],
        endTime: c.timestamp[1],
      })) ?? []

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
    activeStage === 'aligning' || activeStage === 'preparing' ? null : progress > 0 ? progress : null

  const stageDetail: Partial<Record<AlignStage, string>> = {
    preparing: 'Reading and decoding your audio file — longer songs take longer here',
    separating: 'Isolating vocals before transcription',
    loading: loadDetail ?? `Loading speech model from cache (first run downloads ${WHISPER_DOWNLOAD_HINT})`,
    transcribing: tier === 'lite'
      ? 'On-device speech recognition — can take a few minutes on phones'
      : 'Running on-device speech recognition',
    aligning: 'Matching the transcript to your lyric lines',
  }

  const taskStatus =
    activeStage && (taskProgress == null || activeStage === 'aligning' || activeStage === 'loading')
      ? stageDetail[activeStage] ?? null
      : null

  const stepsWithDetail = activeSteps.map((step, i) => {
    const keys: AlignStage[] = tier === 'full'
      ? ['preparing', 'separating', 'loading', 'transcribing', 'aligning']
      : ['preparing', 'loading', 'transcribing', 'aligning']
    const key = keys[i]
    const extra = key ? stageDetail[key] : undefined
    return extra ? { ...step, detail: extra } : step
  })

  const tierNote =
    tier === 'full' ? 'Vocal separation + transcription'
    : tier === 'lite' ? 'Transcription only (no vocal separation)'
    : 'Your device does not support on-device AI. Please use tap-sync instead.'

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end md:items-center justify-center z-50 p-4">
      <div className="bg-cinnabar-900 rounded-2xl p-6 max-w-sm w-full space-y-4 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
            showElapsed={taskProgress == null}
          />
        )}

        {stage === 'error' && <p className="text-red-400 text-sm">{error}</p>}
        {stage === 'done' && (
          lowConfidence
            ? <p className="text-yellow-400 text-sm">Alignment is approximate — the audio didn't closely match these lyrics. Try tap-sync or double-check your lyrics.</p>
            : <p className="text-green-400 text-sm">Lyrics aligned successfully.</p>
        )}

        <button onClick={onClose} className="text-white/40 text-sm w-full text-center">
          {stage === 'done' ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}

export default AutoAlignFlow
