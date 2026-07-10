import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { clearWhisperModelCache, purgeCorruptModelCaches } from '../core/storage/modelCache'
import { friendlyModelLoadError, withNetworkRetry } from './networkErrors'
import type { InferenceBackend } from './inferenceBackend'

function onnxWasmBaseUrl(): string {
  const origin = typeof self !== 'undefined' && 'location' in self ? self.location.origin : ''
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return new URL(`${base}onnx-wasm/`, origin || undefined).href
}

/**
 * ONNX Runtime's WASM backend can split inference across a thread pool, but
 * that requires `SharedArrayBuffer`, which only exists when the page is
 * cross-origin isolated (COOP/COEP headers set by the host). Gating on
 * `crossOriginIsolated` makes this a pure no-op (current single-threaded
 * behavior, same output) everywhere isolation isn't configured, and a ~2-4x
 * transcription speedup with identical model output everywhere it is.
 */
function preferredWasmThreadCount(): number {
  if (typeof self === 'undefined' || !self.crossOriginIsolated) return 1
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined
  if (!cores) return 1
  // Leave a core free for the worker's message loop/GC; diminishing returns
  // past a handful of threads for a model this size make a higher cap pointless.
  return Math.max(1, Math.min(cores - 1, 6))
}

export function configureWhisperEnv(): void {
  env.allowLocalModels = false
  env.useBrowserCache = true
  const wasm = env.backends?.onnx?.wasm
  if (wasm) {
    // Already inside a dedicated worker — avoid nested ORT proxy workers and
    // load wasm from our origin (vite serveOnnxWasm) instead of a CDN stream.
    wasm.proxy = false
    wasm.wasmPaths = onnxWasmBaseUrl()
    wasm.numThreads = preferredWasmThreadCount()
  }
}

type ProgressCallback = (progress: {
  status?: string
  progress?: number
  file?: string
  name?: string
}) => void

/**
 * Load Whisper ASR via transformers.js v3's `pipeline()`, which handles model
 * download/caching/construction internally (replacing the old v2 manual
 * tokenizer/processor/model + mirror-host prefetch machinery). Falls back from
 * WebGPU to WASM once if the WebGPU pipeline fails to construct (some drivers
 * fail at construction time rather than at inference time).
 */
export async function loadWhisperAsrPipeline(
  modelId: string,
  backend: InferenceBackend,
  progress_callback?: ProgressCallback,
): Promise<AutomaticSpeechRecognitionPipeline> {
  configureWhisperEnv()

  const build = (device: 'webgpu' | 'wasm', dtype: 'fp16' | 'q8') =>
    withNetworkRetry(
      () =>
        pipeline<'automatic-speech-recognition'>('automatic-speech-recognition', modelId, {
          device,
          dtype,
          progress_callback: (p: { status?: string; progress?: number; file?: string }) =>
            progress_callback?.({ ...p, name: modelId }),
        }),
      3,
      1500,
    )

  try {
    return await build(backend.device, backend.dtype)
  } catch (err) {
    // WebGPU can fail to construct on some drivers — fall back to WASM once.
    if (backend.device === 'webgpu') {
      try {
        return await build('wasm', 'q8')
      } catch (err2) {
        throw await purgeThenFriendly(err2, modelId)
      }
    }
    throw await purgeThenFriendly(err, modelId)
  }
}

/**
 * A load that fails after the in-function retries (and WebGPU→WASM fallback) are
 * exhausted is usually a truncated/corrupt Cache Storage entry — v3's cache layer
 * does a bare `cache.match()` with no size/integrity check, so a mid-write abort
 * (likely for the ~1.5GB medium model) becomes a permanent "cache hit" that loops
 * the same failure. Purge the model's cache here (only on exhaustion, never on a
 * transient blip, to avoid nuking a fine partial download) so the user's next
 * "Try again" re-downloads clean — which is what `friendlyModelLoadError` promises.
 */
async function purgeThenFriendly(err: unknown, modelId: string): Promise<Error> {
  try {
    await purgeCorruptModelCaches()
    await clearWhisperModelCache(modelId)
  } catch {
    // best effort — cache may be unavailable (private mode / iframe)
  }
  return friendlyModelLoadError(err)
}
