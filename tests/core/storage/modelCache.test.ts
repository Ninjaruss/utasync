import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AI_MODEL_CACHE_NAMES,
  clearAiModelCache,
  estimateModelCacheBytes,
} from '../../../src/core/storage/modelCache'

function mockCache(entries: Record<string, number>) {
  const store = new Map<string, Response>()
  for (const [path, size] of Object.entries(entries)) {
    const url = `https://app.test${path}`
    store.set(url, new Response(new Uint8Array(size)))
  }
  return {
    keys: vi.fn().mockResolvedValue([...store.keys()].map((url) => new Request(url))),
    match: vi.fn(async (req: Request) => store.get(req.url) ?? undefined),
    delete: vi.fn(async (req: Request) => store.delete(req.url)),
  }
}

const cacheStores = new Map<string, ReturnType<typeof mockCache>>()

vi.stubGlobal('caches', {
  open: vi.fn(async (name: string) => {
    if (!cacheStores.has(name)) cacheStores.set(name, mockCache({}))
    return cacheStores.get(name)!
  }),
})

describe('estimateModelCacheBytes', () => {
  beforeEach(() => {
    cacheStores.clear()
    vi.mocked(caches.open).mockClear()
  })

  it('sums entry sizes across AI model cache buckets', async () => {
    cacheStores.set('ai-models-v1', mockCache({ '/models/a.onnx': 100, '/models/b.onnx': 50 }))
    cacheStores.set('transformers-cache', mockCache({ '/hf/model.bin': 200 }))

    expect(await estimateModelCacheBytes()).toBe(350)
  })

  it('returns 0 when cache buckets are empty', async () => {
    for (const name of AI_MODEL_CACHE_NAMES) cacheStores.set(name, mockCache({}))
    expect(await estimateModelCacheBytes()).toBe(0)
  })
})

describe('clearAiModelCache', () => {
  beforeEach(() => {
    cacheStores.clear()
  })

  it('clears both buckets and returns deleted entry count', async () => {
    cacheStores.set('ai-models-v1', mockCache({ '/models/a.onnx': 10 }))
    cacheStores.set('transformers-cache', mockCache({ '/hf/x': 20, '/hf/y': 30 }))

    expect(await clearAiModelCache()).toBe(3)
    expect(await estimateModelCacheBytes()).toBe(0)
  })
})
