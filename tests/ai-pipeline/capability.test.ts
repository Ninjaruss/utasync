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

  // deviceMemory is Chromium-only: its absence means Firefox/Safari, not low RAM.
  it('estimates desktop-class memory from core count when deviceMemory is absent (Firefox)', () => {
    vi.stubGlobal('navigator', { gpu: {}, hardwareConcurrency: 10, userAgent: 'Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/141.0' })
    expect(getDeviceTier()).toBe('full')
  })
  it('gives 4-core desktops without deviceMemory the full tier (6GB estimate)', () => {
    vi.stubGlobal('navigator', { gpu: {}, hardwareConcurrency: 4, userAgent: 'Mozilla/5.0 (X11; Linux) Firefox/141.0' })
    expect(getDeviceTier()).toBe('full')
  })
  it('stays lite on low-core devices without deviceMemory', () => {
    vi.stubGlobal('navigator', { gpu: {}, hardwareConcurrency: 2, userAgent: 'Mozilla/5.0 (X11; Linux) Firefox/141.0' })
    expect(getDeviceTier()).toBe('lite')
  })
  it('stays conservative (lite) on mobile browsers without deviceMemory', () => {
    vi.stubGlobal('navigator', { gpu: {}, hardwareConcurrency: 8, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Safari/605.1' })
    expect(getDeviceTier()).toBe('lite')
  })
  it('respects userAgentData.mobile when present', () => {
    vi.stubGlobal('navigator', { gpu: {}, hardwareConcurrency: 8, userAgentData: { mobile: true }, userAgent: '' })
    expect(getDeviceTier()).toBe('lite')
  })
})

describe('canUseVocalSeparation', () => {
  it('is only available on full tier', () => {
    expect(canUseVocalSeparation('full')).toBe(true)
    expect(canUseVocalSeparation('lite')).toBe(false)
    expect(canUseVocalSeparation('manual')).toBe(false)
  })
})
