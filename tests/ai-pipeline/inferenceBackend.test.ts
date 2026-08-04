import { describe, it, expect, vi } from 'vitest'
import { resolveInferenceBackend, canUseHighAccuracy, whisperBackend } from '../../src/ai-pipeline/inferenceBackend'

describe('resolveInferenceBackend', () => {
  it('uses webgpu + fp16 on full tier', () => {
    vi.stubGlobal('navigator', { gpu: {} })
    expect(resolveInferenceBackend('full')).toEqual({ device: 'webgpu', dtype: 'fp16' })
  })
  it('uses webgpu on lite tier (WebGPU present, less RAM)', () => {
    vi.stubGlobal('navigator', { gpu: {} })
    expect(resolveInferenceBackend('lite')).toEqual({ device: 'webgpu', dtype: 'fp16' })
  })
  // Lite no longer implies WebGPU: desktop-class machines on browsers without
  // it (Firefox forks on Linux) get the lite tier but must run on WASM.
  it('uses wasm on lite tier when the browser has no WebGPU', () => {
    vi.stubGlobal('navigator', { gpu: undefined })
    expect(resolveInferenceBackend('lite')).toEqual({ device: 'wasm', dtype: 'q8' })
  })
  it('falls back to wasm + q8 on manual tier', () => {
    vi.stubGlobal('navigator', { gpu: {} })
    expect(resolveInferenceBackend('manual')).toEqual({ device: 'wasm', dtype: 'q8' })
  })
})

describe('whisperBackend', () => {
  it('always runs Whisper on WASM (WebGPU produces broken long-form timestamps)', () => {
    expect(whisperBackend()).toEqual({ device: 'wasm', dtype: 'q8' })
  })
})

describe('canUseHighAccuracy', () => {
  it('true only on full tier', () => {
    expect(canUseHighAccuracy('full')).toBe(true)
    expect(canUseHighAccuracy('lite')).toBe(false)
    expect(canUseHighAccuracy('manual')).toBe(false)
  })
})
