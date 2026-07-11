# WebGPU Transcription Migration + whisper-medium — Findings

**Date:** 2026-07-10
**Branch:** accuracy-round-2
**Spec:** docs/superpowers/specs/2026-07-10-webgpu-transcription-medium-design.md
**Plan:** docs/superpowers/plans/2026-07-10-webgpu-transcription-medium.md

## What shipped

Migrated the entire on-device transformers.js stack from `@xenova/transformers`
v2 (WASM-only) to `@huggingface/transformers` v3.8.1 (WebGPU-capable), and added
an opt-in whisper-medium "High accuracy (slower)" transcription mode.

- **WebGPU by default on capable devices.** `resolveInferenceBackend(tier)`
  (`src/ai-pipeline/inferenceBackend.ts`) returns `{ device: 'webgpu', dtype:
  'fp16' }` for full/lite tiers, `{ 'wasm', 'q8' }` otherwise. Both the Whisper
  loader and the word-pairing embedder now run on WebGPU where available, with an
  automatic WASM fallback if a WebGPU pipeline fails to construct. WebGPU was
  already proven in this app by Demucs (`demucs.worker.ts`,
  `executionProviders: ['webgpu', 'wasm']`).
- **whisper-medium high-accuracy opt-in.** A full-tier + WebGPU-gated toggle
  (`canUseHighAccuracy` → `tier === 'full'`) in `AutoAlignFlow.tsx` selects
  `Xenova/whisper-medium` and forces `timestampMode: 'segment'`. The headroom
  experiment (findings §2026-07-10 addendum, this branch) measured medium+segment
  taking evidence-backed line boundaries on stranger-than-heaven from 14→31 of 59
  with needs_review 3→0 — the win this feature exists to deliver, once run on a
  real WebGPU device.
- **Model-reload guard.** `whisperTranscriber.ts` tracks `loadedModel` and
  resets+reloads the worker when the requested model differs from the warm one —
  without it, toggling high-accuracy on a pre-warmed small-model worker would
  silently keep using small. `loadedModel` is cleared in all five teardown paths.
- **Corrupt-cache recovery preserved.** The v2 loader had custom prefetch +
  mirror-host + corrupt-cache purge. v3's `pipeline()` handles download/caching
  internally (mirror-host machinery dropped, `modelPrefetch.ts` deleted as dead),
  but v3's cache does NO integrity validation — so a truncated download (likely
  for the ~1.5GB medium model) would loop forever. The loader's failure path now
  calls `purgeCorruptModelCaches()` + `clearWhisperModelCache(modelId)` after
  retries are exhausted, keeping the "cleared automatically" error copy truthful.

## Model ids (resolved by HF probe)

- `Xenova/whisper-small` (default) and `Xenova/whisper-medium` (high-accuracy) —
  BOTH carry `onnx/encoder_model_fp16.onnx`, so both run on WebGPU with fp16.
- `onnx-community/whisper-medium` does **not** exist (HF 401 on all files). The
  Task 1 spike's fallback to `Xenova/whisper-medium` was the correct and only
  multilingual medium option.

## Regression outcomes (all guards green)

- **Embedder (v3):** word-pairing metrics byte-identical across the whole corpus
  (pair_wrong/magnet/unpaired unchanged) — v3 embeddings differ numerically but
  produce identical pairing decisions, so no `MATCH_THRESHOLD` retune and the
  regenerated cache was discarded (code-only commit).
- **Whisper output shape:** v3 keeps `{ text, chunks: [{ text, timestamp }] }` —
  the aligner/reading pipeline sees no change; committed corpus transcripts are
  static data so alignment/reading audits stayed deterministic.
- **`npm run build`** (tsc -b + vite build) passes. **Corpus baseline** unchanged.
  Full vitest green (4 real-computation integration tests time out only under
  heavy full-suite parallel load; all pass standalone, 27/27).
- **Build config:** `vite.config.ts` now serves onnxruntime-web wasm + the ORT
  bundle from `@huggingface/transformers`'s nested `onnxruntime-web/dist/`
  (`ort.bundle.min.mjs`) instead of v2's `ort-web.min.js`.

