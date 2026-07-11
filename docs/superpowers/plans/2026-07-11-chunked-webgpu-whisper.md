# Chunked WebGPU Whisper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim WebGPU transcription speed by windowing audio into ≤30s pieces (where WebGPU word timestamps are correct), stitching results with offsets — gated behind an in-browser validation before the WASM default flips.

**Architecture:** A pure `whisperChunked.ts` module (`planWindows` + `stitchChunkedResults`, fully unit-testable) plus a windowing branch in `whisper.worker.ts` taken when the *requested* device is webgpu (windowing is also correct on wasm, so a silent loader fallback is harmless). `whisperBackend()` stays WASM until the controller-run in-browser gate passes; only then does Task 4 flip it (with q4 for medium on WebGPU).

**Tech Stack:** TypeScript, vitest, `@huggingface/transformers` v3, preview browser tools (gate).

**Spec:** docs/superpowers/specs/2026-07-11-chunked-webgpu-whisper-design.md

## Verified context
- Worker transcribe handler (`src/ai-pipeline/whisper.worker.ts:62-110`): resamples to 16k, computes progress from `CHUNK_LENGTH_S=30`/`STRIDE_LENGTH_S=5`, calls `asr(resampled, { return_timestamps, language: whisperLanguageFor(language), task:'transcribe', chunk_length_s, stride_length_s, chunk_callback })`, then `slimWhisperTranscript(result)` → posts `{type:'result'}`.
- Load handler destructures `{ model, device, dtype }` from the payload.
- `whisperBackend()` (`src/ai-pipeline/inferenceBackend.ts`) currently returns `{ device:'wasm', dtype:'q8' }` always (commit fdf276d) with a TODO pointing at this plan.
- The bug being avoided: transformers.js's INTERNAL long-form chunk merge is broken on WebGPU (60s → 1 garbage word). Single-window (≤30s) calls are correct on WebGPU (validated 22/22 words).
- Type-check with `npx tsc -b --noEmit` (plain `tsc --noEmit` checks nothing here).

---

### Task 1: Pure window/stitch module

