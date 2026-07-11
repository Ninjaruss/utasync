import type { DeviceTier } from '../core/types'

export type Dtype = 'fp16' | 'q8' | 'q4'

export interface InferenceBackend {
  device: 'webgpu' | 'wasm'
  /** v3 dtype: fp16 for WebGPU, q8 for WASM (matches transformers.js defaults). */
  dtype: Dtype
}

/** WebGPU where the device has a GPU (lite/full tiers), WASM otherwise. Whisper
 * and the embedder share this policy; WASM stays the runtime fallback if a
 * WebGPU pipeline fails to construct (handled at the load site). */
export function resolveInferenceBackend(tier: DeviceTier): InferenceBackend {
  if (tier === 'full' || tier === 'lite') return { device: 'webgpu', dtype: 'fp16' }
  return { device: 'wasm', dtype: 'q8' }
}

/** Whisper transcription runs on WASM, NOT WebGPU — regardless of tier.
 *
 * The onnxruntime WebGPU backend cannot produce correct long-form (>30s) Whisper
 * timestamps: for multi-chunk audio, word mode collapses to a single garbage
 * "word" (validated on Apple Metal: a 60s clip → 1 chunk `[29.98, 69.98]` vs
 * WASM's 186 correct per-word timestamps), and segment mode truncates the span.
 * Without usable timestamps the aligner has nothing to place lines against, so
 * every line lands at ~0. WASM produces correct timestamps (the pre-migration
 * behavior). The WebGPU win is kept for the embedder (short texts, no timestamps).
 *
 * ATTEMPTED (2026-07-11) and rejected: manual <=30s windowing + stitch
 * (whisperChunked.ts, wired dormant in whisper.worker.ts) FAILED its validation
 * gate — WebGPU word timestamps are unreliable even within single sub-30s
 * windows (a 10s window returned a word at t=20s; 81 words vs WASM's 186 on the
 * same 60s clip) and the speed win was only ~1.3x, not the required 2x. The
 * windowed path stays dormant; do not flip this to webgpu without re-running the
 * gate in docs/superpowers/plans/2026-07-11-chunked-webgpu-whisper.md on a newer
 * onnxruntime/transformers.js. */
export function whisperBackend(): InferenceBackend {
  return { device: 'wasm', dtype: 'q8' }
}

/** whisper-medium high-accuracy mode: full tier only (WebGPU + >=6GB RAM), matching
 * the vocal-separation gate — the ~1.5GB model needs the headroom. */
export function canUseHighAccuracy(tier: DeviceTier): boolean {
  return tier === 'full'
}
