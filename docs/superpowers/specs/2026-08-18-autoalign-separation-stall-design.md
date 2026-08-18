# Auto-align stall: honest vocal separation

**Date:** 2026-08-18
**Status:** Approved, ready for planning
**Thread:** A of a three-part UX audit (B = cross-browser/device compat, C = replacing manual timing flows)

## Problem

A user reported auto-align "spinning for more than 50 minutes without any progress".
The screenshot shows the flow parked on step 2/5, **Separating vocals**, at 44%.

It is almost certainly not hung. It is running Demucs on the WASM execution
provider, which for a 3:50 song is ~155 MDX-Net chunks and plausibly takes over
an hour. Four defects turn a slow run into an apparently dead app:

1. **No timeout.** `separateVocals` in `src/ai-pipeline/demucsSeparator.ts` has no
   overall cap, unlike Whisper's `max(300s, durationSec * 20s)`
   (`src/ai-pipeline/whisperTranscriber.ts:174`).
2. **Cancel cannot land.** `isCancelled` is polled only when a `progress` message
   arrives (`demucsSeparator.ts:96`). A wedged `session.run()` emits nothing, so the
   Cancel button is inert exactly when it is needed.
3. **Silent backend fallback.** The worker requests
   `executionProviders: ['webgpu', 'wasm']` (`demucs.worker.ts:56`) and onnxruntime
   silently falls back to WASM. Nothing — not the UI, not the console — reports
   which provider was actually used.
4. **Tier gate trusts the wrong signal.** `getDeviceTier()` in
   `src/ai-pipeline/capability.ts` checks only that `navigator.gpu` *exists*. It
   never calls `requestAdapter()`, which is the standard false positive on Linux,
   blocklisted GPUs, and differing worker contexts.

There is no progress signal a user can act on: no ETA, no backend name, no way out.

## Key insight

The separation call site already handles failure well. A thrown error is caught at
`AutoAlignFlow.tsx:241` and falls back to transcribing the raw decoded mix, with an
existing `retryNotice` message — the same path used by the stem-quality guard. That
path is established and tested.

So the entire fix is: **make "too slow" a first-class outcome that routes into the
existing fallback.** No new failure semantics, no new recovery path.

## Design

### 1. Backend truth

`getDeviceTier()` stays synchronous. It is called from ~15 sites including React
render paths (`PlayerView.tsx`, `SettingsView.tsx`, `wordAligner.ts`); making it
async is a large, unrelated refactor with real regression risk.

Instead:

- Add `probeWebGPUAdapter(): Promise<boolean>` to `capability.ts`. It calls
  `navigator.gpu.requestAdapter()` and memoizes the result. `hasWebGPU()` is
  unchanged for existing sync callers.
- The demucs worker reports the provider its session actually resolved to:
  `{ type: 'loaded', payload: { provider: 'webgpu' | 'wasm' } }`.
- `separateVocals` surfaces that provider to its caller and logs it at info level.

The console log is deliberate: no automated test can exercise a real WebGPU device,
so this is how the original report gets confirmed on the reporter's machine.

### 2. Honest ETA, user's choice

`nChunks` is known before inference begins, and chunk 1 yields a measured per-chunk
cost.

- Worker emits `{ chunk, nChunks, elapsedMs }` alongside each progress message.
- Host extrapolates total runtime. If the projection exceeds **3x the audio length**
  (8 min floor), it pauses
  and asks: *"Vocal separation will take about N minutes on this device. Skip it and
  align on the original mix, or keep going?"*
- **Skip** throws a sentinel error caught by the existing handler at
  `AutoAlignFlow.tsx:241` → raw-mix fallback → existing notice copy.
- **Keep going** suppresses the dialog for the remainder of that run, and the progress
  UI switches from a bare percentage to `~N min remaining`.

Estimation and the threshold live in one small pure module so they are unit-testable
without a GPU.

### 3. Timeout backstop and a Cancel that lands

