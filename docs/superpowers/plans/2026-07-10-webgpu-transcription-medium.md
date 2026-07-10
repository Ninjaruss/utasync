# WebGPU Transcription Migration + whisper-medium — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the browser transcription/embedding stack from `@xenova/transformers` v2 (WASM-only) to `@huggingface/transformers` v3 with WebGPU inference, and add an opt-in whisper-medium "High accuracy (slower)" mode (forced segment, full-tier + WebGPU gated) so mixed-language songs recover more accurate transcripts.

**Architecture:** v3 exposes a simple `pipeline(task, model, { device, dtype, progress_callback })` API where `device: 'webgpu'|'wasm'` and `dtype` (replacing v2's `quantized` boolean) select the backend. A shared `resolveInferenceBackend(tier)` policy drives both the Whisper worker and the embedder worker; WASM is the automatic fallback. A gated UI toggle selects the medium model + forces segment mode. The corpus scorecard (model-free) and the pairing embeddings cache are the regression guards.

**Tech Stack:** `@huggingface/transformers` v3, onnxruntime-web (WebGPU EP, already used by Demucs), Vite, vitest, React, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-10-webgpu-transcription-medium-design.md`

## Key facts pinned from v3 docs (context7 /huggingface/transformers.js)
- `pipeline("automatic-speech-recognition", modelId, { device, dtype, progress_callback })` — the manual `AutoTokenizer`/`AutoProcessor`/`WhisperForConditionalGeneration` construction in the current `whisperPipeline.ts` is no longer required; the pipeline handles it.
- `dtype` values: `'fp32'` (WebGPU default), `'fp16'`, `'q8'` (WASM default), `'q4'`. The legacy `quantized: true` boolean is replaced by `dtype`.
- WebGPU Whisper models are published under `onnx-community/` (e.g. `onnx-community/whisper-tiny.en`). The exact medium multilingual repo id is resolved by the Task 1 spike.
- `env.allowLocalModels`, `env.allowRemoteModels`, `env.useBrowserCache`, `env.backends.onnx.wasm.wasmPaths`, `env.backends.onnx.wasm.numThreads` all exist in v3.

## File map
- `package.json` — swap dependency.
- `src/ai-pipeline/inferenceBackend.ts` (new) — `resolveInferenceBackend(tier)`, `canUseHighAccuracy(tier)`.
- `src/ai-pipeline/models.ts` — model ids (small/medium), download hints, `getWhisperModel(tier, highAccuracy)`.
- `src/ai-pipeline/whisperPipeline.ts` — v3 loader with device/dtype.
- `src/ai-pipeline/whisper.worker.ts` — thread device/dtype/model through load + transcribe.
- `src/ai-pipeline/whisperTranscriber.ts` — pass highAccuracy/device options through.
- `src/ai-pipeline/textEmbed.worker.ts` — v3 embedder with device.
- `src/ai-pipeline/AutoAlignFlow.tsx` — "High accuracy (slower)" toggle + gating.
- `scripts/lib/nodeWhisper.mjs`, `scripts/lib/nodeEmbedder.mjs` — v3 in Node.
- Tests under `tests/ai-pipeline/`.

---

### Task 1: Feasibility-gate spike — v3 + whisper-medium on WebGPU (FAIL-FAST)

**This task gates the whole feature.** Resolve the exact medium repo id + dtype and prove medium runs in-browser on WebGPU without OOM, BEFORE migrating production code. If it can't, STOP and report — the feature collapses to "small-on-WebGPU + v3 migration" without the medium toggle (spec §Rollout).

**Files:**
- Modify: `package.json` (add `@huggingface/transformers`; keep `@xenova/transformers` for now — they coexist by different names)
- Create: `/private/tmp/.../scratchpad/v3-spike.mjs` (Node spike — NOT committed)
- Create: `.claude/spike-notes.md` (scratch notes of findings — NOT committed; delete after)

- [ ] **Step 1: Install v3 alongside v2**

```bash
npm install @huggingface/transformers@^3
```
Expected: installs without peer-dep errors. Note the exact resolved version.

- [ ] **Step 2: Node spike — resolve medium repo id + dtype, confirm output shape**

Write a scratch Node script that loads whisper-medium via v3 and transcribes a short slice of the stranger MP3 (`~/Downloads/stranger-than-heaven-theme-song-128-ytshorts.savetube.me.mp3`, first ~30s), trying repo ids in order until one loads: `onnx-community/whisper-medium`, then `onnx-community/whisper-medium.en` (English-only — only if multilingual unavailable), then `Xenova/whisper-medium`. Use `import { pipeline } from '@huggingface/transformers'` and `pipeline('automatic-speech-recognition', id, { dtype: 'q8' })` (Node has no WebGPU; this only confirms the repo id resolves + output shape). Decode audio with the existing `scripts/lib/nodeAudio.mjs`. Print: which repo id loaded, and `JSON.stringify(output).slice(0,300)` to confirm the `{ text, chunks: [{ text, timestamp:[s,e] }] }` shape matches what `slimWhisperTranscript` expects.

Run: `npx tsx /private/tmp/.../scratchpad/v3-spike.mjs`
Expected: one repo id loads; output has `text` + `chunks` with two-element numeric timestamps. Record the working repo id in `.claude/spike-notes.md`.

- [ ] **Step 3: Browser feasibility check — medium on WebGPU**

Use the preview tools. Create a throwaway route or use `preview_eval` in a page that imports v3 and runs:
```js
const { pipeline } = await import('@huggingface/transformers')
const t0 = performance.now()
const asr = await pipeline('automatic-speech-recognition', '<repo id from step 2>', { device: 'webgpu', dtype: 'fp16' })
const loadMs = performance.now() - t0
// transcribe ~30s of decoded audio (reuse the app's decodeToMono on a short clip)
```
Confirm via `preview_console_logs`: (a) the pipeline constructs on WebGPU without throwing, (b) a short transcription completes without an OOM/context-lost error, (c) capture load + inference wall-clock. If WebGPU init throws, record the error.

Run the dev server via `preview_start` first. Expected: medium loads on WebGPU and transcribes a short clip. Record timings + dtype used in `.claude/spike-notes.md`.

- [ ] **Step 4: GATE decision**

In `.claude/spike-notes.md` record the verdict:
- **PASS**: medium loads on WebGPU, transcribes without OOM, inference is tolerable (< ~2 min for 30s clip extrapolates to an acceptable full-song time). Record the repo id + chosen dtype (fp16 unless it OOMs, then q4/q8). Proceed to Task 2.
- **FAIL**: medium OOMs or WebGPU can't construct it. STOP. Report to the controller: the medium toggle is dropped; the plan continues from Task 2 but Task 3/8's medium path is replaced with "small-on-WebGPU only". Do not proceed without controller direction.

- [ ] **Step 5: Commit the dependency add only**

```bash
git add package.json package-lock.json
git commit --no-gpg-sign -m "build: add @huggingface/transformers v3 alongside v2 (WebGPU migration prep)

Spike verdict: <PASS/FAIL>. Medium repo: <id>, dtype: <fp16/q4>, in-browser load <Ns>, 30s infer <Ns>."
```
(Delete the scratch spike script and `.claude/spike-notes.md` after recording the findings in the commit message.)

---

### Task 2: Inference backend resolver + high-accuracy gate

**Files:**
- Create: `src/ai-pipeline/inferenceBackend.ts`
- Test: `tests/ai-pipeline/inferenceBackend.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ai-pipeline/inferenceBackend.test.ts
import { describe, it, expect } from 'vitest'
import { resolveInferenceBackend, canUseHighAccuracy } from '../../src/ai-pipeline/inferenceBackend'

describe('resolveInferenceBackend', () => {
  it('uses webgpu + fp16 on full tier', () => {
    expect(resolveInferenceBackend('full')).toEqual({ device: 'webgpu', dtype: 'fp16' })
  })
  it('uses webgpu on lite tier (WebGPU present, less RAM)', () => {
    expect(resolveInferenceBackend('lite')).toEqual({ device: 'webgpu', dtype: 'fp16' })
  })
  it('falls back to wasm + q8 on manual (no WebGPU) tier', () => {
    expect(resolveInferenceBackend('manual')).toEqual({ device: 'wasm', dtype: 'q8' })
  })
})

describe('canUseHighAccuracy', () => {
  it('true only on full tier', () => {
    expect(canUseHighAccuracy('full')).toBe(true)
    expect(canUseHighAccuracy('lite')).toBe(false)
    expect(canUseHighAccuracy('manual')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/ai-pipeline/inferenceBackend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/ai-pipeline/inferenceBackend.ts
import type { DeviceTier } from '../core/types'

export interface InferenceBackend {
  device: 'webgpu' | 'wasm'
  /** v3 dtype: fp16 for WebGPU, q8 for WASM (matches transformers.js defaults). */
  dtype: 'fp16' | 'q8'
}

/** WebGPU where the device has a GPU (lite/full tiers), WASM otherwise. Whisper
 * and the embedder share this policy; WASM stays the runtime fallback if a
 * WebGPU pipeline fails to construct (handled at the load site). */
export function resolveInferenceBackend(tier: DeviceTier): InferenceBackend {
  if (tier === 'full' || tier === 'lite') return { device: 'webgpu', dtype: 'fp16' }
  return { device: 'wasm', dtype: 'q8' }
}

/** whisper-medium high-accuracy mode: full tier only (WebGPU + >=6GB RAM), matching
 * the vocal-separation gate — the ~1.5GB model needs the headroom. */
export function canUseHighAccuracy(tier: DeviceTier): boolean {
  return tier === 'full'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ai-pipeline/inferenceBackend.test.ts`
Expected: PASS (4). Note: `DeviceTier` values are `'full' | 'lite' | 'manual'` (see `src/core/types`) — verify and adjust the test's tier names if they differ.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/inferenceBackend.ts tests/ai-pipeline/inferenceBackend.test.ts
git commit --no-gpg-sign -m "feat(ai): inference backend resolver + high-accuracy gate"
```

---

### Task 3: Model registry — small/medium ids + high-accuracy selection

**Files:**
- Modify: `src/ai-pipeline/models.ts`
- Test: `tests/ai-pipeline/models.test.ts` (extend existing)

- [ ] **Step 1: Write failing tests**

Add to `tests/ai-pipeline/models.test.ts` (read it first for import style):

```ts
import { getWhisperModel, WHISPER_MODEL_MEDIUM } from '../../src/ai-pipeline/models'

describe('getWhisperModel high-accuracy', () => {
  it('returns the small model by default', () => {
    expect(getWhisperModel('full')).toBe('onnx-community/whisper-small')
  })
  it('returns the medium model when highAccuracy is requested on full tier', () => {
    expect(getWhisperModel('full', true)).toBe(WHISPER_MODEL_MEDIUM)
  })
  it('ignores highAccuracy off full tier (small only)', () => {
    expect(getWhisperModel('lite', true)).toBe('onnx-community/whisper-small')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/ai-pipeline/models.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Update `src/ai-pipeline/models.ts`. Use the repo ids the Task 1 spike confirmed (shown here as the expected `onnx-community/*`; substitute the verified ids):

```ts
import type { DeviceTier } from '../core/types'
import { canUseHighAccuracy } from './inferenceBackend'

/** Default speech model — v3/WebGPU-compatible small (multilingual). */
export const WHISPER_MODEL_SMALL = 'onnx-community/whisper-small'
/** High-accuracy opt-in speech model (~1.5GB); full tier + WebGPU only. */
export const WHISPER_MODEL_MEDIUM = 'onnx-community/whisper-medium'

/** Model for the tier, upgraded to medium only when high accuracy is requested
 * AND the tier can run it. */
export function getWhisperModel(tier: DeviceTier, highAccuracy = false): string {
  if (highAccuracy && canUseHighAccuracy(tier)) return WHISPER_MODEL_MEDIUM
  return WHISPER_MODEL_SMALL
}

export function getWhisperDownloadHint(tier: DeviceTier, highAccuracy = false): string {
  return highAccuracy && canUseHighAccuracy(tier) ? WHISPER_DOWNLOAD_HINT_MEDIUM : WHISPER_DOWNLOAD_HINT
}

/** v3/WebGPU-compatible multilingual embeddings. */
export const EMBED_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
export function getEmbedModel(_tier: DeviceTier): string {
  return EMBED_MODEL
}

export const WHISPER_DOWNLOAD_HINT = '~240MB'
export const WHISPER_DOWNLOAD_HINT_MEDIUM = '~1.5GB'
```
Keep `WHISPER_MODEL_FULL`/`WHISPER_MODEL_LITE` as aliases of `WHISPER_MODEL_SMALL` if other code imports them (grep first: `grep -rn WHISPER_MODEL_FULL src/`), or update those call sites.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ai-pipeline/models.test.ts` — PASS. Then `npx tsc --noEmit` to catch broken imports of the renamed constants; fix any.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/models.ts tests/ai-pipeline/models.test.ts
git commit --no-gpg-sign -m "feat(ai): small/medium whisper model registry + high-accuracy selection"
```

---

### Task 4: Migrate the embedder worker to v3 + regenerate the pairing cache

Do the embedder first — it's the simpler v3 surface and validates embedding compatibility before the Whisper migration.

**Files:**
- Modify: `src/ai-pipeline/textEmbed.worker.ts`
- Modify: `scripts/lib/nodeEmbedder.mjs`
- Modify (regenerate): `tests/ai-pipeline/fixtures/embeddings-cache.json`
- Test: `tests/ai-pipeline/corpus-pairing.test.ts` (existing guard)

- [ ] **Step 1: Migrate the browser embedder worker to v3**

In `src/ai-pipeline/textEmbed.worker.ts` change the import to `@huggingface/transformers` and add the device from the tier passed in the `load` payload:

```ts
import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false
env.useBrowserCache = true
```
In the `load` handler, accept `device` in the payload and pass it:
```ts
const { model, device } = (payload as { model?: string; device?: 'webgpu' | 'wasm' } | undefined) ?? {}
extractor = await pipeline('feature-extraction', model ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
  device: device ?? 'wasm',
  progress_callback: (p: { status?: string; progress?: number }) =>
    self.postMessage({ type: 'progress', payload: p }),
})
```
If WebGPU construction throws, retry once with `device: 'wasm'` (wrap in try/catch). Keep the `embed` handler unchanged (the `extractor(chunk, { pooling, normalize })` call and `output.dims`/`output.data` shape are the same in v3). Thread `device` from `textEmbedder.ts` (resolve via `resolveInferenceBackend(getDeviceTier()).device`) — read `textEmbedder.ts` for where the worker `load` message is posted.

- [ ] **Step 2: Migrate the node embedder**

In `scripts/lib/nodeEmbedder.mjs` change the import to `@huggingface/transformers` and the pipeline call to drop `quantized` in favor of `{ dtype: 'q8' }` (Node = WASM). Keep the output shape handling identical.

- [ ] **Step 3: Regenerate the embeddings cache under v3 and check pairing**

```bash
npx tsx scripts/audit-corpus.mjs --pairing --write-embed-cache
npx tsx scripts/audit-corpus.mjs --pairing --dump-pairs > /private/tmp/.../scratchpad/pairs-v3.txt
```
Then run the guard: `npx vitest run tests/ai-pipeline/corpus-pairing.test.ts`
Expected: PASS. If `pair_wrong`/`pair_magnet`/`pair_unpaired` regressed vs the pre-migration numbers (compare `npx tsx scripts/audit-corpus.mjs --pairing` against `git show HEAD:tests/ai-pipeline/fixtures/corpus-baseline.json`), the v3 embeddings differ enough to matter: re-tune `MATCH_THRESHOLD` in `src/ai-pipeline/wordAligner.ts` minimally to restore the truth-labeled pairs, re-run, and note the change. If pairing is unchanged, the cache regen is a no-op diff — discard it (`git checkout tests/ai-pipeline/fixtures/embeddings-cache.json`) to keep the commit clean.

- [ ] **Step 4: Full pairing regression**

Run: `npx tsx scripts/audit-corpus.mjs --pairing`
Confirm the pair_* rows are stable vs baseline. Run `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/textEmbed.worker.ts scripts/lib/nodeEmbedder.mjs src/ai-pipeline/textEmbedder.ts
# add cache + wordAligner only if they actually changed:
# git add tests/ai-pipeline/fixtures/embeddings-cache.json src/ai-pipeline/wordAligner.ts tests/ai-pipeline/fixtures/corpus-baseline.json
git commit --no-gpg-sign -m "feat(ai): migrate embedder to transformers v3 (WebGPU) — pairing <unchanged/retuned>"
```

---

### Task 5: Migrate the Whisper pipeline loader to v3

The big one. v3's `pipeline()` replaces the manual construction. Preserve the custom WASM path config and the network-retry wrapper; simplify the prefetch/host machinery to what v3 needs.

**Files:**
- Modify: `src/ai-pipeline/whisperPipeline.ts`
- Test: `tests/ai-pipeline/whisperPipeline.test.ts` (new — light, mock-based)

- [ ] **Step 1: Write a light failing test for the loader contract**

The loader does real model IO, so test only its option-shaping via a mock. Create `tests/ai-pipeline/whisperPipeline.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } } },
  pipeline: vi.fn(async () => ({ mock: true })),
}))