**Files:**
- Create: `src/ai-pipeline/whisperChunked.ts`
- Test: `tests/ai-pipeline/whisperChunked.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ai-pipeline/whisperChunked.test.ts
import { describe, it, expect } from 'vitest'
import { planWindows, stitchChunkedResults, type StitchChunk } from '../../src/ai-pipeline/whisperChunked'

const SR = 16000

describe('planWindows', () => {
  it('single window for audio <= 30s', () => {
    expect(planWindows(20 * SR, SR)).toEqual([{ startS: 0, endS: 20 }])
    expect(planWindows(30 * SR, SR)).toEqual([{ startS: 0, endS: 30 }])
  })
  it('30s windows with 5s overlap (stride 25)', () => {
    // 80s → [0,30], [25,55], [50,80]
    expect(planWindows(80 * SR, SR)).toEqual([
      { startS: 0, endS: 30 },
      { startS: 25, endS: 55 },
      { startS: 50, endS: 80 },
    ])
  })
  it('short tail (<8s) shifts the last window back instead of creating a sliver', () => {
    // 58s: naive windows [0,30],[25,55],[50,58] — 8s tail is OK (boundary).
    expect(planWindows(58 * SR, SR)).toEqual([
      { startS: 0, endS: 30 },
      { startS: 25, endS: 55 },
      { startS: 50, endS: 58 },
    ])
    // 57s: tail [50,57] is 7s (<8) → last window shifts back to end at 57: [27,57]
    expect(planWindows(57 * SR, SR)).toEqual([
      { startS: 0, endS: 30 },
      { startS: 27, endS: 57 },
    ])
  })
  it('empty audio → no windows', () => {
    expect(planWindows(0, SR)).toEqual([])
  })
})

describe('stitchChunkedResults', () => {
  const c = (text: string, s: number, e: number | null): StitchChunk => ({ text, timestamp: [s, e] })

  it('applies window offsets and concatenates', () => {
    const out = stitchChunkedResults([
      { offsetS: 0, windowEndS: 30, chunks: [c('a', 0, 1), c('b', 1, 2)] },
      { offsetS: 25, windowEndS: 55, chunks: [c('x', 5, 6), c('y', 6, 7)] }, // → 30-31, 31-32
    ])
    expect(out.chunks.map((ch) => ch.timestamp)).toEqual([[0, 1], [1, 2], [30, 31], [31, 32]])
    expect(out.text).toBe('abxy')
  })

  it('dedups the overlap at the midpoint (cut = overlapStart + 2.5)', () => {
    // Windows [0,30] and [25,55]: overlap 25-30, cut at 27.5.
    const out = stitchChunkedResults([
      // window 1 words at 26 (midpoint 26.25 < 27.5 → keep) and 28 (28.25 > cut → drop)
      { offsetS: 0, windowEndS: 30, chunks: [c('keep1', 26, 26.5), c('drop1', 28, 28.5)] },
      // window 2 words at abs 26.2 (mid 26.45 < cut → drop) and abs 28 (mid 28.25 >= cut → keep)
      { offsetS: 25, windowEndS: 55, chunks: [c('drop2', 1.2, 1.7), c('keep2', 3, 3.5)] },
    ])
    expect(out.chunks.map((ch) => ch.text)).toEqual(['keep1', 'keep2'])
  })

  it('clamps a null end on a window final chunk to the window end and keeps monotonic order', () => {
    const out = stitchChunkedResults([
      { offsetS: 0, windowEndS: 30, chunks: [c('a', 1, 2), c('tail', 29, null)] },
    ])
    expect(out.chunks[1].timestamp).toEqual([29, 30])
    for (let i = 1; i < out.chunks.length; i++) {
      expect(out.chunks[i].timestamp[0]).toBeGreaterThanOrEqual(out.chunks[i - 1].timestamp[0])
    }
  })

  it('drops chunks with non-finite starts and returns empty for empty input', () => {
    expect(stitchChunkedResults([])).toEqual({ text: '', chunks: [] })
    const out = stitchChunkedResults([
      { offsetS: 0, windowEndS: 30, chunks: [{ text: 'bad', timestamp: [Number.NaN, 1] }, c('ok', 1, 2)] },
    ])
    expect(out.chunks.map((ch) => ch.text)).toEqual(['ok'])
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/ai-pipeline/whisperChunked.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/ai-pipeline/whisperChunked.ts
/** Manual audio windowing for WebGPU Whisper. transformers.js's internal
 * long-form (>30s) chunk merge is broken on the WebGPU backend (a 60s clip
 * collapses to one garbage word), but SINGLE-window (<=30s) calls produce
 * correct word timestamps. So we window the audio ourselves, transcribe each
 * window as a single-chunk call, and stitch with offsets + overlap dedup —
 * reimplementing the stride-merge in a pure, testable module. */

export const WINDOW_S = 30
export const OVERLAP_S = 5
/** A trailing window shorter than this merges into the previous one by
 * shifting the last window's start back so it ends at the audio end. */
const MIN_TAIL_S = 8

export interface AudioWindow {
  startS: number
  endS: number
}

export function planWindows(totalSamples: number, sampleRate: number): AudioWindow[] {
  const totalS = totalSamples / sampleRate
  if (totalS <= 0) return []
  if (totalS <= WINDOW_S) return [{ startS: 0, endS: totalS }]
  const stride = WINDOW_S - OVERLAP_S
  const windows: AudioWindow[] = []
  for (let start = 0; start < totalS - OVERLAP_S; start += stride) {
    windows.push({ startS: start, endS: Math.min(start + WINDOW_S, totalS) })
  }
  const last = windows[windows.length - 1]
  if (windows.length > 1 && last.endS - last.startS < MIN_TAIL_S) {
    // Shift the sliver back so it still ends at the audio end but has full context.
    windows.pop()
    const prev = windows[windows.length - 1]
    windows.push({ startS: Math.max(prev.startS + 1, totalS - WINDOW_S), endS: totalS })
  }
  return windows
}

export interface StitchChunk {
  text: string
  timestamp: [number, number | null]
}

export interface WindowResult {
  offsetS: number
  /** Absolute end time of this window (for null-end clamping + dedup cuts). */
  windowEndS: number
  chunks: StitchChunk[]
}

/** Merge per-window results into one transcript. Overlapping words are deduped
 * at the overlap midpoint: a chunk belongs to the earlier window if its
 * midpoint is before the cut, to the later window otherwise. */
export function stitchChunkedResults(windows: WindowResult[]): { text: string; chunks: StitchChunk[] } {
  const kept: StitchChunk[] = []
  for (let w = 0; w < windows.length; w++) {
    const { offsetS, windowEndS, chunks } = windows[w]
    // Cut points against the previous/next windows (absolute times).
    const prevEnd = w > 0 ? windows[w - 1].windowEndS : -Infinity
    const cutBefore = w > 0 ? (offsetS + prevEnd) / 2 : -Infinity
    const nextStart = w + 1 < windows.length ? windows[w + 1].offsetS : Infinity
    const cutAfter = w + 1 < windows.length ? (nextStart + windowEndS) / 2 : Infinity

    for (let i = 0; i < chunks.length; i++) {
      const raw = chunks[i]
      const start = raw.timestamp[0]
      if (!Number.isFinite(start)) continue
      const absStart = offsetS + start
      const rawEnd = raw.timestamp[1]
      // A null end on the window's final chunk clamps to the window end.
      const absEnd = Number.isFinite(rawEnd as number) ? offsetS + (rawEnd as number) : windowEndS
      const mid = (absStart + absEnd) / 2
      if (mid < cutBefore || mid >= cutAfter) continue
      kept.push({ text: raw.text, timestamp: [absStart, absEnd] })
    }
  }
  kept.sort((a, b) => a.timestamp[0] - b.timestamp[0])
  return { text: kept.map((k) => k.text).join(''), chunks: kept }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ai-pipeline/whisperChunked.test.ts` → PASS. Trace the dedup test by hand if it fails: windows `[0,30]`/`[25,55]` → `cutAfter` for w0 = (25+30)/2 = 27.5 = `cutBefore` for w1. `npx tsc -b --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/whisperChunked.ts tests/ai-pipeline/whisperChunked.test.ts
git commit --no-gpg-sign -m "feat(ai): pure window/stitch module for chunked WebGPU whisper"
```