- **Hard cap** on total separation: `max(15 min, durationSec * 6 seconds)`. For a 3:50
  song that is ~23 minutes. Whisper's multiplier (20s of budget per second of audio)
  is far too generous here — it would permit a ~77 minute run, i.e. exactly the bug
  being fixed. On expiry, terminate the worker and take the raw-mix fallback.
- **Accepting a long ETA raises the cap.** If the user was shown a projection and chose
  "keep going", the cap is raised to `projectedMs * 1.5` for that run. Killing a user at
  23 minutes after they explicitly accepted a 45-minute estimate would be a worse bug
  than the one being fixed. The stall watchdog still applies unchanged — accepting a
  slow run is not accepting a wedged one.
- **Cancel terminates immediately.** Replace the `isCancelled` polling callback with an
  `AbortSignal` whose `abort` handler calls `worker.terminate()` directly. Correctness no
  longer depends on the worker being responsive enough to send a progress message.
- **Per-chunk stall watchdog.** If no progress message arrives for **90 seconds**, treat
  the run as wedged, terminate, and fall back. This is the case that catches a lost
  WebGPU device, which the total cap alone would make the user wait out.

The three are complementary: the watchdog catches a wedge fast, the cap bounds a
merely-glacial run, and abort gives the user an exit at any moment.

### 4. Testing

`separateVocals` is worker-backed, so tests target the seams rather than the model:

- ETA projection and threshold logic — pure module, direct unit tests.
- Abort-on-signal and the stall watchdog — fake worker double plus fake timers.
- Provider reporting — assert the host surfaces what the worker sent.
- One integration test asserting that a slow run, a stalled run, and an aborted run all
  land on the raw-mix path with `audioData` and `sampleRate` left at their decoded values.

## Out of scope

Deliberately excluded, to keep this shippable and reviewable:

- Changing tier gates for whisper-medium or word timestamps. `canUseHighAccuracy` and
  the word-mode gates keep their current behavior.
- Any Settings UI for a persisted vocal-separation preference.
- Broader cross-browser compatibility work (thread B).
- Replacing tap-through or fine-tune line timing (thread C).

## Success criteria

- Auto-align can never sit longer than the hard cap without either finishing, asking the
  user a question, or falling back. Absent an accepted ETA, that cap is ~23 minutes for a
  typical song — not the ~77 minutes a Whisper-shaped multiplier would allow.
- Cancel takes effect within one second regardless of worker state.
- The resolved execution provider is visible in the console for every separation run.
- A user on a WASM-only device reaches timed lyrics — via the raw mix — rather than
  watching an unbounded progress bar.


## Post-implementation: measured calibration (2026-08-18)

The thresholds above were originally set from an assumption — that WebGPU
separation "should take 1-2 minutes" for a typical song. Live verification
refuted it, and both numbers were changed as a result.

Measured on an Apple-silicon WebGPU device with a 10-second clip: ~2.15s per
inference chunk steady-state, ~3.1s for chunk 1 (which carries warmup).
Extrapolated to a 3:50 song (152 chunks):

| | Multiple of audio length | 3:50 song |
|---|---|---|
| Actual run time | ~1.4x | ~5.5 min |
| Projection from chunk 1 (what the prompt compares against) | ~2.05x | ~8 min |

The original flat 5-minute prompt threshold sat *below* a healthy run, so the
"this will take a while" dialog would have fired on nearly every full-length
song on the GPU path — the failure mode where a warning becomes noise users
learn to dismiss. The threshold is now `max(8 min, 3x duration)`, leaving ~1.5x
margin over a healthy projection while still catching WASM, which is an order
of magnitude worse.

The hard cap moved from 4x to 6x for the same reason: 4x (~15 min) was close
enough to a slow-but-healthy run that a slower GPU could have been killed
mid-run, which would be a worse bug than the one being fixed.

Also verified live: the worker reports `webgpu` on this machine, and an
`AbortController` fired mid-inference rejected in **0 ms** — the inert-Cancel
defect that motivated the work is genuinely gone.

Still unverified anywhere: the WASM path itself. No machine in reach lacks a
WebGPU adapter, so the no-GPU prompt and the WASM timing that triggers it rest
on the tier logic and unit tests, not on observation.
