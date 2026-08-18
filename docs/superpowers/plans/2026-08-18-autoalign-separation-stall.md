# Auto-align Separation Stall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make on-device vocal separation impossible to hang — bound it in time, report which execution provider it actually got, let Cancel land immediately, and ask the user before committing them to a run measured in tens of minutes.

**Architecture:** All timing policy lives in one pure module (`separationEta.ts`) so it is testable without a GPU. The demucs worker gains two pieces of telemetry (resolved provider, per-chunk elapsed time). The host (`demucsSeparator.ts`) gains an abort signal, a stall watchdog, a hard cap, and a callback for a long estimate. `AutoAlignFlow` wires those to real UI. Nothing changes about how separation *succeeds* — a slow or abandoned run throws, and the existing catch at `AutoAlignFlow.tsx:241` already falls back to transcribing the raw mix.

**Tech Stack:** TypeScript, React 19, Vite/Vitest, onnxruntime-web, Web Workers.

**Spec:** `docs/superpowers/specs/2026-08-18-autoalign-separation-stall-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/ai-pipeline/separationEta.ts` (create) | Pure timing policy: projection, thresholds, caps, human-readable ETA. No DOM, no worker. |
| `src/ai-pipeline/capability.ts` (modify) | Add `probeWebGPUAdapter()` — an *actual* `requestAdapter()` call, memoized. `getDeviceTier()` stays synchronous. |
| `src/ai-pipeline/demucs.worker.ts` (modify) | Choose an execution provider deliberately and report which one; emit per-chunk elapsed time. |
| `src/ai-pipeline/demucsSeparator.ts` (modify) | Abort signal, stall watchdog, hard cap, provider surfacing, long-estimate hook. |
| `src/ai-pipeline/AutoAlignFlow.tsx` (modify) | Abort on cancel, ETA confirmation dialog, remaining-time display, per-reason fallback notices. |
| `tests/ai-pipeline/separationEta.test.ts` (create) | Unit tests for the pure module. |
| `tests/ai-pipeline/demucsSeparator.timeout.test.ts` (create) | Fake-worker + fake-timer tests for watchdog, cap, abort, provider, estimate. |
| `tests/ai-pipeline/AutoAlignFlow.separation-stall.test.tsx` (create) | Integration: an abandoned separation still reaches the raw-mix path. |
| `tests/ai-pipeline/capability.test.ts` (modify) | Add `probeWebGPUAdapter` cases. |

**Note on `isCancelled`:** `separateVocals` keeps its existing `isCancelled` option so `gapRecovery.ts:192` needs no change. `signal` is the new, stronger path (it does not depend on the worker being responsive) and is what `AutoAlignFlow` uses. `gapRecovery` still gains the watchdog and cap for free, since those are unconditional.

---

## Task 1: Pure timing policy module

**Files:**
- Create: `src/ai-pipeline/separationEta.ts`
- Test: `tests/ai-pipeline/separationEta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ai-pipeline/separationEta.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  projectSeparationMs,
  separationCapMs,
  acceptedCapMs,
  formatEta,
  ETA_PROMPT_THRESHOLD_MS,
  STALL_TIMEOUT_MS,
} from '../../src/ai-pipeline/separationEta'

describe('projectSeparationMs', () => {
  it('extrapolates total runtime from the first chunk', () => {
    // 1 of 155 chunks took 20s → ~3100s total.
    expect(projectSeparationMs(1, 155, 20_000)).toBe(3_100_000)
  })

  it('refines as more chunks complete', () => {
    expect(projectSeparationMs(10, 100, 5_000)).toBe(50_000)
  })

  it('returns null before any chunk has completed', () => {
    expect(projectSeparationMs(0, 155, 0)).toBeNull()
  })

  it('returns null for nonsense inputs rather than a bogus estimate', () => {
    expect(projectSeparationMs(1, 0, 1_000)).toBeNull()
    expect(projectSeparationMs(Number.NaN, 155, 1_000)).toBeNull()
    expect(projectSeparationMs(1, 155, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('separationCapMs', () => {
  // The whole point of the cap: Whisper's 20s-per-audio-second budget would
  // allow ~77 minutes on a 3:50 song, i.e. the exact stall being fixed.
  it('caps a 3:50 song well under an hour', () => {
    const cap = separationCapMs(230)
    expect(cap).toBeLessThan(20 * 60_000)
    expect(cap).toBeGreaterThanOrEqual(10 * 60_000)
  })

  it('never drops below a 10 minute floor for short audio', () => {
    expect(separationCapMs(30)).toBe(10 * 60_000)
  })

  it('scales for long audio', () => {
    expect(separationCapMs(600)).toBe(40 * 60_000)
  })

  it('falls back to the floor when duration is unknown', () => {
    expect(separationCapMs(0)).toBe(10 * 60_000)
    expect(separationCapMs(Number.NaN)).toBe(10 * 60_000)
  })
})

describe('acceptedCapMs', () => {
  // Killing a user at the default cap after they explicitly accepted a longer
  // estimate would be a worse bug than the one being fixed.
  it('gives headroom beyond an accepted estimate', () => {
    expect(acceptedCapMs(40 * 60_000)).toBe(60 * 60_000)
  })
})

describe('formatEta', () => {
  it('does not pretend to sub-minute precision', () => {
    expect(formatEta(20_000)).toBe('less than a minute')
  })
  it('singularises one minute', () => {
    expect(formatEta(60_000)).toBe('about 1 minute')
  })
  it('rounds to whole minutes', () => {
    expect(formatEta(45 * 60_000)).toBe('about 45 minutes')
  })
  it('stops counting past an hour', () => {
    expect(formatEta(3 * 60 * 60_000)).toBe('over an hour')
  })
})

describe('thresholds', () => {
  it('prompts at 5 minutes and calls a run wedged after 90s of silence', () => {
    expect(ETA_PROMPT_THRESHOLD_MS).toBe(5 * 60_000)
    expect(STALL_TIMEOUT_MS).toBe(90_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/separationEta.test.ts`
