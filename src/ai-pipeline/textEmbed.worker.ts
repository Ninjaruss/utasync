/// <reference lib="webworker" />
import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false
env.useBrowserCache = true

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  if (type === 'load') {
    const { model = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', device = 'wasm' } =
      (payload as { model?: string; device?: 'webgpu' | 'wasm' } | undefined) ?? {}
    self.postMessage({ type: 'progress', payload: { status: 'loading', progress: 0 } })
    const progress_callback = (p: { status?: string; progress?: number }) =>
      self.postMessage({ type: 'progress', payload: p })
    try {
      try {
        extractor = await pipeline('feature-extraction', model, { device, progress_callback })
      } catch (err) {
        if (device === 'webgpu') {
          console.warn('[textEmbed.worker] WebGPU pipeline failed, retrying with wasm', err)
          extractor = await pipeline('feature-extraction', model, { device: 'wasm', progress_callback })
        } else {
          throw err
        }
      }
      self.postMessage({ type: 'loaded' })
    } catch (err) {
      self.postMessage({ type: 'error', payload: err instanceof Error ? err.message : 'Model load failed' })
    }
    return
  }

  if (type === 'embed') {
    const { texts, requestId, chunkSize } = payload as { texts: string[]; requestId: number; chunkSize?: number }
    if (!extractor) { self.postMessage({ type: 'error', payload: { requestId, message: 'Model not loaded' } }); return }
    try {
      const EMBED_CHUNK = chunkSize ?? 32
      const vecs: number[][] = []
      for (let start = 0; start < texts.length; start += EMBED_CHUNK) {
        const chunk = texts.slice(start, start + EMBED_CHUNK)
        const output = await extractor(chunk, { pooling: 'mean', normalize: true })
        const dim = output.dims[1]
        for (let i = 0; i < chunk.length; i++) {
          vecs.push(Array.from(output.data.slice(i * dim, (i + 1) * dim)) as number[])
        }
        const done = Math.min(start + chunk.length, texts.length)
        if (texts.length > EMBED_CHUNK) {
          self.postMessage({ type: 'progress', payload: { requestId, done, total: texts.length } })
        }
      }
      self.postMessage({ type: 'result', payload: { requestId, vecs } })
    } catch (err) {
      self.postMessage({ type: 'error', payload: { requestId, message: err instanceof Error ? err.message : 'Embedding failed' } })
    }
  }
}