## IMPORTANT — deferred validation (user's real device)

WebGPU is **not available in the CI/preview environment** (`navigator.gpu`
undefined), so the actual whisper-medium-on-WebGPU run could not be exercised
here. Verified here: `npm run build`, full test suite, corpus baseline, and that
the app boots with zero console/server errors on the WASM path (the high-accuracy
toggle correctly hides on this non-WebGPU env). **Still to validate on a real
WebGPU device:**
1. whisper-small on WebGPU (default path) transcribes and is faster than WASM.
2. The "High accuracy (slower)" toggle appears (full tier), downloads the ~1.5GB
   medium model, and transcribes on WebGPU without OOM.
3. The measured accuracy win (stranger-than-heaven line coverage 14→31) holds
   end-to-end in the app.
If medium OOMs on real WebGPU hardware, the dtype can drop from fp16 to q4
(`inferenceBackend.ts`), or the feature degrades to small-on-WebGPU only.

## Deferred follow-ups (documented, not blocking)

- `whisperTranscriber.ts`: `ensureLoaded` has a theoretical concurrency gap if
  `preloadWhisper` (currently unused) races a `transcribeAudio` with differing
  highAccuracy while a load is in flight — a mid-flight reset would hang the first
  caller. Benign under current serial call patterns; guard before wiring
  `preloadWhisper`.
- `AutoAlignFlow.tsx`: if a user checks both "Word-level timestamps (slower)" and
  "High accuracy (slower)", high-accuracy silently wins (forces segment) with no
  UI cue. Consider disabling/greying the word-level toggle when high-accuracy is
  on.
- Two `transcribeAudio` error paths don't call `worker?.terminate()` before
  nulling `worker` (pre-existing, unlike the other teardown paths).
- HF-CDN hosting for medium: self-hosting on GitHub releases (the Demucs pattern)
  remains the documented fallback if HF reliability becomes an issue.

## Two-pass bilingual transcription — PAUSED (Approach A dead-end)

Spec/plan: docs/superpowers/specs/2026-07-10-two-pass-bilingual-transcription-design.md
and .../plans/2026-07-10-two-pass-bilingual-transcription.md.

The idea: for mixed JA/EN songs, transcribe twice (forced Japanese + forced
English) and merge per lyric line by language, to recover English sections that
forced-JA decoding garbles (STRANGER THAN HEAVEN's rap + the 160–198s region).

**Approach A (align twice, select per line) empirically REGRESSES the corpus and
was paused.** The premise — that each forced-language pass aligns its own
language well — is false. The aligner aligns the WHOLE bilingual sheet against
ONE monolingual transcript; the ~50% of lines in the other language have zero
matches, which collapses the aligner's confidence and wrecks the entire pass's
layout, not just the other-language lines. Measured (stranger word two-pass merge
vs single-pass forced-JA): `bnd_measured` 20→4, `align_pileup` 2→24,
`align_compressed` 20→38. The diagnostic showed the forced-EN pass crushing 15
consecutive English lines into a ~2s window (117.6–119.5s), so picking English
lines out of that garbage produced the pileups.

**What was kept** (dormant, for a future retry): `isMixedLanguageSheet`
(whisperLanguage.ts), exported `enforceLineMonotonicity`, the sound per-line
`mergeBilingualAlignments` unit (src/lyrics/bilingualMerge.ts + tests — the merge
logic is fine; it was fed two broken alignments), the committed forced-EN stranger
fixture, and `mpg123-decoder` as a saved devDep. The audit-script two-pass wiring
and corpus row were reverted (no regression locked in; baseline unchanged).

**If revisited**, the two viable redesigns are: (A′) align each language's
SUB-sheet separately against its transcript then interleave — but the forced-EN
transcript hallucinates English over the JA verses, so the EN sub-sheet may still
mis-match; or (B) splice forced-EN words into the EN time-regions of a single
transcript and align once (needs language-region detection) — avoids the
monolingual-layout problem because the merged transcript has content for every
line. The shipped whisper-medium high-accuracy mode remains the working lever for
mixed songs; the 160–198s region stays unrecovered.
