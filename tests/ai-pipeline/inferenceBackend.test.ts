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
