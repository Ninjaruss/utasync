import { getDeviceTier } from './capability'
import { embedCacheKey } from './embedTextUtils'
import { getEmbedModel } from './models'
import { runWhenIdle } from '../core/idle'

// Worker is intentionally long-lived while in use; released after idle timeout.
let worker: Worker | null = null
let loaded: Promise<void> | null = null
let nextRequestId = 0
let idleReleaseTimer: ReturnType<typeof setTimeout> | null = null
const pendingEmbedRejects = new Set<(err: Error) => void>()

/** Cap session cache — unbounded growth was pinning hundreds of MB on long sessions. */
export const MAX_EMBEDDING_CACHE_ENTRIES = 2048
const WORKER_IDLE_RELEASE_MS = 3 * 60 * 1000

/** Session-scoped embedding cache — LRU eviction when over MAX_EMBEDDING_CACHE_ENTRIES. */
const embeddingCache = new Map<string, number[]>()

export interface EmbedTextsOptions {
  /** Fired for chunked embed calls (done/total uncached texts within one request). */
  onProgress?: (done: number, total: number) => void
}

function getWorker(): Worker {
  cancelWorkerRelease()
  if (!worker) {
    worker = new Worker(new URL('./textEmbed.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

function cancelWorkerRelease(): void {
  if (idleReleaseTimer) {
    clearTimeout(idleReleaseTimer)
    idleReleaseTimer = null
  }
}

function scheduleWorkerRelease(): void {
  cancelWorkerRelease()
  idleReleaseTimer = setTimeout(() => {
    if (pendingEmbedRejects.size > 0) {
      const err = new Error('Embed worker released due to inactivity')
      for (const reject of pendingEmbedRejects) reject(err)
      pendingEmbedRejects.clear()
    }
    worker?.terminate()
    worker = null
    loaded = null
    idleReleaseTimer = null
  }, WORKER_IDLE_RELEASE_MS)
}

function cacheGet(key: string): number[] | undefined {
  const hit = embeddingCache.get(key)
  if (!hit) return undefined
  embeddingCache.delete(key)
  embeddingCache.set(key, hit)
  return hit
}

function cacheSet(key: string, vec: number[]): void {
  if (embeddingCache.has(key)) embeddingCache.delete(key)
  while (embeddingCache.size >= MAX_EMBEDDING_CACHE_ENTRIES) {
    const oldest = embeddingCache.keys().next().value
    if (oldest === undefined) break
    embeddingCache.delete(oldest)
  }
  embeddingCache.set(key, vec)
}

/** True if a worker response payload's requestId matches the id of the call awaiting it. */
export function isMatchingResponse(payload: { requestId?: number }, requestId: number): boolean {
  return payload?.requestId === requestId
}

function ensureLoaded(): Promise<void> {
  if (!loaded) {
    loaded = new Promise((resolve, reject) => {
      const w = getWorker()
      const onMessage = (e: MessageEvent) => {
        if (e.data.type === 'loaded') { w.removeEventListener('message', onMessage); resolve() }
        else if (e.data.type === 'error') { w.removeEventListener('message', onMessage); reject(new Error(e.data.payload)) }
      }
      w.addEventListener('message', onMessage)
      w.postMessage({ type: 'load', payload: { model: getEmbedModel(getDeviceTier()) } })
    })
    // A failed load must not wedge every future call behind the same
    // rejected promise — drop the broken worker so the next embedTexts()
    // call (e.g. opening another song) gets a fresh attempt.
    loaded.catch(() => {
      worker?.terminate()
      worker = null
      loaded = null
    })
  }
  return loaded
}

/** Low-priority warm-up — does not load the model during initial paint. */
export function preloadEmbedder(): void {
  if (getDeviceTier() === 'manual') return
  runWhenIdle(() => { void ensureLoaded() }, 10_000)
}

/** Clears the session embedding cache (for tests). */
export function clearEmbeddingCache(): void {
  embeddingCache.clear()
}

/** Number of texts currently cached (for tests/diagnostics). */
export function embeddingCacheSize(): number {
  return embeddingCache.size
}

function embedChunkSize(): number {
  return getDeviceTier() === 'lite' ? 16 : 24
}

function embedViaWorker(texts: string[], options?: EmbedTextsOptions): Promise<number[][]> {
  const requestId = nextRequestId++
  return new Promise((resolve, reject) => {
    pendingEmbedRejects.add(reject)
    const w = getWorker()
    const onMessage = (e: MessageEvent) => {
      if (!isMatchingResponse(e.data.payload, requestId)) return
      if (e.data.type === 'progress') {
        const { done, total } = e.data.payload as { done: number; total: number }
        if (typeof done === 'number' && typeof total === 'number') {
          options?.onProgress?.(done, total)
        }
      } else if (e.data.type === 'result') {
        w.removeEventListener('message', onMessage)
        pendingEmbedRejects.delete(reject)
        resolve(e.data.payload.vecs)
      } else if (e.data.type === 'error') {
        w.removeEventListener('message', onMessage)
        pendingEmbedRejects.delete(reject)
        reject(new Error(e.data.payload.message))
      }
    }
    w.addEventListener('message', onMessage)
    w.postMessage({
      type: 'embed',
      payload: { texts, requestId, chunkSize: embedChunkSize() },
    })
  })
}

/**
 * Embeds a batch of texts on-device via a worker-hosted multilingual model.
 * One vector per input text, in the same order. Session cache skips texts that
 * were embedded earlier in this app session (LRU-capped).
 */
export async function embedTexts(texts: string[], options?: EmbedTextsOptions): Promise<number[][]> {
  if (texts.length === 0) return []
  await ensureLoaded()

  const keys = texts.map(embedCacheKey)
  const result: (number[] | undefined)[] = keys.map((k) => cacheGet(k))
  const toEmbed: string[] = []
  const seenKeys = new Set<string>()

  for (let i = 0; i < texts.length; i++) {
    if (result[i]) continue
    const k = keys[i]
    if (seenKeys.has(k)) continue
    seenKeys.add(k)
    toEmbed.push(texts[i])
  }

  if (toEmbed.length === 0) {
    scheduleWorkerRelease()
    return keys.map((k, i) => result[i] ?? cacheGet(k)!) as number[][]
  }

  const newVecs = await embedViaWorker(toEmbed, options)
  for (let i = 0; i < toEmbed.length; i++) {
    cacheSet(embedCacheKey(toEmbed[i]), newVecs[i])
  }

  scheduleWorkerRelease()
  return keys.map((k, i) => {
    if (result[i]) return result[i]!
    const vec = cacheGet(k)
    if (vec) return vec
    return embeddingCache.get(k)!
  })
}