import { loadWhisperAsrPipeline } from '../../src/ai-pipeline/whisperPipeline'
import { pipeline } from '@huggingface/transformers'

describe('loadWhisperAsrPipeline', () => {
  it('passes device + dtype to the v3 pipeline', async () => {
    await loadWhisperAsrPipeline('onnx-community/whisper-small', { device: 'webgpu', dtype: 'fp16' })
    expect(pipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'onnx-community/whisper-small',
      expect.objectContaining({ device: 'webgpu', dtype: 'fp16' }),
    )
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/ai-pipeline/whisperPipeline.test.ts`
Expected: FAIL (current signature takes `(modelId, progress_callback)` and uses v2 manual construction).

- [ ] **Step 3: Rewrite `loadWhisperAsrPipeline` for v3**

Replace the v2 imports and body. New signature `loadWhisperAsrPipeline(modelId, backend, progress_callback?)` where `backend: { device, dtype }`:

```ts
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { friendlyModelLoadError, withNetworkRetry } from './networkErrors'
import type { InferenceBackend } from './inferenceBackend'

function onnxWasmBaseUrl(): string { /* unchanged from current file */ }
function preferredWasmThreadCount(): number { /* unchanged from current file */ }

export function configureWhisperEnv(): void {
  env.allowLocalModels = false
  env.useBrowserCache = true
  const wasm = env.backends?.onnx?.wasm
  if (wasm) {
    wasm.proxy = false
    wasm.wasmPaths = onnxWasmBaseUrl()
    wasm.numThreads = preferredWasmThreadCount()
  }
}

type ProgressCallback = (p: { status?: string; progress?: number; file?: string; name?: string }) => void

export async function loadWhisperAsrPipeline(
  modelId: string,
  backend: InferenceBackend,
  progress_callback?: ProgressCallback,
): Promise<AutomaticSpeechRecognitionPipeline> {
  configureWhisperEnv()
  const load = () => pipeline('automatic-speech-recognition', modelId, {
    device: backend.device,
    dtype: backend.dtype,
    progress_callback: (p: { status?: string; progress?: number; file?: string }) =>
      progress_callback?.({ ...p, name: modelId }),
  }) as Promise<AutomaticSpeechRecognitionPipeline>
  try {
    // WebGPU can fail to construct on some drivers — fall back to WASM once.
    return await withNetworkRetry(load, 3, 1500)
  } catch (err) {
    if (backend.device === 'webgpu') {
      try {
        return await withNetworkRetry(
          () => pipeline('automatic-speech-recognition', modelId, {
            device: 'wasm', dtype: 'q8',
            progress_callback: (p: { status?: string; progress?: number; file?: string }) =>
              progress_callback?.({ ...p, name: modelId }),
          }) as Promise<AutomaticSpeechRecognitionPipeline>,
          3, 1500,
        )
      } catch (err2) { throw friendlyModelLoadError(err2) }
    }
    throw friendlyModelLoadError(err)
  }
}
```
Notes: v3's `pipeline()` handles the download/caching that the old `prefetchWhisperModelFiles`/mirror-host machinery did manually — the custom HF_HOSTS prefetch is dropped (v3 progress_callback already reports per-file download). If `modelPrefetch.ts`/`HF_HOSTS` are now unused, remove them (grep for other importers first). Keep `withNetworkRetry` and `friendlyModelLoadError`. Verify the v3 `AutomaticSpeechRecognitionPipeline` type export name (adjust import if v3 renamed it).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ai-pipeline/whisperPipeline.test.ts` — PASS. Then `npx tsc --noEmit` — fix fallout (the worker calls this loader; Task 6 updates it, so a temporary type error there is expected until Task 6 — if `tsc` fails only in `whisper.worker.ts`, proceed to Task 6 then re-check).

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/whisperPipeline.ts tests/ai-pipeline/whisperPipeline.test.ts
git commit --no-gpg-sign -m "feat(ai): migrate whisper loader to transformers v3 with device/dtype"
```

---

### Task 6: Thread device/model through the Whisper worker + transcriber

**Files:**
- Modify: `src/ai-pipeline/whisper.worker.ts`
- Modify: `src/ai-pipeline/whisperTranscriber.ts`

- [ ] **Step 1: Update the worker load handler**

In `src/ai-pipeline/whisper.worker.ts`, the `load` payload already carries `model`; add `device`/`dtype` and pass a backend object to the loader:

```ts
const { model, device, dtype } = (payload as { model?: string; device?: 'webgpu'|'wasm'; dtype?: 'fp16'|'q8' } | undefined) ?? {}
asr = await loadWhisperAsrPipeline(
  model ?? getWhisperModel('lite'),
  { device: device ?? 'wasm', dtype: dtype ?? 'q8' },
  (raw) => { /* existing tracker.ingest wiring unchanged */ },
)
```
The transcribe handler (asr call with return_timestamps/language/chunk_length_s) is unchanged — v3's ASR pipeline accepts the same call options and returns the same `{ text, chunks }` shape.

- [ ] **Step 2: Update `whisperTranscriber.ts` to resolve + post the backend**

In `src/ai-pipeline/whisperTranscriber.ts`, where the worker `load`/`transcribe` messages are posted, resolve the backend from tier and include the model. Add a `highAccuracy?: boolean` option to `transcribeAudio`; compute:
```ts
import { resolveInferenceBackend } from './inferenceBackend'
import { getWhisperModel } from './models'
import { getDeviceTier } from './capability'
// ...
const tier = getDeviceTier()
const backend = resolveInferenceBackend(tier)
const model = getWhisperModel(tier, options?.highAccuracy ?? false)
// post { type:'load', payload: { model, device: backend.device, dtype: backend.dtype } }
```
Read the file to place these at the existing load-post site. Keep everything else (timeout, message plumbing) intact.

- [ ] **Step 3: Verify types + existing transcriber tests**

Run: `npx tsc --noEmit` — clean now. Run: `npx vitest run tests/ai-pipeline/whisperTranscriber.test.ts` — if its mocked worker payload assertions need `device`/`dtype`/`model`, update the expected payload. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ai-pipeline/whisper.worker.ts src/ai-pipeline/whisperTranscriber.ts
git commit --no-gpg-sign -m "feat(ai): thread device/dtype/model through whisper worker + transcriber"
```

---

### Task 7: Migrate the Node whisper helper to v3

**Files:**
- Modify: `scripts/lib/nodeWhisper.mjs`

- [ ] **Step 1: Migrate**

Change the import to `@huggingface/transformers`, replace `pipeline('automatic-speech-recognition', WHISPER_MODEL, { quantized: true })` with `{ dtype: 'q8' }` (Node WASM), and keep the `--model`/`language: 'auto'→omit`/timestampMode logic exactly as-is (from prior commits `034caab`/the `--model` flag). Cache the pipeline per model id as it already does.

- [ ] **Step 2: Smoke-test the offline audit path still works**

```bash
npx tsx scripts/transcribe-file.mjs ~/Downloads/stranger-than-heaven-theme-song-128-ytshorts.savetube.me.mp3 --language japanese --mode segment --out /private/tmp/.../scratchpad/v3-node-smoke.json
```
Expected: completes, writes `{chunks:[...]}` with non-empty text + finite timestamps. Confirm the output shape matches the committed fixtures (so `audit-corpus.mjs` still loads node-produced transcripts).

- [ ] **Step 3: Corpus scorecard unaffected**

Run: `npx tsx scripts/audit-corpus.mjs --check-baseline`
Expected: no regressions (the audit reads committed fixture transcripts, not the model — this confirms the node migration didn't break the harness imports).

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/nodeWhisper.mjs
git commit --no-gpg-sign -m "feat(scripts): migrate node whisper helper to transformers v3"
```

---

### Task 8: "High accuracy (slower)" opt-in UI

**Files:**
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx`
- Test: `tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx` (extend) or a new render test

- [ ] **Step 1: Write a failing UI test**

Add a test asserting the toggle renders only on full tier and, when on, `transcribeAudio` is called with `highAccuracy: true`. Read `tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx` for the existing mock setup (it mocks `transcribeAudio`). Assert: with `getDeviceTier` mocked to `'full'`, a control labeled /high accuracy/i is present; toggling it and starting calls the mocked `transcribeAudio` with `expect.objectContaining({ highAccuracy: true })`. With tier `'manual'`, the control is absent.

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx`
Expected: FAIL — no such control / option not passed.

- [ ] **Step 3: Implement the toggle**

In `src/ai-pipeline/AutoAlignFlow.tsx`, mirror the vocal-separation toggle pattern (state + gating + label). Add:
```ts
import { canUseHighAccuracy } from './inferenceBackend'
// near the vocalSeparation state:
const [highAccuracy, setHighAccuracy] = useState(false)
const highAccuracySupported = canUseHighAccuracy(tier)
```
Render a checkbox/label next to the vocal-separation one, only when `highAccuracySupported`, labeled "High accuracy (slower) · ~1.5GB" using `getWhisperDownloadHint(tier, true)`. Pass it into the transcribe call (the `transcribeAudio(...)` at ~line 181):
```ts
const transcriptResult = await transcribeAudio(audioData, sampleRate, {
  language: song.lyrics.sourceLanguage,
  highAccuracy: highAccuracy && highAccuracySupported,
  // forced segment when high accuracy (dodges medium word-mode loop pathology):
  timestampMode: (highAccuracy && highAccuracySupported)
    ? 'segment'
    : preferredWhisperTimestampMode(tier, durationSec, { accurateReadings }),
  // ...existing options
})
```
Keep the existing `accurateReadings` opt-in intact and mutually sensible (if both are somehow set, high-accuracy forcing segment wins — document with a one-line comment).

- [ ] **Step 4: Run to verify pass + full component tests**

Run: `npx vitest run tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx` — PASS. Run `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/AutoAlignFlow.tsx tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx
git commit --no-gpg-sign -m "feat(ui): High accuracy (slower) whisper-medium opt-in (full tier + WebGPU)"
```

---

### Task 9: Drop v2, in-browser verification, full regression

**Files:**
- Modify: `package.json` (remove `@xenova/transformers`)
- Modify: any lingering v2 imports (should be none)

- [ ] **Step 1: Confirm no v2 imports remain, then remove the dep**

```bash
grep -rn "@xenova/transformers" src/ scripts/
```
Expected: no hits. Then:
```bash
npm uninstall @xenova/transformers
```
Run `npx tsc --noEmit` and `npx vitest run tests/` — expect clean/green.

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: `tsc -b` + `vite build` succeed (this is the stricter `noUnusedLocals` gate that caught the earlier dead import). Fix any fallout.

- [ ] **Step 3: In-browser end-to-end verification (preview tools)**

`preview_start` the dev server. In the app, run auto-align on a real song:
- Default path (no high-accuracy): confirm via `preview_console_logs`/`preview_network` that Whisper loads on WebGPU (full-tier device) and transcription completes; lyrics get timed.
- Toggle "High accuracy (slower)" on a >180s song and confirm: the ~1.5GB medium model downloads (network), transcription runs on WebGPU without OOM (console), and the result aligns (segment mode). Capture a screenshot of the aligned result.
If WebGPU isn't available in the preview environment, confirm the WASM fallback path instead and note it.

- [ ] **Step 4: Full regression**

```bash
npx vitest run tests/
npx tsx scripts/audit-corpus.mjs --check-baseline
```
Expected: all green, no baseline regressions.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit --no-gpg-sign -m "build: drop @xenova/transformers v2 — fully migrated to v3/WebGPU"
```

---

### Task 10: Findings + docs

**Files:**
- Modify: `docs/superpowers/2026-07-line-boundary-findings.md` (or a new `docs/superpowers/2026-07-10-webgpu-migration-findings.md`)

- [ ] **Step 1: Document outcomes**

Record: the Task 1 spike verdict (medium repo id, dtype, in-browser load/inference times), the default-path speed change on WebGPU, whether the embedder migration moved any pairing metric (and any MATCH_THRESHOLD retune), the medium high-accuracy scorecard/eyeball result on stranger (re-run `scripts/audit-corpus.mjs` with a fresh medium transcript if desired), and any residual (e.g. WASM fallback devices unchanged). If the Task 1 gate FAILED and medium was dropped, document that and what shipped instead.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/
git commit --no-gpg-sign -m "docs: WebGPU transcription migration outcomes + medium verdict"
```

---

## Self-review notes
- **Spec coverage:** C1 migration → Tasks 4–7,9; C2 matrix → Tasks 2,3,6; C3 opt-in → Tasks 3,8; C4 hosting (HF CDN, no code) → default v3 behavior, noted in Task 5; C5 regression → Tasks 4 (embedder/pairing),5–7 (shape),9 (full); C6 feasibility gate → Task 1. All covered.
- **Fail-fast:** Task 1 gates the medium path before any production migration; a FAIL degrades the plan to small-on-WebGPU (still ships the v3 migration + speed win).
- **Type consistency:** `resolveInferenceBackend`→`InferenceBackend {device,dtype}`; `getWhisperModel(tier, highAccuracy)`; `loadWhisperAsrPipeline(modelId, backend, cb)`; `canUseHighAccuracy(tier)` — used consistently across tasks.
- **Repo ids** (`onnx-community/whisper-*`) are the expected v3 ids; Task 1 confirms the exact medium id and all later tasks use whatever Task 1 verified.
