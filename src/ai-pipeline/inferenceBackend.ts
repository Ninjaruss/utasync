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

/** Whisper dtype override. whisper-medium in fp16 on WebGPU produces garbled,
 * truncated output — validated on Apple Metal: the larger decoder is numerically
 * unstable in fp16 (JFK clip decoded to "and so my fellow America and" then
 * stopped). q4 decodes it correctly AND ~3x faster (14s vs 45s on the same clip),
 * so high-accuracy (medium) uses q4 on WebGPU. whisper-small stays fp16 (validated
 * correct + fast); the WASM fallback stays q8. */
export function whisperDtype(backend: InferenceBackend, highAccuracy: boolean): Dtype {
  if (backend.device === 'webgpu' && highAccuracy) return 'q4'
  return backend.dtype
}

/** whisper-medium high-accuracy mode: full tier only (WebGPU + >=6GB RAM), matching
 * the vocal-separation gate — the ~1.5GB model needs the headroom. */
export function canUseHighAccuracy(tier: DeviceTier): boolean {
  return tier === 'full'
}
