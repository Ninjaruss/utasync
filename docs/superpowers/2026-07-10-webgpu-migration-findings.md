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

## On-device WebGPU validation — DONE (Apple Metal-3, 2026-07-10)

Initially deferred (early in the session the preview browser reported no
`navigator.gpu`), but WebGPU later became available in the preview (real Apple
Metal-3 adapter via `requestAdapter()`), so the on-device path WAS validated by
loading the models through `@huggingface/transformers` in the preview and
transcribing the JFK sample clip (~11s):

- **whisper-small / fp16 / WebGPU — PERFECT.** Transcribed the clip verbatim;
  inference **3.5s** for 11s audio (~0.3× realtime). The default-path WebGPU
  speed win is confirmed correct and fast.
- **whisper-medium / fp16 / WebGPU — BROKEN (fixed).** Loaded without OOM
  (~1.5GB, single load) but the output was truncated/garbled ("and so my fellow
  America and" then early-stop) and slow (**~45s**/11s-clip). This is fp16
  numerical instability in the larger decoder. **Fix (commit after this doc):
  medium uses `dtype: 'q4'` on WebGPU** via `whisperDtype()` in
  `inferenceBackend.ts`.
- **whisper-medium / q4 / WebGPU — CORRECT + faster.** Decoded the clip verbatim
  and inference was **~14s** (~3× faster than fp16). q4 wins on every axis
  (correctness, speed, download size), so it is the shipped medium-on-WebGPU
  dtype.

Caution observed: two medium WebGPU sessions loaded concurrently OOM'd the GPU
(test artifact — the app loads sequentially and releases, but don't run medium +
embedder + Demucs on WebGPU simultaneously).

**Still to confirm on the user's own hardware** (different GPU/VRAM than the
validated Apple Metal): that medium-q4 loads without OOM on their device, and
that the stranger-than-heaven accuracy win (line coverage 14→31) holds end-to-end
through the app's real auto-align flow (validated here only on the JFK clip, not
a full song). Medium inference at ~1.3× realtime (q4) extrapolates to ~5 min for
a 231s song — acceptable for an opt-in mode. If q4 ever OOMs on lower-VRAM
hardware, the ladder is q4 → small-on-WebGPU only.

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

## CRITICAL bug found + fixed via real-app validation on user's Mac (2026-07-10)

Driving the app's actual auto-align (not an isolated `pipeline()` call) surfaced a
real shipped bug the earlier checks missed:

> Speech model could not start (no available backend found. ERR: [webgpu]
> TypeError: error loading dynamically imported module:
> /onnx-wasm/ort-wasm-simd-threaded.jsep.mjs)

Root cause: the WebGPU onnxruntime backend dynamically imports
`ort-wasm-simd-threaded.jsep.mjs`, but `serveOnnxWasmFile` (dev/preview) and
`generateBundle` (production) in `vite.config.ts` filtered to `.wasm` ONLY — the
`.mjs` glue module was served/emitted nowhere. So WebGPU failed to initialize and
the app couldn't transcribe. (My isolated `pipeline()` tests missed this because
they used the CDN default wasmPaths, which serves every jsep file.)

Fix (`3fbdc93`): serve `.mjs` as `text/javascript` in dev/preview, and emit
`ort-wasm*.{wasm,mjs}` in the production bundle. Validated end-to-end: the app's
real `transcribeAudio` now loads whisper-small on WebGPU (~2.5s inference on the
JFK clip, correct output, NO WASM fallback), and `dist/onnx-wasm/` contains both
the `.wasm` and `.jsep.mjs`.

**Lesson:** the deferred "real-device" validation was essential and found TWO real
bugs the corpus/Node/isolated-browser checks could not — the medium fp16→q4
decoder garble AND this jsep `.mjs` serving gap. Both are user-facing (broken
transcription) and both are now fixed on this branch.

**Still to confirm by the user:** a full-song auto-align with "High accuracy" on
(medium-q4) end-to-end in the real app — the small-model WebGPU path is now
validated; medium-q4 uses the same (now-fixed) backend loading, so it should work,
but the 1.5GB download + full-song run wasn't completed in-session.

