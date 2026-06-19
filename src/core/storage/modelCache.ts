/** Cache buckets used for on-device AI assets (Workbox + Transformers.js). */
export const AI_MODEL_CACHE_NAMES = ['ai-models-v1', 'transformers-cache'] as const

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
