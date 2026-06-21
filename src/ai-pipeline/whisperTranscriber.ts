import { getDeviceTier } from './capability'
import { getWhisperModel } from './models'
import { runWhenIdle } from '../core/idle'
import type { ModelLoadPhase } from './modelLoadProgress'
import type { Language } from '../core/types'

export interface TranscriptChunk {
  text: string
  timestamp: [number, number]
}

export interface WhisperTranscript {
  text: string
  chunks?: TranscriptChunk[]
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
let idleReleaseTimer: ReturnType<typeof setTimeout> | null = null
const loadProgressListeners = new Set<(p: LoadProgress) => void>()

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
    idleReleaseTimer = null
  }, WORKER_IDLE_RELEASE_MS)
}

/** Clears the singleton so the next call loads a fresh worker (for tests). */
export function resetWhisperTranscriber(): void {
  cancelWorkerRelease()
  worker?.terminate()
  worker = null
  loaded = null
  loadProgressListeners.clear()
}

function broadcastLoadProgress(p: LoadProgress): void {
  loadProgressListeners.forEach((fn) => fn(p))
}

function ensureLoaded(onProgress?: (p: LoadProgress) => void): Promise<void> {
  if (onProgress) loadProgressListeners.add(onProgress)

  if (!loaded) {
    loaded = new Promise((resolve, reject) => {
      const w = getWorker()
      const onMessage = (e: MessageEvent) => {
        if (e.data.type === 'load-progress') {
          broadcastLoadProgress(e.data.payload as LoadProgress)
        } else if (e.data.type === 'loaded') {
          w.removeEventListener('message', onMessage)
          loadProgressListeners.clear()
          resolve()
        } else if (e.data.type === 'error') {
          w.removeEventListener('message', onMessage)
          w.terminate()
          worker = null
          loaded = null
          loadProgressListeners.clear()
          reject(new Error(String(e.data.payload)))
        }
      }
      w.addEventListener('message', onMessage)
      w.postMessage({ type: 'load', payload: { model: getWhisperModel(getDeviceTier()) } })
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
    language?: Language
    onLoadProgress?: (p: LoadProgress) => void
    onModelLoaded?: () => void
    onTranscribeProgress?: (progress: number) => void
  },
): Promise<WhisperTranscript> {
  await ensureLoaded(options?.onLoadProgress)
  options?.onModelLoaded?.()

  const result = await new Promise<WhisperTranscript>((resolve, reject) => {
    const w = getWorker()
    const onMessage = (e: MessageEvent) => {
      if (e.data.type === 'progress') {
        const payload = e.data.payload as { progress?: number }
        if (typeof payload.progress === 'number') {
          options?.onTranscribeProgress?.(payload.progress)
        }
      } else if (e.data.type === 'result') {
        w.removeEventListener('message', onMessage)
        resolve(e.data.payload as WhisperTranscript)
      } else if (e.data.type === 'error') {
        w.removeEventListener('message', onMessage)
        reject(new Error(String(e.data.payload)))
      }
    }
    w.addEventListener('message', onMessage)
    w.postMessage({ type: 'transcribe', payload: { audioData, sampleRate, language: options?.language } })
  })

  scheduleWorkerRelease()
  return result
}
