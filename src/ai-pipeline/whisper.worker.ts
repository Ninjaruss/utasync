/// <reference lib="webworker" />
import { getWhisperModel } from './models'
import { MODEL_INIT_HINT, ModelLoadProgressTracker, type ModelLoadProgress } from './modelLoadProgress'
import { loadWhisperAsrPipeline } from './whisperPipeline'
import { whisperLanguageFor } from './whisperLanguage'
import { describeWorkerError } from './workerError'
import { slimWhisperTranscript } from './whisperTranscript'
import { planWindows, stitchChunkedResults, type WindowResult } from './whisperChunked'
import { buildWhisperPrompt, type WhisperPromptPipeline } from './whisperPrompt'
import type { AlignmentLanguage } from '../core/types'

let asr: Awaited<ReturnType<typeof loadWhisperAsrPipeline>> | null = null
let requestedDevice: 'webgpu' | 'wasm' = 'wasm'

function postLoadProgress(payload: ModelLoadProgress | Record<string, unknown>) {
  self.postMessage({ type: 'load-progress', payload })
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  try {
    if (type === 'load') {
      const { model, device, dtype } = (payload as {
        model?: string
        device?: 'webgpu' | 'wasm'
        dtype?: 'fp16' | 'q8' | 'q4'
      } | undefined) ?? {}
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

      requestedDevice = device ?? 'wasm'

      postLoadProgress({ status: 'initiate', phase: 'download' })

      asr = await loadWhisperAsrPipeline(
        model ?? getWhisperModel('lite'),
        { device: device ?? 'wasm', dtype: dtype ?? 'q8' },
        (raw) => {
          if (raw.status === 'download' || raw.status === 'progress') clearInitHint()
          if (raw.status === 'initializing') clearInitHint()
          const update = tracker.ingest(raw)
          postLoadProgress(update)
          if (raw.status === 'done') scheduleInitHint()
        },
      )

      clearInitHint()
      self.postMessage({ type: 'loaded' })
      return
    }

    if (type === 'transcribe') {
      if (!asr) { self.postMessage({ type: 'error', payload: 'Model not loaded' }); return }
      const { audioData, sampleRate, language, timestampMode, promptText } = payload as {
        audioData: Float32Array
        sampleRate: number
        language?: AlignmentLanguage
        timestampMode?: 'word' | 'segment'
        promptText?: string
      }

      const resampled = sampleRate === 16000 ? audioData : resampleTo16k(audioData, sampleRate)

      const CHUNK_LENGTH_S = 30
      const STRIDE_LENGTH_S = 5

      const useWordTimestamps = timestampMode !== 'segment'

      // Lyric-prompt biasing (round 9, R9-3): when the caller supplies the KNOWN
      // sheet lyrics for this slice, bias the decoder toward them via
      // decoder_input_ids. buildWhisperPrompt is segment-mode-only and self-gates on
      // the (undocumented) pipeline internals it reads — a null result means
      // transcribe unprompted. Extra options are spread into each asr(...) call.
      const promptExtra =
        promptText && language
          ? (() => {
              const ids = buildWhisperPrompt(
                asr as unknown as WhisperPromptPipeline,
                promptText,
                language,
                'transcribe',
                timestampMode ?? 'word',
              )
              return ids ? { decoder_input_ids: ids } : {}
            })()
          : {}

      let result: { text: string; chunks: { text: string; timestamp: [number, number | null] }[] }

      if (requestedDevice === 'webgpu') {
        // Manual windowing: transformers.js's internal long-form merge is broken
        // on WebGPU (60s -> 1 garbage word); single-window (<=30s) calls are
        // correct. Each window is one single-chunk call; stitch with offsets.
        const windows = planWindows(resampled.length, 16000)
        const perWindow: WindowResult[] = []
        for (let wi = 0; wi < windows.length; wi++) {
          const { startS, endS } = windows[wi]
          const slice = resampled.subarray(Math.floor(startS * 16000), Math.floor(endS * 16000))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const out = await (asr as any)(slice, {
            return_timestamps: useWordTimestamps ? 'word' : true,
            language: whisperLanguageFor(language),
            task: 'transcribe',
            chunk_length_s: CHUNK_LENGTH_S,
            ...promptExtra,
          })
          perWindow.push({ offsetS: startS, windowEndS: endS, chunks: out.chunks ?? [] })
          const progress = Math.min(90, Math.round(((wi + 1) / windows.length) * 90))
          self.postMessage({ type: 'progress', payload: { status: 'transcribing', progress } })
        }
        self.postMessage({ type: 'progress', payload: { status: 'merging' } })
        result = stitchChunkedResults(perWindow)
      } else {
        // WASM: transformers.js's internal long-form algorithm works — unchanged path.
        const jumpSamples = (CHUNK_LENGTH_S - 2 * STRIDE_LENGTH_S) * 16000
        const totalChunks = Math.max(1, Math.ceil(resampled.length / jumpSamples))
        let doneChunks = 0
        let mergeNotified = false

        const notifyMerging = () => {
          if (mergeNotified) return
          mergeNotified = true
          self.postMessage({ type: 'progress', payload: { status: 'merging' } })
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await (asr as any)(resampled, {
          return_timestamps: useWordTimestamps ? 'word' : true,
          language: whisperLanguageFor(language),
          task: 'transcribe',
          chunk_length_s: CHUNK_LENGTH_S,
          stride_length_s: STRIDE_LENGTH_S,
          ...promptExtra,
          chunk_callback: () => {
            doneChunks++
            const progress = Math.min(90, Math.round((doneChunks / totalChunks) * 90))
            self.postMessage({ type: 'progress', payload: { status: 'transcribing', progress } })
            if (doneChunks >= totalChunks) notifyMerging()
          },
        })
      }

      // Packaging a large word-level transcript can take minutes on phones — never
      // report 100% until the slim payload is ready to send (100% implied done).
      self.postMessage({ type: 'progress', payload: { status: 'finalizing' } })
      const slim = slimWhisperTranscript(result)
      self.postMessage({ type: 'result', payload: slim })
    }
  } catch (err) {
    self.postMessage({ type: 'error', payload: describeWorkerError(err) })
  }
}

function resampleTo16k(data: Float32Array, fromRate: number): Float32Array {
  const ratio = fromRate / 16000
  const out = new Float32Array(Math.floor(data.length / ratio))
  for (let i = 0; i < out.length; i++) out[i] = data[Math.floor(i * ratio)]
  return out
}
