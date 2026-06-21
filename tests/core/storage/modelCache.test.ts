import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AI_MODEL_CACHE_NAMES,
  cacheResponseBodyValid,
  clearAiModelCache,
  clearWhisperModelCache,
  estimateModelCacheBytes,
  purgeCorruptCacheEntries,
} from '../../../src/core/storage/modelCache'

function mockCache(entries: Record<string, number>, corrupt?: Record<string, number>) {
  const store = new Map<string, Response>()
  for (const [path, size] of Object.entries(entries)) {
    const url = `https://app.test${path}`
    store.set(url, new Response(new Uint8Array(size)))
  }
  for (const [path, declared] of Object.entries(corrupt ?? {})) {
    const url = `https://app.test${path}`
    const body = new Uint8Array(Math.max(1, declared - 10))
    store.set(
      url,
      new Response(body, { headers: { 'Content-Length': String(declared) } }),
    )
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

describe('purgeCorruptCacheEntries', () => {
  beforeEach(() => {
    cacheStores.clear()
  })

  it('deletes entries whose body is shorter than Content-Length', async () => {
    cacheStores.set(
      'transformers-cache',
      mockCache({ '/ok.json': 10 }, { '/bad.onnx': 1000 }),
    )
    expect(await purgeCorruptCacheEntries('transformers-cache')).toBe(1)
    expect(await estimateModelCacheBytes()).toBe(10)
  })
})

describe('cacheResponseBodyValid', () => {
  it('returns false when Content-Length exceeds body size', async () => {
    const res = new Response(new Uint8Array(5), {
      headers: { 'Content-Length': '100' },
    })
    expect(await cacheResponseBodyValid(res)).toBe(false)
  })
})

describe('clearWhisperModelCache', () => {
  beforeEach(() => {
    cacheStores.clear()
  })

  it('removes only whisper-related entries', async () => {
    cacheStores.set('transformers-cache', mockCache({
      '/hf/whisper-small/encoder.onnx': 10,
      '/hf/paraphrase-multilingual/encoder.onnx': 20,
    }))

    expect(await clearWhisperModelCache('whisper')).toBe(1)
    expect(await estimateModelCacheBytes()).toBe(20)
  })
})
