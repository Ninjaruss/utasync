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
  await purgeCorruptModelCaches()

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
        await clearWhisperModelCache(modelId)
        const { host } = await prefetchWhisperModelFiles(modelId)
        env.remoteHost = host
      }
    })

  try {
    const tokenizer = await retryLoad('tokenizer', () => AutoTokenizer.from_pretrained(modelId, options))
    const processor = await retryLoad('processor', () => AutoProcessor.from_pretrained(modelId, options))
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
