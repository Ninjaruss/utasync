import { getDeviceTier } from './capability'
import { whisperBackend } from './inferenceBackend'
import { getWhisperModel } from './models'
import { runWhenIdle } from '../core/idle'
import type { ModelLoadPhase } from './modelLoadProgress'
import type { AlignmentLanguage } from '../core/types'
import { transcriptionBudgetMs, TRANSCRIPT_FINALIZATION_TIMEOUT_MS, TranscriptionTimeoutError } from './transcriptionBudget'

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
// Same, for the in-flight model load. `loaded` is otherwise resolved/rejected only
// by worker messages, and resetWhisperTranscriber() terminates that worker — so
// without this, an `await ensureLoaded(...)` in flight at reset never settled at
// all: the abandoned align run hung forever instead of unwinding (Cancel during
// "Loading AI model").
let loadReject: ((e: Error) => void) | null = null
let activeRequest: object | null = null

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
function retireWhisperWorker(cancelRequest = true): void {
  const rejectTranscribe = transcribeReject
  transcribeReject = null
  const rejectLoad = loadReject
  loadReject = null
  if (cancelRequest) activeRequest = null
  cancelWorkerRelease()
  worker?.terminate()
  worker = null
  loaded = null
  loadedModel = null
  loadProgressListeners.clear()
  // After the teardown, so a listener that reacts to the rejection cannot touch
  // the worker we just killed.
  rejectLoad?.(new Error('Model load cancelled'))
  rejectTranscribe?.(new Error('Transcription cancelled'))
}

export function resetWhisperTranscriber(): void {
  retireWhisperWorker()
}

function broadcastLoadProgress(p: LoadProgress): void {
  loadProgressListeners.forEach((fn) => fn(p))
}

