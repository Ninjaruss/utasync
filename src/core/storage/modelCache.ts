/** Cache buckets used for on-device AI assets (Workbox + Transformers.js). */
export const TRANSFORMERS_CACHE_NAME = 'transformers-cache'
export const ONNX_RUNTIME_CACHE_NAME = 'onnx-runtime-v1'
export const AI_MODEL_CACHE_NAMES = ['ai-models-v1', TRANSFORMERS_CACHE_NAME, ONNX_RUNTIME_CACHE_NAME] as const

/** True when the stored body size matches Content-Length (if declared). */
export async function cacheResponseBodyValid(res: Response): Promise<boolean> {
  const cl = res.headers.get('Content-Length')
  if (!cl) return true
  const declared = parseInt(cl, 10)
  if (Number.isNaN(declared) || declared <= 0) return true
  const blob = await res.blob()
  return blob.size === declared
}

/** Removes cache entries whose body is shorter than their Content-Length header. */
export async function purgeCorruptCacheEntries(cacheName: string): Promise<number> {
  if (typeof caches === 'undefined') return 0
  let deleted = 0
  try {
    const cache = await caches.open(cacheName)
    const keys = await cache.keys()
    for (const req of keys) {
      const res = await cache.match(req)
      if (!res) continue
      const valid = await cacheResponseBodyValid(res.clone())
      if (!valid && (await cache.delete(req))) deleted++
    }
  } catch {
    // ignore — cache may be unavailable (iframe / private mode)
  }
  return deleted
}

/** Purge truncated entries from all on-device model/runtime caches. */
export async function purgeCorruptModelCaches(): Promise<number> {
  let deleted = 0
  for (const name of AI_MODEL_CACHE_NAMES) {
    deleted += await purgeCorruptCacheEntries(name)
  }
  return deleted
}

/** Sums byte size of all entries in one Cache API bucket. */
async function estimateCacheBucketBytes(cacheName: string): Promise<number> {
  if (typeof caches === 'undefined') return 0
  try {
    const cache = await caches.open(cacheName)
    const keys = await cache.keys()
    let total = 0
    for (const req of keys) {
      const res = await cache.match(req)
      if (!res) continue
      total += (await res.blob()).size
    }
    return total
  } catch {
    return 0
  }
}

/** Total bytes used by cached ONNX / Hugging Face model files. */
export async function estimateModelCacheBytes(): Promise<number> {
  const sizes = await Promise.all(AI_MODEL_CACHE_NAMES.map(estimateCacheBucketBytes))
  return sizes.reduce((sum, n) => sum + n, 0)
}

/** Deletes all cached ONNX / Hugging Face model files from the Cache API. */
export async function clearAiModelCache(): Promise<number> {
  if (typeof caches === 'undefined') return 0
  let deleted = 0
  for (const name of AI_MODEL_CACHE_NAMES) {
    const cache = await caches.open(name)
    const keys = await cache.keys()
    await Promise.all(keys.map((k) => cache.delete(k)))
    deleted += keys.length
  }
  return deleted
}

/** Drop partially downloaded Whisper assets so the next attempt re-fetches cleanly. */
export async function clearWhisperModelCache(modelId = 'whisper'): Promise<number> {
  if (typeof caches === 'undefined') return 0
  const needle = modelId.toLowerCase()
  let deleted = 0
  for (const name of AI_MODEL_CACHE_NAMES) {
    const cache = await caches.open(name)
    const keys = await cache.keys()
    await Promise.all(
      keys.map(async (req) => {
        if (!req.url.toLowerCase().includes(needle)) return
        if (await cache.delete(req)) deleted++
      }),
    )
  }
  return deleted
}