## CRITICAL: Whisper reverted to WASM — WebGPU long-form timestamps are broken (2026-07-11)

Real-app auto-align on the user's Mac produced **all-zero line timestamps** (aligner
"couldn't set proper timestamps"), even though transcription completed. Systematic
debugging (three refuted hypotheses, then reproduced) found the root cause:

**The onnxruntime WebGPU backend cannot produce correct long-form (>30s) Whisper
timestamps.** Validated on Apple Metal with a 60s clip:
- WASM / word: **186 correct per-word timestamps**, full 0–60s span.
- WebGPU / word: **1 garbage "word"** `[29.98, 69.98]` (collapsed).
- WebGPU / segment: 12 chunks but span truncated to 43s of 60 (last chunk null-end).

Word-level timestamps require cross-attention DTW that the WebGPU EP doesn't support
across the chunked long-form algorithm, so multi-chunk audio collapses to one useless
word — the aligner then has nothing to place lines against and every line lands at ~0.
The earlier "small on WebGPU works" validation was an 11s **single-chunk** clip, the
one case that works; every real song (>30s) was broken.

**Fix (`fdf276d`):** `whisperBackend()` forces Whisper transcription to WASM (correct
timestamps — the pre-migration behavior), replacing the WebGPU `resolveInferenceBackend`
+ `whisperDtype` path. The **embedder keeps WebGPU** (short texts, no timestamps).
Validated end-to-end: the app's real `transcribeAudio` now returns 186 word timestamps
over the full 60s and alignment yields non-zero line times.

**Implications:**
- The "WebGPU speed win for Whisper" is walked back — Whisper never actually worked on
  WebGPU for real songs. The v3 migration's real wins remain: v3 upgrade, embedder on
  WebGPU, and the WASM path is correct.
- The medium **q4-on-WebGPU** finding above is now moot for shipping (Whisper is WASM);
  q8 is used. medium high-accuracy still works on WASM (~2.5min segment, per the Node
  headroom runs), so the toggle stays.
- **Follow-up:** to reclaim WebGPU transcription speed, window audio into ≤30s chunks
  (single-chunk WebGPU word timestamps DO work) and stitch with offsets. Tracked in a
  TODO on `whisperBackend()`.

**Lesson reinforced:** on-device real-app validation found THREE user-facing bugs the
corpus/Node/isolated-browser checks could not (medium fp16→q4 garble, jsep .mjs serving
gap, and this WebGPU long-form timestamp collapse). Isolated `pipeline()` tests on short
clips gave false confidence; only driving the real multi-chunk pipeline exposed it.

## Chunked WebGPU transcription — BUILT, GATE FAILED, stays dormant (2026-07-11)

Attempted to reclaim WebGPU transcription speed via manual windowing: split audio
into 30s/5s-overlap windows (each a single-chunk call, where an 11s probe had
shown correct WebGPU word timestamps), stitch with offsets + midpoint dedup.
Shipped as a pure module (`src/ai-pipeline/whisperChunked.ts`, 9 unit tests incl.
a 270-duration coverage property test that caught a real dropped-audio bug in the
tail-merge rule) plus a dormant worker branch (`whisper.worker.ts`, taken only
when the requested device is webgpu).

**Validation gate on the real `transcribeAudio` path (60s clip): FAIL.**
- Word count 81 vs WASM's 186 (needed >=158).
- Timestamp span 70s on a 60s clip — a 10s window returned a word at t=20s
  INSIDE it, i.e. WebGPU word timestamps are unreliable even within single
  sub-30s windows, not just in the long-form merge. The earlier 11s single-chunk
  "works" probe was the lucky case.
- Speed ~50s vs WASM ~60-75s (~1.3x, needed >=2x).

Per the plan's FAIL path: `whisperBackend()` stays WASM (q8), the windowed path
stays dormant (tested, harmless), and the code comment on `whisperBackend` now
records the failure. Re-run the gate only on a newer onnxruntime/transformers.js.
Conclusion: WebGPU is simply not viable for Whisper timestamp extraction on the
current stack — WASM is correct and fast enough (small ~1min, medium ~2.5min per
song, segment mode).
