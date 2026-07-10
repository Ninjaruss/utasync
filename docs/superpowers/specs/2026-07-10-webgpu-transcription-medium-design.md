# WebGPU Transcription Migration + whisper-medium High-Accuracy Mode — Design Spec

**Date:** 2026-07-10
**Status:** Approved

## Goal

Make STRANGER-THAN-HEAVEN-class mixed-language (JA/EN) songs align well by
recovering more accurate transcripts. A headroom experiment (findings doc
§2026-07-10 addendum / this branch) proved the remaining alignment error on
such songs is largely transcript-limited: swapping whisper-small → whisper-medium
(segment mode) took evidence-backed line boundaries from 14 to 31 of 59 with
zero aligner changes. But whisper-medium is impractical under the app's current
WASM-only inference stack (`@xenova/transformers` v2). This work migrates
transcription to WebGPU inference and adds an opt-in high-accuracy mode.

## Background / current state

- Transcription and the word-pairing embedder both run on
  `@xenova/transformers` v2.17.2 — **WASM only**, no WebGPU device path.
  Used in: `src/ai-pipeline/whisperPipeline.ts`, `src/ai-pipeline/textEmbed.worker.ts`,
  and Node helpers `scripts/lib/nodeWhisper.mjs`, `scripts/lib/nodeEmbedder.mjs`.
- Demucs vocal separation already uses `onnxruntime-web` with
  `executionProviders: ['webgpu', 'wasm']` (`src/ai-pipeline/demucs.worker.ts`),
  so WebGPU is proven on the target (full-tier) devices.
- Device tier is classified in `src/ai-pipeline/capability.ts`
  (`getDeviceTier`: full = WebGPU + ≥6 GB RAM). `canUseVocalSeparation` already
  gates a heavy WebGPU feature on full tier.
- Whisper model is chosen in `src/ai-pipeline/models.ts` (`getWhisperModel`,
  currently always `Xenova/whisper-small`). Word-vs-segment mode is chosen in
  `src/ai-pipeline/alignTimestampMode.ts`.
- Playback highlighting is **line-level** (`lineIndexAtPlayhead`,
  `src/lyrics/lineTiming.ts`); there is no time-synced per-word karaoke. Word-mode
  Whisper timestamps feed only sung-reading verification (`readingReconciler`) and
  minor phrase-boundary refinement — nothing visual during playback.

## Non-goals

- Self-hosting the medium model (HF CDN is used for v1; see §4).
- Changing the reading/word-mode opt-in behavior (kept as-is).
- The two-pass forced-language JA+EN merge (a separate, complementary lever;
  not part of this spec).
- Per-word karaoke highlighting (does not exist; not added).

## Component 1 — Migrate to `@huggingface/transformers` v3

Replace `@xenova/transformers` v2 with `@huggingface/transformers` v3 in all four
usage sites; remove the v2 dependency. v3's `pipeline()` API is near-identical;
the additions are the `device` ('webgpu' | 'wasm') and `dtype` options and
possibly renamed model repo ids.

- New helper `resolveInferenceBackend(tier)` (e.g. in `src/ai-pipeline/capability.ts`
  or a new `inferenceBackend.ts`) returns `{ device: 'webgpu' | 'wasm', dtype }`
  from the device tier, so both workers share one policy. Runtime fallback: if
  WebGPU pipeline construction throws, retry with `device: 'wasm'` (mirrors the
  Demucs `['webgpu','wasm']` provider list).
- `env` config (`allowLocalModels = false`, `useBrowserCache = true`) maps
  directly to v3.
- Normalize v3 ASR output to the existing transcript shape (see §5) so no
  downstream consumer changes.
- The two Node helpers migrate too (v3 runs in Node), keeping the offline audit
  path working. `scripts/lib/nodeEmbedder.mjs` must still produce vectors
  compatible with the committed `embeddings-cache.json` (or the cache is
  regenerated — see §5).

## Component 2 — Model + device matrix

`getWhisperModel` / the transcription entry point select model and device from
tier + the high-accuracy flag:

| Device | Default | High-accuracy opt-in |
|---|---|---|
| No WebGPU (lite / WASM) | small / WASM (segment on >180s — unchanged) | not offered |
| WebGPU (full) | small / **WebGPU** | **medium / WebGPU, forced segment** |

