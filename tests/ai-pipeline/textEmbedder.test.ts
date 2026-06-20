import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isMatchingResponse } from '../../src/ai-pipeline/textEmbedder'

describe('isMatchingResponse', () => {
  it('matches when payload requestId equals the awaited id', () => {
    expect(isMatchingResponse({ requestId: 1 }, 1)).toBe(true)
  })
  it('does not match when payload requestId differs', () => {
    expect(isMatchingResponse({ requestId: 2 }, 1)).toBe(false)
  })
  it('does not match when payload requestId is missing', () => {
    expect(isMatchingResponse({}, 1)).toBe(false)
  })
})

// Minimal fake Worker that lets the test script the order in which 'load'/'embed'
// responses are delivered to listeners, mimicking a real Worker's postMessage semantics:
// every registered 'message' listener receives every message.
class FakeWorker {
  listeners: Array<(e: MessageEvent) => void> = []
  posted: Array<{ type: string; payload?: unknown }> = []
  addEventListener(_type: string, cb: (e: MessageEvent) => void) {
    this.listeners.push(cb)
  }
  removeEventListener(_type: string, cb: (e: MessageEvent) => void) {
    this.listeners = this.listeners.filter((l) => l !== cb)
  }
  postMessage(msg: { type: string; payload?: unknown }) {
    this.posted.push(msg)
  }
  // Test helper: deliver a message to every currently-registered listener,
  // exactly like a real Worker would broadcast to all 'message' handlers.
  emit(data: unknown) {
    const event = { data } as MessageEvent
    for (const l of [...this.listeners]) l(event)
  }
  terminate() {}
}

describe('embedTexts concurrency (request id matching)', () => {
  let fakeWorker: FakeWorker

  beforeEach(async () => {
    vi.resetModules()
    fakeWorker = new FakeWorker()
    const worker = fakeWorker
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          return worker
        }
      }
    )
    const { clearEmbeddingCache } = await import('../../src/ai-pipeline/textEmbedder')
    clearEmbeddingCache()
  })

  it('resolves each concurrent call with its own result, ignoring the other call\'s message', async () => {
    const { embedTexts } = await import('../../src/ai-pipeline/textEmbedder')

    // Trigger model load first (embedTexts awaits ensureLoaded()).
    const callAPromise = embedTexts(['a'])
    // Let the 'load' message get posted, then resolve it so embed messages can be sent.
    await Promise.resolve()
    fakeWorker.emit({ type: 'loaded' })

    // Allow callA's embed postMessage to be sent (it awaits ensureLoaded() first).
    await Promise.resolve()
    await Promise.resolve()

    // Start call B concurrently, before A's response arrives -- both listeners are now
    // attached to the same shared fakeWorker, exactly like the production singleton.
    const callBPromise = embedTexts(['b'])
    await Promise.resolve()
    await Promise.resolve()

    const embedMessages = fakeWorker.posted.filter((m) => m.type === 'embed')
    expect(embedMessages).toHaveLength(2)
    const idA = (embedMessages[0].payload as { requestId: number }).requestId
    const idB = (embedMessages[1].payload as { requestId: number }).requestId
    expect(idA).not.toBe(idB)

    // Worker responds to B's request FIRST (out of order), then A's.
    fakeWorker.emit({ type: 'result', payload: { requestId: idB, vecs: [[9, 9]] } })
    fakeWorker.emit({ type: 'result', payload: { requestId: idA, vecs: [[1, 1]] } })

    const [resultA, resultB] = await Promise.all([callAPromise, callBPromise])

    // Each call must resolve with the payload matching its OWN request id,
    // not whichever message happened to be delivered/consumed first.
    expect(resultA).toEqual([[1, 1]])
    expect(resultB).toEqual([[9, 9]])
  })

  it('rejects only the call whose request id matches an error response', async () => {
    const { embedTexts } = await import('../../src/ai-pipeline/textEmbedder')

    const callAPromise = embedTexts(['a'])
    await Promise.resolve()
    fakeWorker.emit({ type: 'loaded' })
    await Promise.resolve()
    await Promise.resolve()

    const callBPromise = embedTexts(['b'])
    await Promise.resolve()
    await Promise.resolve()

    const embedMessages = fakeWorker.posted.filter((m) => m.type === 'embed')
    const idA = (embedMessages[0].payload as { requestId: number }).requestId
    const idB = (embedMessages[1].payload as { requestId: number }).requestId

    // Only B's request fails; A's succeeds afterward.
    fakeWorker.emit({ type: 'error', payload: { requestId: idB, message: 'boom' } })
    fakeWorker.emit({ type: 'result', payload: { requestId: idA, vecs: [[2, 2]] } })

    await expect(callBPromise).rejects.toThrow('boom')
    await expect(callAPromise).resolves.toEqual([[2, 2]])
  })

  it('forwards embed progress messages to onProgress', async () => {
    const { embedTexts } = await import('../../src/ai-pipeline/textEmbedder')

    const onProgress = vi.fn()
    const callPromise = embedTexts(['a', 'b', 'c'], { onProgress })
    await Promise.resolve()
    fakeWorker.emit({ type: 'loaded' })
    await Promise.resolve()
    await Promise.resolve()

    const embedMsg = fakeWorker.posted.find((m) => m.type === 'embed')
    const requestId = (embedMsg!.payload as { requestId: number }).requestId

    fakeWorker.emit({ type: 'progress', payload: { requestId, done: 2, total: 3 } })
    fakeWorker.emit({ type: 'result', payload: { requestId, vecs: [[1], [2], [3]] } })

    await expect(callPromise).resolves.toEqual([[1], [2], [3]])
    expect(onProgress).toHaveBeenCalledWith(2, 3)
  })
})

