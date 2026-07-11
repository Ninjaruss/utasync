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
