/// <reference lib="webworker" />
import { pipeline, env } from '@xenova/transformers'

env.allowLocalModels = false
env.useBrowserCache = true

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  if (type === 'load') {
    self.postMessage({ type: 'progress', payload: { status: 'loading', progress: 0 } })
    extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
      progress_callback: (p: { status?: string; progress?: number }) =>
        self.postMessage({ type: 'progress', payload: p }),
    })
    self.postMessage({ type: 'loaded' })
    return
  }

  if (type === 'embed') {
    if (!extractor) { self.postMessage({ type: 'error', payload: 'Model not loaded' }); return }
    try {
      const { texts } = payload as { texts: string[] }
      const output = await extractor(texts, { pooling: 'mean', normalize: true })
      const dim = output.dims[1]
      const vecs: number[][] = []
      for (let i = 0; i < texts.length; i++) {
        vecs.push(Array.from(output.data.slice(i * dim, (i + 1) * dim)) as number[])
      }
      self.postMessage({ type: 'result', payload: vecs })
    } catch (err) {
      self.postMessage({ type: 'error', payload: err instanceof Error ? err.message : 'Embedding failed' })
    }
  }
}
