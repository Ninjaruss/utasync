import { describe, it, expect, vi } from 'vitest'
import { getDeviceTier, canUseVocalSeparation } from '../../src/ai-pipeline/capability'

describe('getDeviceTier', () => {
  it('returns full with WebGPU and 6+ GB', () => {
    vi.stubGlobal('navigator', { gpu: {}, deviceMemory: 8 })
    expect(getDeviceTier()).toBe('full')
  })
  it('returns lite with WebGPU and 4 GB', () => {
    vi.stubGlobal('navigator', { gpu: {}, deviceMemory: 4 })
    expect(getDeviceTier()).toBe('lite')
  })
  it('returns manual without WebGPU', () => {
    vi.stubGlobal('navigator', { gpu: undefined, deviceMemory: 8 })
    expect(getDeviceTier()).toBe('manual')
  })
})

describe('canUseVocalSeparation', () => {
  it('is only available on full tier', () => {
    expect(canUseVocalSeparation('full')).toBe(true)
    expect(canUseVocalSeparation('lite')).toBe(false)
    expect(canUseVocalSeparation('manual')).toBe(false)
  })
})