function ensureLoaded(onProgress?: (p: LoadProgress) => void, highAccuracy = false): Promise<void> {
  const tier = getDeviceTier()
  const model = getWhisperModel(tier, highAccuracy)

  // A warm worker may have loaded a different model (e.g. preloadWhisper() warmed
  // the small model, then a highAccuracy=true request comes in needing medium).
  // Reusing `loaded` here would silently keep transcribing on the wrong model, so
  // tear down and reload whenever the requested model doesn't match the loaded one.
  if (loaded && loadedModel !== model) {
    retireWhisperWorker(false)
  }
  if (onProgress) loadProgressListeners.add(onProgress)

  if (!loaded) {
    // Track the requested model while loading too: an idle prewarm and an align
    // request for the same model must share one load, not cancel each other.
    loadedModel = model
    loaded = new Promise((resolve, reject) => {
      const w = getWorker()
      let loadTimer: ReturnType<typeof setTimeout> | null = null
      const clearLoad = () => {
        if (loadTimer !== null) clearTimeout(loadTimer)
        loadTimer = null
        w.removeEventListener('message', onMessage)
        w.removeEventListener('error', onError)
        loadReject = null
      }
      const failLoad = (error: Error) => {
        clearLoad()
        retireWhisperWorker()
        reject(error)
      }
      const armLoadDeadline = () => {
        if (loadTimer !== null) clearTimeout(loadTimer)
        loadTimer = setTimeout(() => failLoad(new TranscriptionTimeoutError('load')), highAccuracy ? 300_000 : 120_000)
      }
      const onMessage = (e: MessageEvent) => {
        if (e.data.type === 'load-progress') {
          // Real downloads may take time; repeated initialization hints must not
          // keep a wedged runtime alive indefinitely.
          if (e.data.payload?.status !== 'initializing' && e.data.payload?.phase !== 'init') armLoadDeadline()
          broadcastLoadProgress(e.data.payload as LoadProgress)
        } else if (e.data.type === 'loaded') {
          clearLoad()
          loadProgressListeners.clear()
          loadedModel = model
          loadReject = null
          resolve()
        } else if (e.data.type === 'error') {
          failLoad(new Error(String(e.data.payload)))
        }
      }
      const onError = (e: ErrorEvent) => failLoad(new Error(e.message || 'Speech model runtime failed during setup.'))
      loadReject = (error) => { clearLoad(); reject(error) }
      w.addEventListener('message', onMessage)
      w.addEventListener('error', onError)
      armLoadDeadline()
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
  // Swallow the rejection: a reset (Cancel, or a model switch) between idle and
  // the load would otherwise be an unhandled rejection for a warm-up nobody awaits.
  runWhenIdle(() => { if (!activeRequest) void ensureLoaded().catch(() => {}) }, 10_000)
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
    /** Known sheet lyrics for this slice, biasing Whisper toward the expected words
     * via `decoder_input_ids` (round 9, R9-3). Only honored in segment mode; the
     * worker feature-gates it and falls back to unprompted if the pipeline internals
     * it needs are absent. */
    promptText?: string
    /** Override the bounded inference budget (model loading is excluded). */
    timeoutMs?: number
    /** Use the larger, more accurate model when the device tier supports it. */
    highAccuracy?: boolean
    /** Cancel loading/inference when the owning alignment is closed or superseded. */
    signal?: AbortSignal
  },
): Promise<WhisperTranscript> {
  if (options?.signal?.aborted) throw new Error('Transcription cancelled')
  if (activeRequest) {
    const error = new Error('Another transcription is already running.')
    error.name = 'TranscriptionBusyError'
    throw error
  }
  const request = {}
  activeRequest = request
  cancelWorkerRelease()
  const onAbort = () => {
    if (activeRequest === request) {
      console.info('[Whisper] cancelled by owner')
      resetWhisperTranscriber()
    }
  }
  options?.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await ensureLoaded(options?.onLoadProgress, options?.highAccuracy ?? false)
    if (activeRequest !== request || options?.signal?.aborted) throw new Error('Transcription cancelled')
    options?.onModelLoaded?.()

    if (activeRequest !== request || options?.signal?.aborted) throw new Error('Transcription cancelled')
    const durationSec = audioData.length / sampleRate
    const timeoutMs = options?.timeoutMs ?? transcriptionBudgetMs(
      durationSec, options?.timestampMode ?? 'word', options?.highAccuracy ?? false,
    )

    const result = await new Promise<WhisperTranscript>((resolve, reject) => {
      const w = getWorker()
      let finalizationTimer: ReturnType<typeof setTimeout> | null = null
      const startedAt = performance.now()
      const timeoutId = setTimeout(() => timeout('pass'), timeoutMs)

      const cleanup = () => {
        transcribeReject = null
        clearTimeout(timeoutId)
        if (finalizationTimer !== null) clearTimeout(finalizationTimer)
        finalizationTimer = null
        w.removeEventListener('message', onMessage)
        w.removeEventListener('error', onError)
      }

      // Cancellation must clear this call's timers too; otherwise an old timer can
      // terminate a worker that belongs to a later retry.
      transcribeReject = (error) => { cleanup(); reject(error) }

      const timeout = (phase: 'pass' | 'finalization') => {
        cleanup()
        // Terminate before rejecting: a late result must never satisfy the retry.
        resetWhisperTranscriber()
        console.warn(`[Whisper] timeout mode=${options?.timestampMode ?? 'word'} phase=${phase} elapsedMs=${Math.round(performance.now() - startedAt)}`)
        reject(new TranscriptionTimeoutError(phase))
      }

      const onMessage = (e: MessageEvent) => {
        if (e.data.type === 'progress') {
          const payload = e.data.payload as { progress?: number; status?: TranscribeProgressStatus }
          if (payload.status === 'merging' || payload.status === 'finalizing') {
            if (finalizationTimer === null) {
              finalizationTimer = setTimeout(() => timeout('finalization'), TRANSCRIPT_FINALIZATION_TIMEOUT_MS)
            }
          } else if (finalizationTimer !== null && payload.status === 'transcribing') {
            clearTimeout(finalizationTimer)
            finalizationTimer = null
          }
          if (typeof payload.progress === 'number') {
            options?.onTranscribeProgress?.({
              progress: payload.progress,
              status: payload.status ?? 'transcribing',
            })
          } else if (payload.status === 'merging' || payload.status === 'finalizing') {
            options?.onTranscribeProgress?.({ progress: 0, status: payload.status })
          }
        } else if (e.data.type === 'result') {
          cleanup()
          console.info(`[Whisper] completed mode=${options?.timestampMode ?? 'word'} elapsedMs=${Math.round(performance.now() - startedAt)}`)
          resolve(e.data.payload as WhisperTranscript)
        } else if (e.data.type === 'error') {
          cleanup()
          // A WASM crash (OOM abort) leaves the runtime unusable — terminate so a
          // retry spins up a fresh worker instead of reusing a corrupted heap.
          w.terminate()
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
        w.terminate()
        worker = null
        loaded = null
        loadedModel = null
        reject(new Error(e.message || 'Speech recognition failed unexpectedly. Please try again.'))
      }

      w.addEventListener('message', onMessage)
      w.addEventListener('error', onError)
      console.info(`[Whisper] started mode=${options?.timestampMode ?? 'word'} audioSec=${durationSec.toFixed(1)} budgetMs=${timeoutMs}`)
      w.postMessage({
        type: 'transcribe',
        payload: {
          audioData,
          sampleRate,
          language: options?.language,
          timestampMode: options?.timestampMode ?? 'word',
          promptText: options?.promptText,
        },
      })
    })

    if (activeRequest !== request || options?.signal?.aborted) throw new Error('Transcription cancelled')
    scheduleWorkerRelease()
    return result
  } finally {
    options?.signal?.removeEventListener('abort', onAbort)
    if (activeRequest === request) activeRequest = null
  }
}
