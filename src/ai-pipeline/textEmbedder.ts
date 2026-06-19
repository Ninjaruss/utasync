import { getDeviceTier } from './capability'
import { embedCacheKey } from './embedTextUtils'
import { getEmbedModel } from './models'

// Worker is intentionally long-lived for the app's session (never terminate()d) so the
// model only loads once; concurrent embedTexts() calls share it and are disambiguated by requestId.
let worker: Worker | null = null
let loaded: Promise<void> | null = null
let nextRequestId = 0

/** Session-scoped embedding cache — avoids re-embedding repeated words across lines/songs. */
const embeddingCache = new Map<string, number[]>()

export interface EmbedTextsOptions {
  /** Fired for chunked embed calls (done/total uncached texts within one request). */
  onProgress?: (done: number, total: number) => void
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./textEmbed.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
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
  }
  return loaded
}

/** Starts loading the embed model during idle time so the first align batch is faster. */
export function preloadEmbedder(): void {
  if (getDeviceTier() === 'manual') return
  void ensureLoaded()
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
  return getDeviceTier() === 'lite' ? 32 : 64
}

function embedViaWorker(texts: string[], options?: EmbedTextsOptions): Promise<number[][]> {
  const requestId = nextRequestId++
  return new Promise((resolve, reject) => {
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
        resolve(e.data.payload.vecs)
      } else if (e.data.type === 'error') {
        w.removeEventListener('message', onMessage)
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
 * were embedded earlier in this app session.
 */
export async function embedTexts(texts: string[], options?: EmbedTextsOptions): Promise<number[][]> {
  if (texts.length === 0) return []
  await ensureLoaded()

  const keys = texts.map(embedCacheKey)
  const result: (number[] | undefined)[] = keys.map((k) => embeddingCache.get(k))
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
    return result as number[][]
  }

  const newVecs = await embedViaWorker(toEmbed, options)
  for (let i = 0; i < toEmbed.length; i++) {
    embeddingCache.set(embedCacheKey(toEmbed[i]), newVecs[i])
  }

  return keys.map((k) => embeddingCache.get(k)!) as number[][]
}