describe('embedTexts session cache', () => {
  let fakeWorker: FakeWorker

  beforeEach(async () => {
    vi.resetModules()
    fakeWorker = new FakeWorker()
    const worker = fakeWorker
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          return worker
        }
      }
    )
    const { clearEmbeddingCache } = await import('../../src/ai-pipeline/textEmbedder')
    clearEmbeddingCache()
  })

  async function loadModel() {
    await Promise.resolve()
    fakeWorker.emit({ type: 'loaded' })
    await Promise.resolve()
    await Promise.resolve()
  }

  it('skips worker embed for texts already cached in this session', async () => {
    const { embedTexts, embeddingCacheSize } = await import('../../src/ai-pipeline/textEmbedder')

    const callPromise = embedTexts(['hello', 'world'])
    await loadModel()
    const requestId = (fakeWorker.posted.find((m) => m.type === 'embed')!.payload as { requestId: number }).requestId
    fakeWorker.emit({ type: 'result', payload: { requestId, vecs: [[1], [2]] } })
    await callPromise
    expect(embeddingCacheSize()).toBe(2)

    const cached = await embedTexts(['hello', 'world', 'hello'])
    expect(fakeWorker.posted.filter((m) => m.type === 'embed')).toHaveLength(1)
    expect(cached).toEqual([[1], [2], [1]])
  })

  it('treats differently-cased English words as the same cache entry', async () => {
    const { embedTexts } = await import('../../src/ai-pipeline/textEmbedder')

    const callPromise = embedTexts(['You'])
    await loadModel()
    const requestId = (fakeWorker.posted.find((m) => m.type === 'embed')!.payload as { requestId: number }).requestId
    fakeWorker.emit({ type: 'result', payload: { requestId, vecs: [[5]] } })
    await callPromise

    const cached = await embedTexts(['you', 'YOU'])
    expect(cached).toEqual([[5], [5]])
    expect(fakeWorker.posted.filter((m) => m.type === 'embed')).toHaveLength(1)
  })

  it('evicts oldest cache entries when over the cap', async () => {
    const { embedTexts, embeddingCacheSize, MAX_EMBEDDING_CACHE_ENTRIES, clearEmbeddingCache } =
      await import('../../src/ai-pipeline/textEmbedder')
    clearEmbeddingCache()

    for (let i = 0; i < MAX_EMBEDDING_CACHE_ENTRIES + 5; i++) {
      const callPromise = embedTexts([`word-${i}`])
      await loadModel()
      const requestId = (fakeWorker.posted.at(-1)!.payload as { requestId: number }).requestId
      fakeWorker.emit({ type: 'result', payload: { requestId, vecs: [[i]] } })
      await callPromise
    }

    expect(embeddingCacheSize()).toBeLessThanOrEqual(MAX_EMBEDDING_CACHE_ENTRIES)
  })
})
