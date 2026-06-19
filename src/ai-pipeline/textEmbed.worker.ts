/// <reference lib="webworker" />
import { pipeline, env } from '@xenova/transformers'

env.allowLocalModels = false
env.useBrowserCache = true

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  if (type === 'load') {
    const model = (payload as { model?: string } | undefined)?.model ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
    self.postMessage({ type: 'progress', payload: { status: 'loading', progress: 0 } })
    extractor = await pipeline('feature-extraction', model, {
      progress_callback: (p: { status?: string; progress?: number }) =>
        self.postMessage({ type: 'progress', payload: p }),
    })
    self.postMessage({ type: 'loaded' })
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
