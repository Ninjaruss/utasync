import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  separateVocals,
  resetDemucsModelCache,
  SeparationAbandonedError,
} from '../../src/ai-pipeline/demucsSeparator'
import { STALL_TIMEOUT_MS, LOAD_STALL_TIMEOUT_MS, CANCEL_POLL_MS } from '../../src/ai-pipeline/separationEta'

/**
 * The model load is the one phase of a separation that reports NOTHING: onnxruntime
 * exposes no byte-level progress for `InferenceSession.create`, and the worker's
 * single `{status:'loading'}` message is posted before it starts. That message used
 * to arm the 90s INFERENCE watchdog, so a healthy-but-slow download of the 66.8 MB
 * model (anything under ~6 Mbps) was reported as "Vocal isolation stopped
 * responding" — and since failing terminates the worker, the half-downloaded model
 * was thrown away and the next attempt repeated the identical 90-second death.
 *
 * These specs pin the two-phase split: a slow load is waited out, a dead load is
 * still caught, and the inference watchdog keeps its original 90s budget.
 */

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage() {}
  terminate() {
    this.terminated = true
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

const worker = () => FakeWorker.instances[FakeWorker.instances.length - 1]

/** Marks a rejection as observed while the spec holds the promise across simulated
 * time (mirrors demucsSeparator.timeout.test.ts). */
function held<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {})
  return p
}

/** Resolves to a label once the run settles, so "still waiting" is assertable. */
function settledState<T>(p: Promise<T>): { state: () => string } {
  let state = 'pending'
  p.then(
    () => { state = 'resolved' },
    () => { state = 'rejected' },
  )
  return { state: () => state }
}

/** Emits the worker's pre-download message: the load has started, nothing more
 * will arrive until the model is up. */
function loadStarted() {
  worker().emit({ type: 'progress', payload: { status: 'loading', progress: 0 } })
}

const audio = new Float32Array(1024)

// A duration long enough that the run's hard cap cannot fire inside these specs —
// they are about the watchdogs, not the budget.
const LONG_SONG = { durationSec: 3600 }

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

describe('separateVocals — model load watchdog', () => {
  it('waits out a slow 66.8 MB download instead of calling it stalled', async () => {
    const promise = held(separateVocals(audio, LONG_SONG))
    await vi.advanceTimersByTimeAsync(0)
    loadStarted()

    // 6 minutes of silence from the worker. Well under the load budget, but far
    // past the 90s inference watchdog that used to cover this phase.
    await vi.advanceTimersByTimeAsync(6 * 60_000)
    const s = settledState(promise)
    await vi.advanceTimersByTimeAsync(0)
    expect(s.state()).toBe('pending')
    expect(worker().terminated).toBe(false)

    // The model comes up and the run finishes normally.
    worker().emit({ type: 'loaded', payload: { provider: 'wasm' } })
    const out = new Float32Array(2048)
    worker().emit({ type: 'result', payload: out })
    await expect(promise).resolves.toBe(out)
  })

  it('still abandons a load that never answers (the run cannot hang forever)', async () => {
    const promise = held(separateVocals(audio, LONG_SONG))
    await vi.advanceTimersByTimeAsync(0)
    // No message at all — not even the pre-download one. Neither timer used to be
    // armed in this state, so the promise simply never settled.
    await vi.advanceTimersByTimeAsync(LOAD_STALL_TIMEOUT_MS + 1_000)

    await expect(promise).rejects.toThrow(SeparationAbandonedError)
    await promise.catch((e: SeparationAbandonedError) => {
      expect(e.reason).toBe('stalled')
      expect(e.message).toMatch(/model load/i)
    })
    expect(worker().terminated).toBe(true)
  })

  it('keeps the 90s inference budget after a long load', async () => {
    const promise = held(separateVocals(audio, LONG_SONG))
    await vi.advanceTimersByTimeAsync(0)
    loadStarted()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    worker().emit({ type: 'loaded', payload: { provider: 'wasm' } })

    // Inference now gets its OWN budget: 80s of silence is tolerated...
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS - 10_000)
    const s = settledState(promise)
    await vi.advanceTimersByTimeAsync(0)
    expect(s.state()).toBe('pending')

    // ...and a wedge past it is still caught, rather than inheriting the load's
    // much larger allowance.
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(promise).rejects.toThrow(SeparationAbandonedError)
    await promise.catch((e: SeparationAbandonedError) => expect(e.reason).toBe('stalled'))
  })

  it('extends the load budget when the worker reports load progress', async () => {
    const promise = held(separateVocals(audio, LONG_SONG))
    await vi.advanceTimersByTimeAsync(0)
    loadStarted()

    // Two load budgets' worth of wall clock, kept alive by heartbeats: a worker
    // that IS reporting must not be killed for being slow.
    await vi.advanceTimersByTimeAsync(LOAD_STALL_TIMEOUT_MS - 60_000)
    loadStarted()
    await vi.advanceTimersByTimeAsync(LOAD_STALL_TIMEOUT_MS - 60_000)
    loadStarted()
    await vi.advanceTimersByTimeAsync(LOAD_STALL_TIMEOUT_MS - 60_000)

    const s = settledState(promise)
    await vi.advanceTimersByTimeAsync(0)
    expect(s.state()).toBe('pending')

    worker().emit({ type: 'loaded', payload: { provider: 'wasm' } })
    const out = new Float32Array(8)
    worker().emit({ type: 'result', payload: out })
    await expect(promise).resolves.toBe(out)
  })
})

describe('separateVocals — polling cancellation', () => {
  // gapRecovery's callers pass the legacy `isCancelled` callback rather than an
  // AbortSignal, and it was only consulted on progress messages — which a wedged
  // session.run() never sends, so Cancel left the worker burning CPU until the
  // stall timeout fired.
  it('stops a wedged run on the polling callback alone, with no worker message', async () => {
    let cancelled = false
    const promise = held(separateVocals(audio, { ...LONG_SONG, isCancelled: () => cancelled }))
    await vi.advanceTimersByTimeAsync(0)
    loadStarted()
    worker().emit({ type: 'loaded', payload: { provider: 'wasm' } })

    cancelled = true
    await vi.advanceTimersByTimeAsync(CANCEL_POLL_MS + 1)

    await expect(promise).rejects.toThrow('cancelled')
    expect(worker().terminated).toBe(true)
  })

  it('does not poll at all when no cancellation callback is supplied', async () => {
    const promise = held(separateVocals(audio, LONG_SONG))
    await vi.advanceTimersByTimeAsync(0)
    loadStarted()
    worker().emit({ type: 'loaded', payload: { provider: 'wasm' } })

    // Runs to completion untouched — a poll interval that was created
    // unconditionally would keep the timer queue (and the test) busy forever.
    const out = new Float32Array(4)
    worker().emit({ type: 'result', payload: out })
    await expect(promise).resolves.toBe(out)
    expect(vi.getTimerCount()).toBe(0)
  })
})
