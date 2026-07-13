import { getDeviceTier } from './capability'
import { whisperBackend } from './inferenceBackend'
import { getWhisperModel } from './models'
import { runWhenIdle } from '../core/idle'
import type { ModelLoadPhase } from './modelLoadProgress'
import type { AlignmentLanguage } from '../core/types'

export interface TranscriptChunk {
  text: string
  timestamp: [number, number]
}

export interface WhisperTranscript {
  text: string
  chunks?: TranscriptChunk[]
}

export type TranscribeProgressStatus = 'transcribing' | 'merging' | 'finalizing'

export interface TranscribeProgress {
  progress: number
  status: TranscribeProgressStatus
}

export interface LoadProgress {
  status?: string
  progress?: number
  aggregateProgress?: number
  file?: string
  phase?: ModelLoadPhase
  filesCompleted?: number
}

// Worker is intentionally long-lived while in use; released after idle timeout.
let worker: Worker | null = null
let loaded: Promise<void> | null = null
// Model id the current `loaded` promise loaded (or is loading). Lets ensureLoaded
// detect a highAccuracy request that needs a different model than the warm worker
// already has, so it can reset + reload instead of silently reusing the small model.
let loadedModel: string | null = null
let idleReleaseTimer: ReturnType<typeof setTimeout> | null = null
const loadProgressListeners = new Set<(p: LoadProgress) => void>()
// Tracks the reject callback of any in-flight transcribeAudio promise so that
// resetWhisperTranscriber() can surface a cancellation error instead of hanging.
let transcribeReject: ((e: Error) => void) | null = null

const WORKER_IDLE_RELEASE_MS = 3 * 60 * 1000

function getWorker(): Worker {
  cancelWorkerRelease()
  if (!worker) {
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

function cancelWorkerRelease(): void {
  if (idleReleaseTimer) {
    clearTimeout(idleReleaseTimer)
    idleReleaseTimer = null
  }
}

function scheduleWorkerRelease(): void {
  cancelWorkerRelease()
  idleReleaseTimer = setTimeout(() => {
    worker?.terminate()
    worker = null
    loaded = null
    loadedModel = null
    idleReleaseTimer = null
  }, WORKER_IDLE_RELEASE_MS)
}

/** Terminates the worker and rejects any in-flight transcription promise. */
export function resetWhisperTranscriber(): void {
  const r = transcribeReject
  transcribeReject = null
  r?.(new Error('Transcription cancelled'))
  cancelWorkerRelease()
  worker?.terminate()
  worker = null
  loaded = null
  loadedModel = null
  loadProgressListeners.clear()
}

function broadcastLoadProgress(p: LoadProgress): void {
  loadProgressListeners.forEach((fn) => fn(p))
}

function ensureLoaded(onProgress?: (p: LoadProgress) => void, highAccuracy = false): Promise<void> {
  if (onProgress) loadProgressListeners.add(onProgress)

  const tier = getDeviceTier()
  const model = getWhisperModel(tier, highAccuracy)

  // A warm worker may have loaded a different model (e.g. preloadWhisper() warmed
  // the small model, then a highAccuracy=true request comes in needing medium).
  // Reusing `loaded` here would silently keep transcribing on the wrong model, so
  // tear down and reload whenever the requested model doesn't match the loaded one.
  if (loaded && loadedModel !== model) {
    resetWhisperTranscriber()
  }

  if (!loaded) {
    loaded = new Promise((resolve, reject) => {
      const w = getWorker()
      const onMessage = (e: MessageEvent) => {
        if (e.data.type === 'load-progress') {
          broadcastLoadProgress(e.data.payload as LoadProgress)
        } else if (e.data.type === 'loaded') {
          w.removeEventListener('message', onMessage)
          loadProgressListeners.clear()
          loadedModel = model
          resolve()
        } else if (e.data.type === 'error') {
          w.removeEventListener('message', onMessage)
          w.terminate()
          worker = null
          loaded = null
          loadedModel = null
          loadProgressListeners.clear()
          reject(new Error(String(e.data.payload)))
        }
      }
      w.addEventListener('message', onMessage)
      // Whisper runs on WASM: WebGPU produces broken long-form timestamps (see
      // whisperBackend). The embedder still uses WebGPU via resolveInferenceBackend.
      const backend = whisperBackend()
      w.postMessage({
        type: 'load',
        payload: { model, device: backend.device, dtype: backend.dtype },
      })
    })
  }

  return loaded.finally(() => {
    if (onProgress) loadProgressListeners.delete(onProgress)
  })
}

/** Low-priority warm-up — does not load the model during initial paint. */
export function preloadWhisper(): void {
  if (getDeviceTier() === 'manual') return
  runWhenIdle(() => { void ensureLoaded() }, 10_000)
}

export async function transcribeAudio(
  audioData: Float32Array,
  sampleRate: number,
  options?: {
    language?: AlignmentLanguage
    onLoadProgress?: (p: LoadProgress) => void
    onModelLoaded?: () => void
    onTranscribeProgress?: (p: TranscribeProgress) => void
    /** Word timestamps are slow to merge on long tracks — default picks by tier/duration. */
    timestampMode?: 'word' | 'segment'
    /** Abort if transcription exceeds this many ms (default: max(5 min, 20× audio length)). */
    timeoutMs?: number
    /** Use the larger, more accurate model when the device tier supports it. */
    highAccuracy?: boolean
  },
): Promise<WhisperTranscript> {
  await ensureLoaded(options?.onLoadProgress, options?.highAccuracy ?? false)
  options?.onModelLoaded?.()

  const durationSec = audioData.length / sampleRate
  const timeoutMs = options?.timeoutMs ?? Math.max(300_000, durationSec * 20_000)

  const result = await new Promise<WhisperTranscript>((resolve, reject) => {
    transcribeReject = reject
    const w = getWorker()

    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      cleanup()
      reject(new Error(
        'Transcription timed out — try a shorter clip, disable vocal separation, or use tap-sync instead.',
      ))
    }, timeoutMs)

    const cleanup = () => {
      transcribeReject = null
      clearTimeout(timeoutId)
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
    }

    const onMessage = (e: MessageEvent) => {
      if (e.data.type === 'progress') {
        const payload = e.data.payload as { progress?: number; status?: TranscribeProgressStatus }
        if (typeof payload.progress === 'number') {
          options?.onTranscribeProgress?.({
            progress: payload.progress,
            status: payload.status ?? 'transcribing',
          })
        } else if (payload.status === 'merging' || payload.status === 'finalizing') {
          options?.onTranscribeProgress?.({ progress: 0, status: payload.status })
        }
      } else if (e.data.type === 'result') {
        if (timedOut) return
        cleanup()
        resolve(e.data.payload as WhisperTranscript)
      } else if (e.data.type === 'error') {
        cleanup()
        worker = null
        loaded = null
        loadedModel = null
        reject(new Error(String(e.data.payload)))
      }
    }

    // Catches uncaught worker exceptions (WASM traps, OOM) that the worker's
    // try/catch cannot intercept — without this the promise hangs forever.
    const onError = (e: ErrorEvent) => {
      cleanup()
      worker = null
      loaded = null
      loadedModel = null
      reject(new Error(e.message || 'Speech recognition failed unexpectedly. Please try again.'))
    }

    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    w.postMessage({
      type: 'transcribe',
      payload: {
        audioData,
        sampleRate,
        language: options?.language,
        timestampMode: options?.timestampMode ?? 'word',
      },
    })
  })

  scheduleWorkerRelease()
  return result
}
