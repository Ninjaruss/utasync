import {
  env,
  AutomaticSpeechRecognitionPipeline,
  AutoProcessor,
  AutoTokenizer,
  WhisperForConditionalGeneration,
} from '@xenova/transformers'
import { clearWhisperModelCache, purgeCorruptModelCaches } from '../core/storage/modelCache'
import { friendlyModelLoadError, withNetworkRetry } from './networkErrors'
import { HF_HOSTS, prefetchWhisperModelFiles } from './modelPrefetch'

/** Keep whisper model classes in the worker bundle (avoids over-aggressive tree-shaking). */
const WHISPER_MODEL_CLASS = WhisperForConditionalGeneration
void WHISPER_MODEL_CLASS

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
  // Reset to the primary host each fresh load — prefetch may have pinned a
  // mirror host on a prior attempt (see below), which must not leak into an
  // unrelated load (e.g. a different model/tab) where the primary may work fine.
  env.remoteHost = HF_HOSTS[0]
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
 * Load Whisper ASR without the generic pipeline's CTC fallback (which surfaces a
 * misleading "Unsupported model type: whisper" when SpeechSeq2Seq fails).
 */
export async function loadWhisperAsrPipeline(
  modelId: string,
  progress_callback?: ProgressCallback,
): Promise<AutomaticSpeechRecognitionPipeline> {
  configureWhisperEnv()

  const postInit = (step: string) => {
    progress_callback?.({ status: 'initializing', file: step, name: modelId })
  }

  try {
    // `from_pretrained` below always reads from `env.remoteHost` — if the primary
    // host failed and prefetch fell back to a mirror, point the loader at the same
    // host so it hits the cache entries we just wrote instead of re-downloading
    // (and failing again) against the unreachable primary host.
    const { host } = await prefetchWhisperModelFiles(modelId, (p) => {
      progress_callback?.({
        status: 'progress',
        file: p.file,
        progress: 100,
        name: modelId,
      })
      progress_callback?.({
        status: 'download',
        file: p.file,
        progress: p.aggregateProgress,
        name: modelId,
      })
    })
    env.remoteHost = host
  } catch (err) {
    throw friendlyModelLoadError(err)
  }

  // Files are in transformers-cache — load without progress_callback so hub.js uses
  // response.arrayBuffer() on cache hits instead of the fragile streaming reader.
  const options = { quantized: true }

  const retryLoad = <T>(label: string, load: () => Promise<T>): Promise<T> =>
    withNetworkRetry(load, 3, 1500, async (attempt) => {
      if (attempt >= 2) {
        console.warn(`Retrying Whisper ${label} after load failure (attempt ${attempt})`)
        progress_callback?.({ status: 'retrying', file: label, name: modelId })
        await purgeCorruptModelCaches()
        await clearWhisperModelCache(modelId)
        const { host } = await prefetchWhisperModelFiles(modelId)
        env.remoteHost = host
      }
    })

  try {
    postInit('tokenizer')
    const tokenizer = await retryLoad('tokenizer', () => AutoTokenizer.from_pretrained(modelId, options))
    postInit('processor')
    const processor = await retryLoad('processor', () => AutoProcessor.from_pretrained(modelId, options))
    postInit('speech model')
    const model = await retryLoad('model', () => WhisperForConditionalGeneration.from_pretrained(modelId, options))

    return new AutomaticSpeechRecognitionPipeline({
      task: 'automatic-speech-recognition',
      tokenizer,
      processor,
      model,
    })
  } catch (err) {
    throw friendlyModelLoadError(err)
  }
}
