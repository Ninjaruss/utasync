import { useState } from 'react'
import { getDeviceTier } from './capability'
import type { Song } from '../core/types'
import { alignTranscriptToLines, type TranscriptWord } from './aligner'
import { db } from '../core/db/schema'

interface Props {
  song: Song
  onComplete: (updated: Song) => void
  onClose: () => void
}

type Stage = 'idle' | 'separating' | 'transcribing' | 'aligning' | 'done' | 'error'

// Shape of the Whisper worker's transcription result (word-level timestamps).
interface WhisperChunk { text: string; timestamp: [number, number] }
interface WhisperResult { text: string; chunks?: WhisperChunk[] }

export function AutoAlignFlow({ song, onComplete, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const tier = getDeviceTier()

  const start = async () => {
    try {
      let audioData: Float32Array | null = null

      if (song.audioStoredPath) {
        const { getAudioFile } = await import('../core/opfs/audio')
        const file = await getAudioFile(song.id)
        const arrayBuffer = await file.arrayBuffer()
        const ctx = new AudioContext()
        const decoded = await ctx.decodeAudioData(arrayBuffer)
        audioData = decoded.getChannelData(0)
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

      setStage('transcribing')
      setProgress(0)
      const whisperWorker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
      whisperWorker.postMessage({ type: 'load' })

      const transcriptResult = await new Promise<WhisperResult>((res, rej) => {
        whisperWorker.onmessage = (e) => {
          if (e.data.type === 'loaded') {
            whisperWorker.postMessage({ type: 'transcribe', payload: { audioData, sampleRate: 44100 } })
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

      const lineTexts = song.lyrics.lines.map((l) => l.translation || l.original)
      const aligned = alignTranscriptToLines(lineTexts, words, song.lyrics.lines)
      const updated: Song = { ...song, lyrics: { ...song.lyrics, lines: aligned, alignmentMode: 'auto' } }
      await db.songs.put(updated)

      setStage('done')
      onComplete(updated)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Auto-align failed')
      setStage('error')
    }
  }

  const stageLabel: Record<Stage, string> = {
    idle: '',
    separating: 'Separating vocals…',
    transcribing: 'Transcribing audio…',
    aligning: 'Aligning to lyrics…',
    done: 'Done!',
    error: 'Error',
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

        {stage === 'idle' && tier !== 'manual' && (
          <button onClick={start} className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium">
            Start Auto-Align
          </button>
        )}

        {stage !== 'idle' && stage !== 'error' && stage !== 'done' && (
          <div className="space-y-2">
            <p className="text-white/70 text-sm">{stageLabel[stage]}</p>
            <div className="h-2 bg-cinnabar-800 rounded-full">
              <div className="h-full bg-cinnabar-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {stage === 'error' && <p className="text-red-400 text-sm">{error}</p>}
        {stage === 'done' && <p className="text-green-400 text-sm">Lyrics aligned successfully.</p>}

        <button onClick={onClose} className="text-white/40 text-sm w-full text-center">
          {stage === 'done' ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}

export default AutoAlignFlow
