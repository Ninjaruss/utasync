import { useEffect, useState } from 'react'
import { getDeviceTier } from './capability'
import { getWhisperModel, WHISPER_DOWNLOAD_HINT } from './models'
import { getAudioFile } from '../core/opfs/audio'
import type { Song } from '../core/types'
import { alignLyrics, type TranscriptWord } from './aligner'
import { db } from '../core/db/schema'

interface Props {
  song: Song
  onComplete: (updated: Song) => void
  onClose: () => void
  /** When true, begin alignment as soon as the flow opens (e.g. fresh audio upload). */
  autoStart?: boolean
}

type Stage = 'idle' | 'separating' | 'loading' | 'transcribing' | 'aligning' | 'done' | 'error'

// Shape of the Whisper worker's transcription result (word-level timestamps).
interface WhisperChunk { text: string; timestamp: [number, number] }
interface WhisperResult { text: string; chunks?: WhisperChunk[] }

export function AutoAlignFlow({ song, onComplete, onClose, autoStart = false }: Props) {
  const tier = getDeviceTier()
  const [stage, setStage] = useState<Stage>(() =>
    autoStart && tier !== 'manual' ? 'loading' : 'idle',
  )
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [lowConfidence, setLowConfidence] = useState(false)

  const start = async () => {
    try {
      let audioData: Float32Array | null = null
      let sampleRate = 44100

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
      const whisperWorker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
      whisperWorker.postMessage({ type: 'load', payload: { model: getWhisperModel(tier) } })

      const transcriptResult = await new Promise<WhisperResult>((res, rej) => {
        whisperWorker.onmessage = (e) => {
          if (e.data.type === 'loaded') {
            setStage('transcribing')
            setProgress(0)
            whisperWorker.postMessage({ type: 'transcribe', payload: { audioData, sampleRate } })
          } else if (e.data.type === 'result') { whisperWorker.terminate(); res(e.data.payload) }
          else if (e.data.type === 'error') rej(e.data.payload)
          else if (e.data.type === 'progress') setProgress(e.data.payload.progress ?? 0)
        }
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

  const stageLabel: Record<Stage, string> = {
    idle: '',
    separating: 'Separating vocals…',
    loading: 'Loading AI model…',
    transcribing: 'Transcribing audio…',
    aligning: 'Aligning to lyrics…',
    done: 'Done!',
    error: 'Error',
  }

  const stageDetail: Partial<Record<Stage, string>> = {
    separating: 'Isolating vocals before transcription',
    loading: tier === 'lite'
      ? `First run only — downloading speech model (${WHISPER_DOWNLOAD_HINT.lite})`
      : `First run only — downloading speech model (${WHISPER_DOWNLOAD_HINT.full})`,
    transcribing: tier === 'lite'
      ? 'On-device speech recognition — can take a few minutes on phones'
      : 'Running on-device speech recognition',
    aligning: 'Matching the transcript to your lyric lines',
  }

  const tierNote =
    tier === 'full' ? 'Vocal separation + transcription'
    : tier === 'lite' ? 'Transcription only (no vocal separation)'
    : 'Your device does not support on-device AI. Please use tap-sync instead.'

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end justify-center z-50 p-4">
      <div className="bg-cinnabar-900 rounded-2xl p-6 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-white font-semibold text-lg">Auto-Align Lyrics</h2>
        <p className="text-white/50 text-sm">{tierNote}</p>

        {stage === 'idle' && tier !== 'manual' && !autoStart && (
          <button onClick={start} className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium">
            Start Auto-Align
          </button>
        )}

        {(stage !== 'idle' || autoStart) && stage !== 'error' && stage !== 'done' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-cinnabar-accent border-t-transparent animate-spin shrink-0" />
              <div>
                <p className="text-white/80 text-sm font-medium">{stageLabel[stage]}</p>
                {stageDetail[stage] && <p className="text-white/35 text-xs">{stageDetail[stage]}</p>}
              </div>
            </div>
            <div className="h-2 bg-cinnabar-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-cinnabar-accent rounded-full transition-[width] duration-300 ease-out"
                style={{ width: progress > 0 ? `${progress}%` : '100%', opacity: progress > 0 ? 1 : 0.4, animation: progress === 0 ? 'pulse 1.5s ease-in-out infinite' : undefined }}
              />
            </div>
            {progress > 0 && (
              <p className="text-right text-[11px] text-white/30 tabular-nums">{Math.round(progress)}%</p>
            )}
          </div>
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
