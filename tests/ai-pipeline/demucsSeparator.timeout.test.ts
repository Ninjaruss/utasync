import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  separateVocals,
  resetDemucsModelCache,
  SeparationAbandonedError,
} from '../../src/ai-pipeline/demucsSeparator'
import { STALL_TIMEOUT_MS } from '../../src/ai-pipeline/separationEta'

/**
 * A user reported auto-align sitting on "Separating vocals" for 50+ minutes.
 * These specs pin the three ways that run must now end: a wedged worker, a
 * merely-glacial one, and a user who wants out.
 */

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  terminated = false
  posted: Array<{ type: string; payload?: unknown }> = []

  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage(msg: { type: string; payload?: unknown }) {
    this.posted.push(msg)
  }
  terminate() {
    this.terminated = true
  }
  /** Drive the host as if the worker had sent this message. */
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

const worker = () => FakeWorker.instances[0]

/**
 * Vitest flags a rejection that lands mid-`advanceTimersByTimeAsync` as
 * "unhandled" when nothing is attached yet — real callers await `separateVocals`
 * immediately, these specs hold it across simulated time. The no-op handler only
 * marks the rejection as observed; every assertion below still runs against the
 * original promise. Verified against a bare `new Promise` — not an artifact of
 * the implementation under test.
 */
function held<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {})
  return p
}

/** Emits 'loaded' so the host arms its timers and posts the separate request. */
function load(provider: 'webgpu' | 'wasm' = 'webgpu') {
  worker().emit({ type: 'loaded', payload: { provider } })
}

beforeEach(() => {
  FakeWorker.instances = []
  resetDemucsModelCache()
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response))
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const audio = new Float32Array(1024)

describe('separateVocals — stall watchdog', () => {
  it('abandons a worker that goes silent, rather than waiting out the full cap', async () => {
    const promise = held(separateVocals(audio, { durationSec: 230 }))
    await vi.advanceTimersByTimeAsync(0)
    load()

    // Worker wedges: no progress messages at all.
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 1_000)

    await expect(promise).rejects.toThrow(SeparationAbandonedError)
    await promise.catch((e: SeparationAbandonedError) => expect(e.reason).toBe('stalled'))
    expect(worker().terminated).toBe(true)
  })

  it('does not fire while chunks keep arriving', async () => {
    const promise = held(separateVocals(audio, { durationSec: 230 }))
    await vi.advanceTimersByTimeAsync(0)
    load()

    for (let i = 1; i <= 5; i++) {
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS - 10_000)
      worker().emit({
        type: 'progress',
        payload: { progress: i * 10, chunk: i, nChunks: 100, elapsedMs: i * 1_000 },
      })
    }

    const out = new Float32Array(2048)
    worker().emit({ type: 'result', payload: out })
    await expect(promise).resolves.toBe(out)
  })
})

describe('separateVocals — hard cap', () => {
  it('abandons a run that is merely glacial', async () => {
    const promise = held(separateVocals(audio, { durationSec: 230 }))
    await vi.advanceTimersByTimeAsync(0)
    load()

    // Progress keeps arriving (so the watchdog never fires) but far too slowly.
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(30_000)
      worker().emit({
        type: 'progress',
        payload: { progress: i, chunk: i + 1, nChunks: 100_000, elapsedMs: (i + 1) * 30_000 },
      })
    }

    await expect(promise).rejects.toThrow(SeparationAbandonedError)
    await promise.catch((e: SeparationAbandonedError) => expect(e.reason).toBe('timeout'))
  })
})

describe('separateVocals — abort', () => {
  // The original bug: isCancelled was polled only on progress messages, so a
  // wedged session.run() made the Cancel button inert exactly when needed.
  it('terminates immediately on abort, without waiting for a progress message', async () => {
    const controller = new AbortController()
    const promise = held(separateVocals(audio, { durationSec: 230, signal: controller.signal }))
    await vi.advanceTimersByTimeAsync(0)
    load()

    controller.abort()
    await vi.advanceTimersByTimeAsync(0)

    await expect(promise).rejects.toThrow('cancelled')
    expect(worker().terminated).toBe(true)
  })
})

describe('separateVocals — provider reporting', () => {
  it('surfaces the provider the worker actually resolved to', async () => {
    const onProvider = vi.fn()
    const promise = held(separateVocals(audio, { durationSec: 230, onProvider }))
    await vi.advanceTimersByTimeAsync(0)
    load('wasm')

    expect(onProvider).toHaveBeenCalledWith('wasm')

    const out = new Float32Array(2048)
    worker().emit({ type: 'result', payload: out })
    await promise
  })
})

describe('separateVocals — long estimate', () => {
  it('asks once when the projection is long, and abandons on skip', async () => {
    const onLongEstimate = vi.fn(async () => 'skip' as const)
    const promise = held(separateVocals(audio, { durationSec: 230, onLongEstimate }))
    await vi.advanceTimersByTimeAsync(0)
    load('wasm')

    // 1 of 155 chunks in 20s → ~52 minutes projected.
    worker().emit({
      type: 'progress',
      payload: { progress: 8, chunk: 1, nChunks: 155, elapsedMs: 20_000 },
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(onLongEstimate).toHaveBeenCalledTimes(1)
    expect(onLongEstimate.mock.calls[0][0]).toBeGreaterThan(30 * 60_000)

    await expect(promise).rejects.toThrow(SeparationAbandonedError)
    await promise.catch((e: SeparationAbandonedError) => expect(e.reason).toBe('skipped'))
  })

  it('stays quiet when the run will finish quickly', async () => {
    const onLongEstimate = vi.fn(async () => 'continue' as const)
    const promise = held(separateVocals(audio, { durationSec: 230, onLongEstimate }))
    await vi.advanceTimersByTimeAsync(0)
    load()

    // 1 of 20 chunks in 2s → ~40s projected. Well under the prompt threshold.
    worker().emit({
      type: 'progress',
      payload: { progress: 8, chunk: 1, nChunks: 20, elapsedMs: 2_000 },
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(onLongEstimate).not.toHaveBeenCalled()

    const out = new Float32Array(2048)
    worker().emit({ type: 'result', payload: out })
    await promise
  })

  it('raises the cap once the user accepts a long run', async () => {
    const onLongEstimate = vi.fn(async () => 'continue' as const)
    const promise = held(separateVocals(audio, { durationSec: 230, onLongEstimate }))
    await vi.advanceTimersByTimeAsync(0)
    load('wasm')

    worker().emit({
      type: 'progress',
      payload: { progress: 8, chunk: 1, nChunks: 155, elapsedMs: 20_000 },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(onLongEstimate).toHaveBeenCalledTimes(1)

    // Past the default 15-minute cap, but inside the accepted ~78-minute one.
    // Keep the watchdog fed so this tests the cap, not the stall path.
    for (let i = 2; i <= 30; i++) {
      await vi.advanceTimersByTimeAsync(60_000)
      worker().emit({
        type: 'progress',
        payload: { progress: 8 + i, chunk: i, nChunks: 155, elapsedMs: i * 20_000 },
      })
    }

    const out = new Float32Array(2048)
    worker().emit({ type: 'result', payload: out })
    await expect(promise).resolves.toBe(out)
  })
})