Expected: FAIL — `Failed to resolve import ".../separationEta"`.

- [ ] **Step 3: Write the implementation**

Create `src/ai-pipeline/separationEta.ts`:

```ts
/**
 * Timing policy for on-device vocal separation.
 *
 * Deliberately pure — no DOM, no worker, no onnxruntime — so every threshold
 * here is unit-testable on CI, where no WebGPU device exists.
 */

/** Above this projection, stop and ask the user instead of silently grinding. */
export const ETA_PROMPT_THRESHOLD_MS = 5 * 60_000

/** No progress message for this long means the run is wedged (typically a lost
 * WebGPU device), not merely slow. Distinct from the cap: a wedge should be
 * caught in seconds, not waited out. */
export const STALL_TIMEOUT_MS = 90_000

/** Budget per second of audio for the un-negotiated hard cap. Whisper uses 20x
 * (whisperTranscriber.ts), which on a 3:50 song permits ~77 minutes — precisely
 * the stall this module exists to prevent. Separation gets 4x. */
const CAP_MULTIPLIER = 4_000

const CAP_FLOOR_MS = 10 * 60_000

/** Projected total runtime from chunks completed so far, or null when there is
 * not yet enough information to make an honest estimate. */
export function projectSeparationMs(
  chunksDone: number,
  nChunks: number,
  elapsedMs: number,
): number | null {
  if (!Number.isFinite(chunksDone) || !Number.isFinite(nChunks) || !Number.isFinite(elapsedMs)) {
    return null
  }
  if (chunksDone <= 0 || nChunks <= 0 || elapsedMs < 0) return null
  return Math.round((elapsedMs / chunksDone) * nChunks)
}

/** Hard cap for a run the user has not explicitly accepted. */
export function separationCapMs(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return CAP_FLOOR_MS
  return Math.max(CAP_FLOOR_MS, Math.round(durationSec * CAP_MULTIPLIER))
}

/** Cap for a run the user accepted after seeing an estimate. */
export function acceptedCapMs(projectedMs: number): number {
  if (!Number.isFinite(projectedMs) || projectedMs <= 0) return CAP_FLOOR_MS
  return Math.round(projectedMs * 1.5)
}

/** Human-readable ETA. Never claims precision the projection does not have. */
export function formatEta(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return 'less than a minute'
  const minutes = Math.round(ms / 60_000)
  if (minutes >= 60) return 'over an hour'
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/separationEta.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/separationEta.ts tests/ai-pipeline/separationEta.test.ts
git commit -m "feat(separation): pure timing policy for vocal separation ETA and caps"
```

---

## Task 2: Probe the WebGPU adapter for real

`getDeviceTier()` checks only that `navigator.gpu` *exists*. That is a known false positive — on Linux, on blocklisted GPUs, and in some worker contexts `requestAdapter()` resolves null and onnxruntime silently falls back to WASM.

`getDeviceTier()` stays synchronous: it is called from ~15 sites including React render paths (`PlayerView.tsx:194`, `SettingsView.tsx:107`, `wordAligner.ts:1203`). Making it async is a large, unrelated refactor.

**Files:**
- Modify: `src/ai-pipeline/capability.ts`
- Test: `tests/ai-pipeline/capability.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/ai-pipeline/capability.test.ts`:

```ts
import { probeWebGPUAdapter, resetWebGPUAdapterProbe } from '../../src/ai-pipeline/capability'

describe('probeWebGPUAdapter', () => {
  beforeEach(() => resetWebGPUAdapterProbe())

  it('is true when an adapter is actually granted', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } })
    expect(await probeWebGPUAdapter()).toBe(true)
  })

  // The false positive this function exists to catch: navigator.gpu is present,
  // but no adapter is available, so ORT silently drops to WASM.
  it('is false when navigator.gpu exists but grants no adapter', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } })
    expect(await probeWebGPUAdapter()).toBe(false)
  })

  it('is false when requestAdapter throws', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => { throw new Error('no gpu') } } })
    expect(await probeWebGPUAdapter()).toBe(false)
  })

  it('is false when there is no WebGPU at all', async () => {
    vi.stubGlobal('navigator', {})
    expect(await probeWebGPUAdapter()).toBe(false)
  })

  it('memoizes — the answer cannot change within a session', async () => {
    let calls = 0
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => { calls++; return {} } } })
    await probeWebGPUAdapter()
    await probeWebGPUAdapter()
    expect(calls).toBe(1)
  })
})
```

Ensure `beforeEach` is in the file's vitest import — change the top-level import to:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/capability.test.ts`
Expected: FAIL — `probeWebGPUAdapter is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/ai-pipeline/capability.ts`:

```ts
type GpuLike = { requestAdapter?: () => Promise<unknown> }

let adapterProbe: Promise<boolean> | null = null

/**
 * True when a WebGPU **adapter** can actually be acquired.
 *
 * `hasWebGPU()` only reports that `navigator.gpu` exists, which is not the same
 * question: on Linux, on blocklisted GPUs, and in some worker contexts
 * `requestAdapter()` resolves null, onnxruntime falls back to WASM, and a
 * separation run that should take two minutes takes an hour.
 *
 * Memoized — hardware cannot change mid-session, and the probe is not free.
 */
export function probeWebGPUAdapter(): Promise<boolean> {
  if (!adapterProbe) {
    adapterProbe = (async () => {
      const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu
      if (!gpu?.requestAdapter) return false
      try {
        return !!(await gpu.requestAdapter())
      } catch {
        return false
      }
    })()
  }
  return adapterProbe
}

/** Clears the memoized probe (tests). */
export function resetWebGPUAdapterProbe(): void {
  adapterProbe = null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/capability.test.ts`
Expected: PASS — existing `getDeviceTier` tests plus 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/capability.ts tests/ai-pipeline/capability.test.ts
git commit -m "feat(capability): probe requestAdapter instead of trusting navigator.gpu"
```

---

## Task 3: Worker reports its real provider and per-chunk timing

The worker currently asks for `executionProviders: ['webgpu', 'wasm']` and lets onnxruntime pick silently. ORT does not expose which provider a session resolved to, so instead the worker **tries WebGPU alone, and falls back to WASM alone** — after which it knows the answer for certain and can report it.

This file runs only inside a Worker and is not directly unit-testable (matching the existing pattern — `fft.test.ts` tests the pure DSP, not the worker). Its message contract is asserted from the host in Task 4.

**Files:**
- Modify: `src/ai-pipeline/demucs.worker.ts`

- [ ] **Step 1: Add deliberate provider selection**

In `src/ai-pipeline/demucs.worker.ts`, add this function just above `self.onmessage`:

```ts
/** Same union as `SeparationProvider` in demucsSeparator.ts. Declared locally
 * rather than imported: this file is a worker entry point and must not pull in
 * the host module. Keep the two in sync. */
type ProviderName = 'webgpu' | 'wasm'

/**
 * Creates the session and returns which provider actually backs it.
 *
 * Passing `['webgpu', 'wasm']` lets onnxruntime fall back silently, and ORT
 * exposes no way to ask which one it chose — so a WASM run (hours, not minutes)
 * was indistinguishable from a WebGPU one. Trying each provider alone makes the
 * answer knowable, which is the whole point.
 */
async function createSession(): Promise<{ session: ort.InferenceSession; provider: ProviderName }> {
  const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu
  if (gpu?.requestAdapter) {
    try {
      if (await gpu.requestAdapter()) {
        const session = await ort.InferenceSession.create(DEMUCS_MODEL_URL, {
          executionProviders: ['webgpu'],
        })
        return { session, provider: 'webgpu' }
      }
    } catch (err) {
      console.warn('[demucs.worker] WebGPU session failed, falling back to WASM:', err)
    }
  }
  const session = await ort.InferenceSession.create(DEMUCS_MODEL_URL, {
    executionProviders: ['wasm'],
  })
  return { session, provider: 'wasm' }
}
```

- [ ] **Step 2: Use it and report the provider**

Replace the body of the `if (type === 'load')` branch's `try` block. Change:

```ts
      ort.env.wasm.wasmPaths = demucsOrtWasmBaseUrl()
      ort.env.wasm.proxy = false
      session = await ort.InferenceSession.create(DEMUCS_MODEL_URL, {
        executionProviders: ['webgpu', 'wasm'],
      })
      self.postMessage({ type: 'loaded' })
```

to:

```ts
      ort.env.wasm.wasmPaths = demucsOrtWasmBaseUrl()
      ort.env.wasm.proxy = false
      const created = await createSession()
      session = created.session
      self.postMessage({ type: 'loaded', payload: { provider: created.provider } })