- Small on WebGPU is the new default for full-tier devices (speed win; also
  removes the long-song word-mode merge stall that motivated the >180s segment
  fallback — revisit whether that fallback can relax, but keep it for WASM).
- WASM remains the automatic fallback wherever WebGPU is unavailable or fails.

## Component 3 — "High accuracy (slower)" opt-in

- A toggle in the auto-align flow (`src/ai-pipeline/AutoAlignFlow.tsx`),
  surfaced only when full-tier + WebGPU (a `canUseHighAccuracy(tier)` predicate
  alongside `canUseVocalSeparation`).
- Selecting it: model = `Xenova/whisper-medium` (or the v3 repo id), device =
  webgpu, `timestampMode` forced to `'segment'` (dodges medium's word-mode
  repetition-loop pathology observed in the experiment: needs_review 3→7 on
  stranger from "me"-loop hallucinations blanketing 120–196s).
- Copy states the ~1.5 GB one-time download, in the style of the existing
  vocal-separation gate. Model persists via browser Cache Storage after first
  download.

## Component 4 — Model hosting

Fetch from the HF CDN (`Xenova/whisper-medium`) via transformers.js, persisted by
browser Cache Storage — identical mechanism to the current small model.
Self-hosting on GitHub releases (the Demucs `models-v1` pattern) is the
documented fallback if HF reliability becomes an issue; out of scope for v1
because mirroring a multi-file model repo is more involved than Demucs's single
`.onnx` asset.

## Component 5 — Regression strategy (primary risk)

The v2→v3 swap can shift model output. Guards:

- **Whisper output shape**: normalize v3 ASR results to the existing
  `{ text, chunks: [{ text, timestamp: [start, end] }] }` (segment) / word-array
  shape in `whisperPipeline.ts` + `slimWhisperTranscript`. Downstream (aligner,
  reading, corpus) sees no change. Committed corpus transcripts are static data,
  so alignment/reading audits stay deterministic across the migration.
- **Embedder vectors**: v3 may produce slightly different embeddings. The pairing
  audit serves from `embeddings-cache.json` (model only on cache miss). Plan:
  regenerate the cache under v3, re-check `pair_wrong` / `pair_magnet` /
  `pair_unpaired` against `pairing-truth.json`, and re-tune `MATCH_THRESHOLD`
  (`src/ai-pipeline/wordAligner.ts`) only if the pairing metrics regress. If v3
  embeddings are effectively identical, no cache change.
- **`dtype` for medium** (fp16 vs q8/q4 on WebGPU) tuned during implementation
  against the corpus scorecard and a real in-browser run.

## Component 6 — Testing & the in-browser feasibility gate

- Corpus scorecard + baseline guard (`scripts/audit-corpus.mjs`,
  `tests/ai-pipeline/corpus-scorecard.test.ts`) are model-free and stay green
  throughout.
- Unit test for `resolveInferenceBackend` / `canUseHighAccuracy` tier logic.
- **In-browser feasibility gate**: a preview-tool browser smoke that loads
  whisper-medium on WebGPU and transcribes a short clip without OOM, capturing
  wall-clock. This is the deferred empirical validation, now an implementation
  gate: if medium cannot run acceptably in-browser on a WebGPU device, STOP and
  reassess before shipping the toggle (fail-fast, no dead UI). Small-on-WebGPU
  gets the same smoke to confirm the default-path speed win and output
  compatibility.
- Pairing CI guard (`tests/ai-pipeline/corpus-pairing.test.ts`) re-locked after
  any embedder cache regeneration.
- Existing full suite must stay green; the migration must not change the shape
  the aligner/reading/pairing layers consume.

## Error handling

- WebGPU pipeline construction failure → fall back to WASM small, surface the
  same "approximate / vocals hard to transcribe" messaging already used for
  low-confidence alignment; never hard-fail transcription.
- Medium model download failure (network) → fall back to small with a clear
  message, do not block the flow.
- Node scripts: if v3 model load fails, fail loudly (audit tooling, not user
  path).

## Rollout / sequencing note

The in-browser feasibility gate (§6) runs early in implementation. A LOSES
outcome there (medium impractical even on WebGPU) collapses the feature to
"small-on-WebGPU speed win + v3 migration" without the medium toggle — still a
net positive, and the honest fallback if the gate fails.