---

### Task 2: Worker windowing branch (dormant until the gate flips the backend)

**Files:**
- Modify: `src/ai-pipeline/whisper.worker.ts`

- [ ] **Step 1: Track the requested device at module scope**

In the `load` handler (it already destructures `{ model, device, dtype }`), store it:
```ts
let requestedDevice: 'webgpu' | 'wasm' = 'wasm'   // module scope, next to `let asr`
// inside the load handler, after destructuring:
requestedDevice = device ?? 'wasm'
```
(Windowing on a silently-fallen-back WASM pipeline is still CORRECT — single-window calls work on both backends — so branching on the requested device is safe.)

- [ ] **Step 2: Add the windowed path to the transcribe handler**

Import at the top: `import { planWindows, stitchChunkedResults, type WindowResult } from './whisperChunked'`.
In the transcribe handler, after `const resampled = ...`, branch:

```ts
      const useWordTimestamps = timestampMode !== 'segment'
      let result: { text: string; chunks: { text: string; timestamp: [number, number | null] }[] }

      if (requestedDevice === 'webgpu') {
        // Manual windowing: transformers.js's internal long-form merge is broken
        // on WebGPU (60s -> 1 garbage word); single-window (<=30s) calls are
        // correct. Each window is one single-chunk call; stitch with offsets.
        const windows = planWindows(resampled.length, 16000)
        const perWindow: WindowResult[] = []
        for (let wi = 0; wi < windows.length; wi++) {
          const { startS, endS } = windows[wi]
          const slice = resampled.subarray(Math.floor(startS * 16000), Math.floor(endS * 16000))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const out = await (asr as any)(slice, {
            return_timestamps: useWordTimestamps ? 'word' : true,
            language: whisperLanguageFor(language),
            task: 'transcribe',
            chunk_length_s: CHUNK_LENGTH_S, // window <= 30s stays single-chunk internally
          })
          perWindow.push({ offsetS: startS, windowEndS: endS, chunks: out.chunks ?? [] })
          const progress = Math.min(90, Math.round(((wi + 1) / windows.length) * 90))
          self.postMessage({ type: 'progress', payload: { status: 'transcribing', progress } })
        }
        self.postMessage({ type: 'progress', payload: { status: 'merging' } })
        result = stitchChunkedResults(perWindow)
      } else {
        // WASM: transformers.js's internal long-form algorithm works — unchanged path.
        /* existing asr(resampled, { ...chunk_length_s, stride_length_s, chunk_callback }) call,
           existing totalChunks/doneChunks progress + notifyMerging exactly as today */
      }
```
Keep the existing WASM call body verbatim inside the else (move, don't rewrite). The `finalizing` progress + `slimWhisperTranscript(result)` + result post stay AFTER the branch, shared. Confirm `slimWhisperTranscript` accepts `{ text, chunks }` (read `src/ai-pipeline/whisperTranscript.ts` — it consumes `result.chunks`/`result.text`; adapt the stitched object if it needs more fields).

- [ ] **Step 3: Verify types + existing tests**

`npx tsc -b --noEmit` → clean. `npx vitest run tests/ai-pipeline/` → green (the worker isn't directly unit-tested for transcription; `whisperTranscriber.test.ts` mocks the worker). NOTE: this path is DORMANT — `whisperBackend()` still returns wasm, so `requestedDevice` is always 'wasm' until Task 4.

- [ ] **Step 4: Commit**

```bash
git add src/ai-pipeline/whisper.worker.ts
git commit --no-gpg-sign -m "feat(ai): windowed transcription path in whisper worker (dormant, webgpu-requested only)"
```

---

### Task 3: In-browser validation gate (CONTROLLER-RUN — not a subagent)

No file changes. The controller runs this with preview tools (subagents have stalled on long preview loops before). To exercise the dormant path without flipping the default, temporarily edit `whisperBackend()` to return `{ device: 'webgpu', dtype: 'fp16' }` in the WORKING TREE (do not commit), run the gate, then `git checkout src/ai-pipeline/inferenceBackend.ts`.

- [ ] **Step 1: Start preview** (kill stale 5173 listeners first: `lsof -tiTCP:5173,5174 -sTCP:LISTEN | xargs -r kill`).

- [ ] **Step 2: Gate criteria on ted_60.wav via the app's real `transcribeAudio`** (word mode):
  1. mapped words within ~15% of the WASM baseline (186) → expect ≥158;
  2. timestamps monotonic, span ≥ 55s of the 60s;
  3. `refineAlignmentWithPhrases` on the transcript yields all non-zero line durations;
  4. transcription wall-clock ≤ half the WASM run on the same clip (WASM baseline: measure in the same session).
  Use the same eval pattern as the fdf276d debugging session (kick off async on `window.__gate`, poll with short sleeps).

- [ ] **Step 3: Same check on a real JA song** (decode a corpus MP3 clip in-browser or reuse the JFK/TED English clip + guitar-loneliness via node if browser decode is awkward — the REQUIRED bit is a real >60s multi-window run through `transcribeAudio` with non-zero alignment out).

- [ ] **Step 4: Verdict.** PASS → revert the temp edit and proceed to Task 4. FAIL → revert the temp edit, keep `whisperBackend()` WASM, record the numbers, skip Task 4, document in Task 5. Be honest — a FAIL keeps the app correct.

---

### Task 4: Flip the backend (ONLY if the Task 3 gate passed)

**Files:**
- Modify: `src/ai-pipeline/inferenceBackend.ts`
- Modify: `tests/ai-pipeline/inferenceBackend.test.ts`

- [ ] **Step 1: Update the failing test first**

Replace the `whisperBackend` describe block:
```ts
describe('whisperBackend', () => {
  it('uses webgpu (windowed transcription) on gpu tiers — fp16 small, q4 medium', () => {
    expect(whisperBackend('full', false)).toEqual({ device: 'webgpu', dtype: 'fp16' })
    expect(whisperBackend('full', true)).toEqual({ device: 'webgpu', dtype: 'q4' })
    expect(whisperBackend('lite', false)).toEqual({ device: 'webgpu', dtype: 'fp16' })
  })
  it('wasm q8 on manual tier regardless of high-accuracy', () => {
    expect(whisperBackend('manual', false)).toEqual({ device: 'wasm', dtype: 'q8' })
    expect(whisperBackend('manual', true)).toEqual({ device: 'wasm', dtype: 'q8' })
  })
})
```
Run → FAIL (current signature takes no args).

- [ ] **Step 2: Implement**

```ts
/** Whisper backend. WebGPU is safe ONLY via the worker's manual <=30s windowing
 * (whisperChunked.ts) — transformers.js's internal long-form merge is broken on
 * WebGPU (validated: 60s -> 1 garbage word). Gate re-validated 2026-07-11 via
 * the in-browser check in docs/superpowers/plans/2026-07-11-chunked-webgpu-whisper.md.
 * medium on WebGPU uses q4: fp16 garbles its decoder (validated on Apple Metal). */
export function whisperBackend(tier: DeviceTier, highAccuracy: boolean): InferenceBackend {
  if (tier === 'full' || tier === 'lite') {
    return { device: 'webgpu', dtype: highAccuracy ? 'q4' : 'fp16' }
  }
  return { device: 'wasm', dtype: 'q8' }
}
```
Update the call site in `whisperTranscriber.ts` (`ensureLoaded` has `tier` and `highAccuracy` in scope): `const backend = whisperBackend(tier, highAccuracy)`.

- [ ] **Step 3: Verify**

`npx vitest run tests/ai-pipeline/inferenceBackend.test.ts tests/ai-pipeline/whisperTranscriber.test.ts` → pass. `npx tsc -b --noEmit` → clean. `npm run build` → succeeds. Re-run the Task 3 browser check once on the committed code (no temp edit) to confirm the flip is live.

- [ ] **Step 4: Commit**

```bash
git add src/ai-pipeline/inferenceBackend.ts src/ai-pipeline/whisperTranscriber.ts tests/ai-pipeline/inferenceBackend.test.ts
git commit --no-gpg-sign -m "feat(ai): re-enable WebGPU whisper via manual windowing (gate passed)"
```

---

### Task 5: Findings + push

**Files:**
- Modify: `docs/superpowers/2026-07-10-webgpu-migration-findings.md`

- [ ] **Step 1:** Append a `## Chunked WebGPU transcription (2026-07-11)` section: the windowing design (30s/5s, midpoint dedup), the gate numbers (word count, span, alignment, speedup vs WASM), and the verdict (flipped / stayed WASM + why). Update memory ([[transcription-stack]]) with the outcome.
- [ ] **Step 2:** `npx tsx scripts/audit-corpus.mjs --check-baseline` (no regressions) + full `npx vitest run tests/ai-pipeline/ tests/lyrics/` green. Commit docs; push the branch (updates PR #7).

---

## Self-review notes
- **Spec coverage:** §1 pure module → Task 1; §2 worker windowing → Task 2; §3 gated backend → Task 4 (dtype q4 medium reinstated); §4 validation gate → Task 3; error handling (fallback stays at the load site; stitcher no-throw) → Tasks 1-2; testing → Tasks 1, 3, 5. Covered.
- **Type consistency:** `planWindows(totalSamples, sampleRate) → AudioWindow[]`; `stitchChunkedResults(WindowResult[]) → {text, chunks}`; `WindowResult {offsetS, windowEndS, chunks}`; `whisperBackend(tier, highAccuracy)` (Task 4 signature change, call site updated). Consistent.
- **Gate honesty:** Task 3 is controller-run with an explicit FAIL path that keeps WASM; Task 4 is conditional.