```

- [ ] **Step 3: Emit per-chunk elapsed time**

In the `separate` branch, immediately before the `for (let c = 0; c < nChunks; c++) {` loop, add:

```ts
      // Wall-clock since inference began, so the host can extrapolate a real ETA
      // from the first completed chunk rather than guessing from a percentage.
      const runStartMs = Date.now()
```

Then replace the in-loop progress post:

```ts
        self.postMessage({
          type: 'progress',
          payload: { status: 'separating', progress: 8 + Math.round((c / nChunks) * 82) },
        })
```

with:

```ts
        self.postMessage({
          type: 'progress',
          payload: {
            status: 'separating',
            progress: 8 + Math.round((c / nChunks) * 82),
            chunk: c + 1,
            nChunks,
            elapsedMs: Date.now() - runStartMs,
          },
        })
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/demucs.worker.ts
git commit -m "feat(demucs): report resolved execution provider and per-chunk timing"
```

---

## Task 4: Bound the host — watchdog, cap, abort, estimate

**Files:**
- Modify: `src/ai-pipeline/demucsSeparator.ts`
- Test: `tests/ai-pipeline/demucsSeparator.timeout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ai-pipeline/demucsSeparator.timeout.test.ts`:

```ts
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
    const promise = separateVocals(audio, { durationSec: 230 })
    await vi.advanceTimersByTimeAsync(0)
    load()

    // Worker wedges: no progress messages at all.
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 1_000)

    await expect(promise).rejects.toThrow(SeparationAbandonedError)
    await promise.catch((e: SeparationAbandonedError) => expect(e.reason).toBe('stalled'))
    expect(worker().terminated).toBe(true)
  })

  it('does not fire while chunks keep arriving', async () => {
    const promise = separateVocals(audio, { durationSec: 230 })
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
    const promise = separateVocals(audio, { durationSec: 230 })
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
    const promise = separateVocals(audio, { durationSec: 230, signal: controller.signal })
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
    const promise = separateVocals(audio, { durationSec: 230, onProvider })
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
    const promise = separateVocals(audio, { durationSec: 230, onLongEstimate })
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
    const promise = separateVocals(audio, { durationSec: 230, onLongEstimate })
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
    const promise = separateVocals(audio, { durationSec: 230, onLongEstimate })
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/demucsSeparator.timeout.test.ts`
Expected: FAIL — `SeparationAbandonedError` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/ai-pipeline/demucsSeparator.ts`, add to the imports at the top:

```ts
import {
  ETA_PROMPT_THRESHOLD_MS,
  STALL_TIMEOUT_MS,
  acceptedCapMs,
  projectSeparationMs,
  separationCapMs,
} from './separationEta'
```

Add these types above `SeparateVocalsOptions`:

```ts
export type SeparationProvider = 'webgpu' | 'wasm'

/** Why a separation run ended without producing a stem. Each maps to different
 * user-facing copy; all of them route into the same raw-mix fallback. */
export type AbandonReason = 'skipped' | 'timeout' | 'stalled'

/** Distinguishes "separation gave up" from "separation crashed" so the caller
 * can explain which one happened. Both fall back to the raw mix. */
export class SeparationAbandonedError extends Error {
  constructor(public readonly reason: AbandonReason, message: string) {
    super(message)
    this.name = 'SeparationAbandonedError'
  }
}
```

Replace `SeparateVocalsOptions` with:

```ts
export interface SeparateVocalsOptions {
  sampleRate?: number
  /** Audio length in seconds — sizes the hard cap. Omitting it uses the floor. */
  durationSec?: number
  onProgress?: (progress: number) => void
  /** Fires once, with the provider the worker's session actually resolved to. */
  onProvider?: (provider: SeparationProvider) => void
  /**
   * Fires at most once, after the first chunk, and only when the projected total
   * exceeds ETA_PROMPT_THRESHOLD_MS. Resolve 'skip' to abandon separation;
   * 'continue' accepts the wait and raises the cap accordingly.
   */
  onLongEstimate?: (projectedMs: number) => Promise<'skip' | 'continue'>
  /**
   * Preferred cancellation path. Unlike `isCancelled`, aborting terminates the
   * worker immediately rather than waiting for it to send a progress message —
   * which a wedged session.run() never does.
   */
  signal?: AbortSignal
  /** Legacy polling cancellation, checked on each progress message. Retained for
   * gapRecovery; new callers should use `signal`. */
  isCancelled?: () => boolean
}
```

Replace the whole `separateVocals` function body with:

```ts
export async function separateVocals(
  audioData: Float32Array,
  options?: SeparateVocalsOptions,
): Promise<Float32Array> {
  if (!(await isDemucsModelAvailable())) {
    throw new Error(
      'Vocal separation model not found. Place demucs-v1.onnx at public/models/ — see docs/DEPLOYMENT.md.',
    )
  }

  if (options?.signal?.aborted) throw new Error('cancelled')

  const worker = new Worker(new URL('./demucs.worker.ts', import.meta.url), { type: 'module' })

  let settled = false
  let askedEstimate = false
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  let capTimer: ReturnType<typeof setTimeout> | undefined
  let capMs = separationCapMs(options?.durationSec ?? 0)

  try {
    return await new Promise<Float32Array>((resolve, reject) => {
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(stallTimer)
        clearTimeout(capTimer)
        fn()
      }
      const fail = (err: Error) => settle(() => {
        worker.terminate()
        reject(err)
      })

      /** Re-armed on every progress message: catches a wedge in 90s rather than
       * making the user wait out the whole cap. */
      const armStall = () => {
        clearTimeout(stallTimer)
        stallTimer = setTimeout(
          () => fail(new SeparationAbandonedError(
            'stalled',
            `Vocal separation produced no progress for ${Math.round(STALL_TIMEOUT_MS / 1000)}s`,
          )),
          STALL_TIMEOUT_MS,
        )
      }

      const armCap = (ms: number) => {
        capMs = ms
        clearTimeout(capTimer)
        capTimer = setTimeout(
          () => fail(new SeparationAbandonedError('timeout', 'Vocal separation exceeded its time budget')),
          ms,
        )
      }

      // Abort does not depend on the worker being responsive — that dependency
      // was the original bug.
      options?.signal?.addEventListener('abort', () => fail(new Error('cancelled')), { once: true })

      const maybeAskEstimate = (payload: { chunk?: number; nChunks?: number; elapsedMs?: number }) => {
        if (askedEstimate || !options?.onLongEstimate) return
        const projected = projectSeparationMs(
          payload?.chunk ?? 0,
          payload?.nChunks ?? 0,
          payload?.elapsedMs ?? 0,
        )
        if (projected === null || projected <= ETA_PROMPT_THRESHOLD_MS) return
        askedEstimate = true
        void options.onLongEstimate(projected).then((choice) => {
          if (settled) return
          if (choice === 'skip') {
            fail(new SeparationAbandonedError('skipped', 'Vocal separation skipped by the user'))
          } else {
            // The user accepted this wait; the default cap must not pre-empt it.
            armCap(Math.max(capMs, acceptedCapMs(projected)))
          }
        })
      }

      worker.onmessage = (e: MessageEvent) => {
        const { type, payload } = e.data
        if (type === 'loaded') {
          if (payload?.provider) options?.onProvider?.(payload.provider as SeparationProvider)
          armStall()
          armCap(capMs)
          // Clone before transfer — the worker takes ownership of the buffer and
          // cancel/retry must not neuter the caller's decoded audio.
          const pcm = new Float32Array(audioData)
          worker.postMessage(
            { type: 'separate', payload: { audioData: pcm, sampleRate: options?.sampleRate ?? 44100 } },
            [pcm.buffer],
          )
        } else if (type === 'result') {
          settle(() => resolve(payload as Float32Array))
        } else if (type === 'error') {
          fail(new Error(String(payload)))
        } else if (type === 'progress') {
          if (options?.isCancelled?.()) {
            fail(new Error('cancelled'))
            return
          }
          armStall()
          options?.onProgress?.(payload?.progress ?? 0)
          maybeAskEstimate(payload ?? {})
        }
      }
      worker.onerror = () => fail(new Error('Vocal separation worker failed'))
      worker.postMessage({ type: 'load' })
    })
  } finally {
    clearTimeout(stallTimer)
    clearTimeout(capTimer)
    worker.terminate()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/demucsSeparator.timeout.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify existing callers still pass**

Run: `npx vitest run tests/ai-pipeline/gapRecovery.isolation.test.ts tests/ai-pipeline/AutoAlignFlow.vocal-sep-rate.test.tsx`
Expected: PASS. `gapRecovery.ts:192` uses `isCancelled`, which is retained.

- [ ] **Step 6: Commit**

```bash
git add src/ai-pipeline/demucsSeparator.ts tests/ai-pipeline/demucsSeparator.timeout.test.ts
git commit -m "fix(separation): bound vocal separation with watchdog, cap, and abort signal

Cancel previously depended on the worker sending a progress message, so a
wedged session.run() made it inert. There was also no overall timeout."
```

---

## Task 5: Wire it into AutoAlignFlow

**Files:**
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx`
- Test: `tests/ai-pipeline/AutoAlignFlow.separation-stall.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/ai-pipeline/AutoAlignFlow.separation-stall.test.tsx`, modelled on the existing `AutoAlignFlow.vocal-sep-rate.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, waitFor } from '@testing-library/react'
import { AutoAlignFlow } from '../../src/ai-pipeline/AutoAlignFlow'
import type { Song } from '../../src/core/types'
import { db } from '../../src/core/db/schema'
import { separateVocals, SeparationAbandonedError } from '../../src/ai-pipeline/demucsSeparator'

/**
 * A user reported auto-align sitting on "Separating vocals" for 50+ minutes.
 * Separation is now bounded, and every way it can give up must still land the
 * user on timed lyrics via the raw mix — never on a dead dialog.
 */

vi.mock('../../src/ai-pipeline/capability', () => ({
  getDeviceTier: () => 'full',
  canUseVocalSeparation: () => true,
  hasWebGPU: () => true,
  probeWebGPUAdapter: async () => true,
  resetWebGPUAdapterProbe: () => {},
}))

vi.mock('../../src/payment/SettingsStore', () => ({
  useSettingsStore: (selector: (s: {
    vocalSeparationEnabled: boolean | null
    modelDownloadConsented: boolean
    setVocalSeparationEnabled: () => void
    setModelDownloadConsented: (v: boolean) => void
  }) => unknown) =>
    selector({
      vocalSeparationEnabled: true,
      modelDownloadConsented: true,
      setVocalSeparationEnabled: vi.fn(),
      setModelDownloadConsented: vi.fn(),
    }),
}))

vi.mock('../../src/core/opfs/audio', () => ({
  getAudioFile: vi.fn(async () => new Blob([new ArrayBuffer(8)], { type: 'audio/wav' })),
}))

const mixAudio = new Float32Array(48000)
vi.mock('../../src/core/audio/decodeToMono', () => ({
  decodeAudioFileToMono: vi.fn(async () => ({ data: mixAudio, sampleRate: 48000 })),
}))

vi.mock('../../src/ai-pipeline/demucsSeparator', async () => {
  const actual = await vi.importActual<typeof import('../../src/ai-pipeline/demucsSeparator')>(
    '../../src/ai-pipeline/demucsSeparator',
  )
  return {
    ...actual,
    isDemucsModelAvailable: vi.fn(async () => true),
    refreshDemucsModelAvailability: vi.fn(async () => true),
    separateVocals: vi.fn(async () => new Float32Array(44100)),
  }
})

const transcribeMock = vi.fn(async () => [{ word: 'テスト', startTime: 0, endTime: 1 }])
vi.mock('../../src/ai-pipeline/whisperTranscriber', () => ({
  transcribeAudio: (...args: unknown[]) => transcribeMock(...(args as [])),
  resetWhisperTranscriber: vi.fn(),
  preloadWhisper: vi.fn(),
}))

const song: Song = {
  id: 'stall-song',
  title: 'Test',
  artist: 'Test',
  audioStoredPath: 'stall-song',
  lyrics: { lines: [{ startTime: 0, endTime: 0, original: 'テスト', translation: '' }] },
} as unknown as Song

beforeEach(async () => {
  vi.clearAllMocks()
  await db.songs.clear()
  await db.songs.put(song)
})

describe('AutoAlignFlow — abandoned vocal separation', () => {
  // Every abandon reason routes into the same fallback the stem-quality guard
  // already uses, so alignment continues on the decoded mix.
  it.each([
    ['timeout' as const, /time/i],
    ['stalled' as const, /taking too long|stopped responding/i],
    ['skipped' as const, /skipped|original mix/i],
  ])('falls back to the raw mix when separation is %s', async (reason, copy) => {
    vi.mocked(separateVocals).mockRejectedValueOnce(
      new SeparationAbandonedError(reason, `separation ${reason}`),
    )

    const { findByText } = render(
      <AutoAlignFlow song={song} autoStart onClose={vi.fn()} onComplete={vi.fn()} />,
    )

    // Transcription must still run — on the 48kHz decoded mix, not a 44.1k stem.
    await waitFor(() => expect(transcribeMock).toHaveBeenCalled())
    const [audioArg, rateArg] = transcribeMock.mock.calls[0] as unknown as [Float32Array, number]
    expect(audioArg).toBe(mixAudio)
    expect(rateArg).toBe(48000)

    expect(await findByText(copy)).toBeTruthy()
  })
})
```

> If `transcribeAudio`'s real signature differs from `(audioData, sampleRate, ...)`, adjust the destructuring in the assertion to match — read `src/ai-pipeline/whisperTranscriber.ts:165` first and mirror it exactly. Do not change the assertion's intent: it must prove the *mix* buffer and *decode* rate were used.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai-pipeline/AutoAlignFlow.separation-stall.test.tsx`
Expected: FAIL — the notice text does not exist yet.

- [ ] **Step 3: Add abort plumbing**

In `src/ai-pipeline/AutoAlignFlow.tsx`, alongside `const cancelledRef = useRef(false)` (line 152) add:

```tsx
  const abortRef = useRef<AbortController | null>(null)
  // Long-run confirmation: holds the pending decision's resolver plus the
  // projected duration to show. Null when no question is outstanding.
  const [etaPrompt, setEtaPrompt] = useState<
    { projectedMs: number; decide: (choice: 'skip' | 'continue') => void } | null
  >(null)
  const [remainingLabel, setRemainingLabel] = useState<string | null>(null)

  /** Single place that stops a run: flips the polled flag AND aborts the signal,
   * so a wedged worker is terminated instead of being politely asked. */
  const cancelRun = useCallback(() => {
    cancelledRef.current = true
    abortRef.current?.abort()
  }, [])
```

Three import edits at the top of the file:

Line 1 — add `useCallback`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
```

Line 24 — add `SeparationAbandonedError` to the existing `./demucsSeparator` import:

```tsx
import { DEMUCS_OUTPUT_SAMPLE_RATE, SeparationAbandonedError, isDemucsModelAvailable, refreshDemucsModelAvailability, separateVocals } from './demucsSeparator'
```

And add a new import beneath it:

```tsx
import { formatEta } from './separationEta'
```

- [ ] **Step 4: Create the controller and use the new options**

In `start()`, replace `cancelledRef.current = false` (line 176) with:

```tsx
    cancelledRef.current = false
    abortRef.current = new AbortController()
    setEtaPrompt(null)
    setRemainingLabel(null)
```

Replace the `separateVocals` call (line 214) with:

```tsx
          const stem = await separateVocals(audioData, {
            sampleRate,
            durationSec: audioData.length / sampleRate,
            signal: abortRef.current.signal,
            onProgress: (pct) => setProgress(pct),
            onProvider: (provider) => {
              // No automated test can exercise a real WebGPU device, so this log
              // is how a "separation took an hour" report gets diagnosed.
              console.info(`[AutoAlignFlow] vocal separation running on ${provider}`)
            },
            onLongEstimate: (projectedMs) =>
              new Promise<'skip' | 'continue'>((decide) => {
                setEtaPrompt({ projectedMs, decide })
              }).then((choice) => {
                setEtaPrompt(null)
                if (choice === 'continue') setRemainingLabel(formatEta(projectedMs))
                return choice
              }),
          })
```

- [ ] **Step 5: Give each abandon reason its own honest message**

Replace the `catch (e)` block for separation (lines 241-251) with:

```tsx
        } catch (e) {
          if (cancelledRef.current) return
          // Isolation is default-on, so a Demucs failure must NEVER kill the align.
          // audioData is still the decoded mix here (it's only reassigned to the stem
          // on success), so just fall back to transcribing that — same as stored-song
          // gap recovery and the stem-quality guard. Isolation can only ever help or
          // no-op, never abort.
          setRemainingLabel(null)
          if (e instanceof SeparationAbandonedError) {
            console.warn(`[AutoAlignFlow] vocal isolation abandoned (${e.reason}) — aligning on the raw mix`)
            setRetryNotice(
              e.reason === 'skipped'
                ? 'Skipped vocal isolation — aligning on the original mix instead.'
                : e.reason === 'stalled'
                  ? 'Vocal isolation stopped responding — aligning on the original mix instead.'
                  : 'Vocal isolation was taking too long on this device — aligning on the original mix instead.',
            )
          } else {
            // The classified reason goes to the console for triage.
            console.warn('[AutoAlignFlow] vocal isolation failed — aligning on the raw mix:', classifyVocalSepError(e))
            setRetryNotice('Vocal isolation is unavailable here — aligning on the original mix instead.')
          }
        }
```

- [ ] **Step 6: Route the existing Cancel paths through `cancelRun`**

At line 581, change the unmount cleanup:

```tsx
    return () => { cancelledRef.current = true }
```

to:

```tsx
    return () => { cancelRun() }
```

At line 687, in the `ConfirmDialog` `onConfirm`, change:

```tsx
              cancelledRef.current = true
```

to:

```tsx
              cancelRun()
```

- [ ] **Step 6b: Ask upfront when there is no WebGPU adapter**

Discovered during Task 2's review: `probeWebGPUAdapter()` had no consumer anywhere in this plan — the worker does its own adapter check (correctly; main-thread and worker adapter availability can differ). A diagnostic that diagnoses nothing should not ship, so it gets wired here.

When the main-thread probe definitively reports no adapter, separation is *certain* to run on WASM. Asking then — before the ~50MB Demucs model is downloaded and before a single chunk runs — is strictly better than asking after chunk 1. It preserves the approved "user decides" semantics from spec §2 rather than refusing on the user's behalf; it just asks earlier and far more cheaply.

The copy must not fabricate a precise ETA, because no chunk has been measured yet. It states the mechanism, not a number.

In `start()`, immediately before the `if (willSeparate) {` block, add:

```tsx
      // A definitive "no adapter" means separation WILL run on WASM — minutes
      // become tens of minutes. Ask before paying for the model download, not
      // after. Uses the same prompt machinery as the post-chunk-1 estimate.
      let separationAccepted = true
      if (willSeparate && !(await probeWebGPUAdapter())) {
        separationAccepted = await new Promise<boolean>((resolve) => {
          setNoGpuPrompt({ decide: (keepGoing) => { setNoGpuPrompt(null); resolve(keepGoing) } })
        })
        if (cancelledRef.current) return
        if (!separationAccepted) {
          setRetryNotice('Skipped vocal isolation — aligning on the original mix instead.')
        }
      }
```

and change the separation guard from `if (willSeparate) {` to `if (willSeparate && separationAccepted) {`.

Add the accompanying state beside `etaPrompt`:

```tsx
  const [noGpuPrompt, setNoGpuPrompt] = useState<{ decide: (keepGoing: boolean) => void } | null>(null)
```

Add `probeWebGPUAdapter` to the existing `./capability` import.

Render it next to the ETA dialog:

```tsx
        {noGpuPrompt && (
          <ConfirmDialog
            title="No GPU acceleration here"
            message="This browser can't use your GPU for vocal isolation, so it would run on the CPU — usually far longer than the song itself. You can skip it and align on the original mix: slightly less accurate, but much faster."
            confirmLabel="Skip it"
            cancelLabel="Keep going"
            onConfirm={() => noGpuPrompt.decide(false)}
            onCancel={() => noGpuPrompt.decide(true)}
          />
        )}
```

Add a test to `AutoAlignFlow.separation-stall.test.tsx` asserting that when `probeWebGPUAdapter` resolves false, `separateVocals` is never called and transcription still runs on the decoded mix. Note the existing mock in that file resolves `probeWebGPUAdapter` to `true`, which keeps every other test in the file on the normal path.

- [ ] **Step 7: Render the ETA question and the remaining-time label**

Immediately after the `{confirmCancel && (...)}` block (which ends at line 694), add:

```tsx
        {etaPrompt && (
          <ConfirmDialog
            title="This will take a while"
            message={`Isolating vocals will take ${formatEta(etaPrompt.projectedMs)} on this device. You can skip it and align on the original mix — slightly less accurate, but much faster.`}
            confirmLabel="Skip it"
            cancelLabel="Keep going"
            onConfirm={() => etaPrompt.decide('skip')}
            onCancel={() => etaPrompt.decide('continue')}
          />
        )}
```

Then, so an accepted long run shows something better than a bare percentage, add a remaining-time line. The progress block is the `<ProcessProgress ... />` element at `AutoAlignFlow.tsx:771`, wrapped in a `{(stage !== 'idle' || autoStart) && ... && (` guard that closes with `)}` at line 779. Insert directly **after** that closing `)}`:

```tsx
        {stage === 'separating' && remainingLabel && (
          <p className="text-white/55 text-xs text-center">{remainingLabel} remaining</p>
        )}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/ai-pipeline/AutoAlignFlow.separation-stall.test.tsx`
Expected: PASS, 3 cases.

- [ ] **Step 9: Verify nothing else regressed**

Run: `npx tsc -b && npx eslint src/ai-pipeline && npx vitest run tests/ai-pipeline`
Expected: no type errors, no lint errors, all tests pass.

> This suite has known load-sensitive flaky tests. If something unrelated to separation fails, re-run that file alone before concluding it is a regression.

- [ ] **Step 10: Commit**

```bash
git add src/ai-pipeline/AutoAlignFlow.tsx tests/ai-pipeline/AutoAlignFlow.separation-stall.test.tsx
git commit -m "feat(auto-align): honest ETA, working cancel, and bounded vocal separation"
```

---

## Task 6: Manual verification

Automated tests cannot exercise a real WebGPU device, so the diagnosis has to be confirmed by hand.

**Files:** none — verification only.

- [ ] **Step 1: Start the dev server and open a song**

Use the `verify-live-before-done` skill. Start the dev server, load a song with audio, and run Auto-Align with "Isolate vocals first" on.

- [ ] **Step 2: Confirm the provider is reported**

Open the browser console. Expected: exactly one line of the form
`[AutoAlignFlow] vocal separation running on webgpu` (or `wasm`).

**This line is the answer to the original bug report.** If it says `wasm` on a machine with a GPU, the tier gate is a false positive and thread B should investigate why `requestAdapter()` fails there.

- [ ] **Step 3: Confirm Cancel lands immediately**

Start a run, wait until "Separating vocals" appears, press Cancel, confirm "Stop".
Expected: the dialog closes within about a second, not after a multi-second delay.

- [ ] **Step 4: Record the result**

Note in the PR description which provider was reported and roughly how long separation took, so thread B has a real data point rather than an inference.

---

## Out of Scope

Carried from the spec — do not do these here:

- Changing tier gates for whisper-medium or word timestamps (`canUseHighAccuracy`, word-mode gates keep current behavior).
- Any Settings UI for a persisted vocal-separation preference.
- Broader cross-browser compatibility work (thread B).
- Replacing tap-through or fine-tune line timing (thread C).
