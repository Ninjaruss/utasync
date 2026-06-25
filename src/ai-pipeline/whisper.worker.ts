/// <reference lib="webworker" />
import { getWhisperModel } from './models'
import { MODEL_INIT_HINT, ModelLoadProgressTracker, type ModelLoadProgress } from './modelLoadProgress'
import { loadWhisperAsrPipeline } from './whisperPipeline'
import { whisperLanguageFor } from './whisperLanguage'
import { slimWhisperTranscript } from './whisperTranscript'
import type { Language } from '../core/types'

let asr: Awaited<ReturnType<typeof loadWhisperAsrPipeline>> | null = null

function postLoadProgress(payload: ModelLoadProgress | Record<string, unknown>) {
  self.postMessage({ type: 'load-progress', payload })
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  try {
    if (type === 'load') {
      const model = (payload as { model?: string } | undefined)?.model ?? getWhisperModel('lite')
      const tracker = new ModelLoadProgressTracker()
      let initHintTimer: ReturnType<typeof setTimeout> | null = null

      const scheduleInitHint = () => {
        if (initHintTimer) clearTimeout(initHintTimer)
        initHintTimer = setTimeout(() => {
          initHintTimer = null
          postLoadProgress(MODEL_INIT_HINT)
        }, 600)
      }

      const clearInitHint = () => {
        if (initHintTimer) {
          clearTimeout(initHintTimer)
          initHintTimer = null
        }
      }

      postLoadProgress({ status: 'initiate', phase: 'download' })

      asr = await loadWhisperAsrPipeline(model, (raw) => {
        if (raw.status === 'download' || raw.status === 'progress') clearInitHint()
        if (raw.status === 'initializing') clearInitHint()
        const update = tracker.ingest(raw)
        postLoadProgress(update)
        if (raw.status === 'done') scheduleInitHint()
      })

      clearInitHint()
      self.postMessage({ type: 'loaded' })
      return
    }

    if (type === 'transcribe') {
      if (!asr) { self.postMessage({ type: 'error', payload: 'Model not loaded' }); return }
      const { audioData, sampleRate, language, timestampMode } = payload as {
        audioData: Float32Array
        sampleRate: number
        language?: Language
        timestampMode?: 'word' | 'segment'
      }

      const resampled = sampleRate === 16000 ? audioData : resampleTo16k(audioData, sampleRate)

      const CHUNK_LENGTH_S = 30
      const STRIDE_LENGTH_S = 5

      const jumpSamples = (CHUNK_LENGTH_S - 2 * STRIDE_LENGTH_S) * 16000
      const totalChunks = Math.max(1, Math.ceil(resampled.length / jumpSamples))
      let doneChunks = 0
      let mergeNotified = false

      const notifyMerging = () => {
        if (mergeNotified) return
        mergeNotified = true
        self.postMessage({ type: 'progress', payload: { status: 'merging' } })
      }

      const useWordTimestamps = timestampMode !== 'segment'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (asr as any)(resampled, {
        return_timestamps: useWordTimestamps ? 'word' : true,
        language: whisperLanguageFor(language),
        task: 'transcribe',
        chunk_length_s: CHUNK_LENGTH_S,
        stride_length_s: STRIDE_LENGTH_S,
        chunk_callback: () => {
          doneChunks++
          const progress = Math.min(90, Math.round((doneChunks / totalChunks) * 90))
          self.postMessage({ type: 'progress', payload: { status: 'transcribing', progress } })
          if (doneChunks >= totalChunks) notifyMerging()
        },
      })

      // Packaging a large word-level transcript can take minutes on phones — never
      // report 100% until the slim payload is ready to send (100% implied done).
      self.postMessage({ type: 'progress', payload: { status: 'finalizing' } })
      const slim = slimWhisperTranscript(result)
      self.postMessage({ type: 'result', payload: slim })
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      payload: err instanceof Error ? err.message : String(err),
    })
  }
}

function resampleTo16k(data: Float32Array, fromRate: number): Float32Array {
  const ratio = fromRate / 16000
  const out = new Float32Array(Math.floor(data.length / ratio))
  for (let i = 0; i < out.length; i++) out[i] = data[Math.floor(i * ratio)]
  return out
}
