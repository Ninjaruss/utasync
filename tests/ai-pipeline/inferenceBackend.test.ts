import { describe, it, expect } from 'vitest'
import { resolveInferenceBackend, canUseHighAccuracy, whisperDtype } from '../../src/ai-pipeline/inferenceBackend'

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

describe('whisperDtype', () => {
  it('uses q4 for high-accuracy (medium) on WebGPU — fp16 garbles the medium decoder', () => {
    expect(whisperDtype({ device: 'webgpu', dtype: 'fp16' }, true)).toBe('q4')
  })
  it('keeps fp16 for the default (small) model on WebGPU', () => {
    expect(whisperDtype({ device: 'webgpu', dtype: 'fp16' }, false)).toBe('fp16')
  })
  it('keeps the WASM dtype (q8) regardless of high-accuracy', () => {
    expect(whisperDtype({ device: 'wasm', dtype: 'q8' }, true)).toBe('q8')
    expect(whisperDtype({ device: 'wasm', dtype: 'q8' }, false)).toBe('q8')
  })
})

describe('canUseHighAccuracy', () => {
  it('true only on full tier', () => {
    expect(canUseHighAccuracy('full')).toBe(true)
    expect(canUseHighAccuracy('lite')).toBe(false)
    expect(canUseHighAccuracy('manual')).toBe(false)
  })
})
