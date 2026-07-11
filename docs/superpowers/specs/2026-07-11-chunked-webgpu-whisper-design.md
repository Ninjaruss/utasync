# Chunked WebGPU Whisper Transcription — Design Spec

**Date:** 2026-07-11
**Status:** Approved

## Goal

Reclaim WebGPU transcription speed without reintroducing the all-zero-timestamp
bug. Commit `fdf276d` forced Whisper to WASM because the onnxruntime WebGPU
backend produces broken long-form (>30s) timestamps: transformers.js's internal
chunked long-form algorithm collapses a 60s clip to ONE garbage word
`[29.98, 69.98]` on WebGPU, vs WASM's 186 correct per-word timestamps. But
**single-window (≤30s) WebGPU word timestamps are validated correct** (22/22 on
an 11s clip, proper per-word times). So: window the audio ourselves into ≤30s
pieces, transcribe each as a single-chunk WebGPU call, and stitch the results
with time offsets — bypassing the broken internal long-form merge entirely.

## Approach (chosen over alternatives)

**Fixed windows + overlap dedup in our worker.** Reimplements the stride-merge
transformers.js does internally, in a small pure module we control, on top of
individually-correct single-chunk calls.
- Rejected: silence-aware window boundaries (needs an energy detector, variable
  windows, fails on dense songs; marginal gain over overlap-dedup).
- Rejected: fixing transformers.js/onnxruntime upstream (not in our control).

## Components

### 1. `src/ai-pipeline/whisperChunked.ts` (new, pure)

- `planWindows(totalSamples: number, sampleRate: number): Array<{ startS: number; endS: number }>`
  — 30s windows with 5s overlap (stride 25s). If the final window would leave a
  tail shorter than 8s, extend the previous window to cover it (windows may
  slightly exceed 30s only in that merged-tail case; cap merged windows at 30s by
  instead shifting the last window's start back so it ends at the audio end).
  Audio ≤30s → a single window (current, working behavior).
- `stitchChunkedResults(perWindow: Array<{ offsetS: number; chunks: Chunk[] }>): { text: string; chunks: Chunk[] }`
  where `Chunk = { text: string; timestamp: [number, number | null] }` — the
  exact shape the pipeline already consumes (`slimWhisperTranscript` input).
  - Apply each window's `offsetS` to its chunk timestamps.
  - Overlap dedup by midpoint: for the overlap region between window N (ends at
    E) and window N+1 (starts at S = E − 5), the cut point is `(S + E) / 2`;
    keep window N's chunks whose midpoint `< cut`, window N+1's chunks whose
    midpoint `>= cut`.
  - Enforce monotonic non-decreasing start times; drop chunks with non-finite
    starts; a `null` end on a window's final chunk is clamped to the window end.
  - `text` = concatenation of kept chunk texts.
  - Pure function: empty/degenerate input returns an empty result, no throw.

### 2. Worker windowing (`src/ai-pipeline/whisper.worker.ts`)

When the loaded backend is `webgpu`, the transcribe handler:
- plans windows over the resampled audio, slices the Float32Array per window;
- calls the ASR once per window (single call ≤30s stays single-chunk internally;
  keep `chunk_length_s: 30`, same `return_timestamps`/`language`/`task` options);
- reports progress per window through the existing progress plumbing
  (windows-done / windows-total maps onto the current percentage UI);
- stitches with `stitchChunkedResults` and returns the same result shape as
  today (through `slimWhisperTranscript`).
When the backend is `wasm`, the existing single-call path with transformers.js's
internal long-form algorithm is unchanged (it works there).

### 3. Backend selection (`src/ai-pipeline/inferenceBackend.ts`)

- `whisperBackend()` returns WebGPU (fp16 small / q4 medium — reinstating the
  validated `whisperDtype` behavior) for full/lite tiers **only after the
  validation gate passes** (below); WASM (q8) otherwise and as the runtime
  fallback. Until the gate passes, `whisperBackend()` stays WASM and the
  stitcher ships dormant (unit-tested, unwired).

### 4. Validation gate (in-browser, before flipping the default)

Learned from three prior burns: no "WebGPU works" claim without driving the real
path on real multi-chunk audio. The gate, run in the preview browser on the 60s+
clip AND a real JA song through the app's `transcribeAudio`:
1. Word count within ~15% of the WASM path on the same audio.
2. Timestamps monotonic and spanning the full duration (no collapse, no
   truncation).
3. Alignment of a real JA song via `refineAlignmentWithPhrases` produces
   non-zero line times equivalent to the WASM path.
4. Real speed win: ≥2× faster than WASM end-to-end.
Gate fails → `whisperBackend()` stays WASM; stitcher remains dormant; findings
document the failure.

## Error handling

- Any window failing on WebGPU → the whole transcription retries once on WASM
  (reuses the existing load-site fallback machinery); never a partial stitched
  result mixing backends.
- Stitcher never throws on degenerate input; non-finite timestamps are dropped
  (the app's downstream `Number.isFinite` mapping remains as a second guard).
- Cancellation/timeout behavior of `transcribeAudio` is unchanged (windows are
  sequential awaits inside the same worker message handling).

## Testing

- Unit tests (vitest, no model): `planWindows` (short audio single window, exact
  boundaries, tail-merge rule) and `stitchChunkedResults` (offset application,
  midpoint dedup with duplicated overlap words, monotonicity, null-end clamp,
  empty input).
- Corpus untouched (fixtures are static transcripts; alignment logic unchanged).
- The in-browser validation gate is the acceptance test for flipping
  `whisperBackend()` to WebGPU.

## Non-goals

- Silence-aware windowing (future refinement if boundary artifacts show up).
- Parallel window inference (sequential is simpler; GPU is serial anyway).
- Changing the WASM path or the medium/high-accuracy UX.
