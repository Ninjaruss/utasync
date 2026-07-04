/** On-device vocal separation via Demucs ONNX (full-tier, opt-in). */
import { DEMUCS_MODEL_URL } from './demucsModelUrl'

const NEGATIVE_CACHE_MS = 15_000

let modelAvailable: boolean | null = null
let lastCheckedMs = 0

/** HEAD-check whether the Demucs ONNX model is reachable (local file or the
 * configured remote host; the host must allow a CORS HEAD request). */
export async function isDemucsModelAvailable(force = false): Promise<boolean> {
  const now = Date.now()
  if (!force && modelAvailable === true) return true
  if (!force && modelAvailable === false && now - lastCheckedMs < NEGATIVE_CACHE_MS) {
    return false
  }

  try {
    const res = await fetch(DEMUCS_MODEL_URL, { method: 'HEAD' })
    modelAvailable = res.ok
  } catch {
    modelAvailable = false
  }
  lastCheckedMs = now
  return modelAvailable
}

/** Re-probes model availability (e.g. after placing the ONNX file). */
export async function refreshDemucsModelAvailability(): Promise<boolean> {
  return isDemucsModelAvailable(true)
}

/** Clears cached availability (tests). */
export function resetDemucsModelCache(): void {
  modelAvailable = null
  lastCheckedMs = 0
}

export interface SeparateVocalsOptions {
  onProgress?: (progress: number) => void
  isCancelled?: () => boolean
}

/**
 * Isolates vocals from mono PCM via the Demucs worker. Returns the original
 * buffer unchanged when separation fails or is cancelled mid-run.
 */
export async function separateVocals(
  audioData: Float32Array,
  options?: SeparateVocalsOptions,
): Promise<Float32Array> {
  if (!(await isDemucsModelAvailable())) {
    throw new Error(
      'Vocal separation model not found. Place demucs-v1.onnx at public/models/ — see docs/DEPLOYMENT.md.',
    )
  }

  const worker = new Worker(new URL('./demucs.worker.ts', import.meta.url), { type: 'module' })

  try {
    return await new Promise<Float32Array>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const { type, payload } = e.data
        if (type === 'loaded') {
          // Clone before transfer — the worker takes ownership of the buffer and
          // cancel/retry must not neuter the caller's decoded audio.
          const pcm = new Float32Array(audioData)
          worker.postMessage({ type: 'separate', payload: { audioData: pcm } }, [pcm.buffer])
        } else if (type === 'result') {
          resolve(payload as Float32Array)
        } else if (type === 'error') {
          reject(new Error(String(payload)))
        } else if (type === 'progress') {
          if (options?.isCancelled?.()) {
            worker.terminate()
            reject(new Error('cancelled'))
            return
          }
          options?.onProgress?.(payload?.progress ?? 0)
        }
      }
      worker.onerror = () => reject(new Error('Vocal separation worker failed'))
      worker.postMessage({ type: 'load' })
    })
  } catch (e) {
    if (options?.isCancelled?.()) throw e
    throw e
  } finally {
    worker.terminate()
  }
}
