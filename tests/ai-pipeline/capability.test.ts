import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getDeviceTier, canUseVocalSeparation, probeWebGPUAdapter, resetWebGPUAdapterProbe } from '../../src/ai-pipeline/capability'

describe('getDeviceTier', () => {
  it('returns full with WebGPU and 6+ GB', () => {
    vi.stubGlobal('navigator', { gpu: {}, deviceMemory: 8 })
    expect(getDeviceTier()).toBe('full')
  })
  it('returns lite with WebGPU and 4 GB', () => {
    vi.stubGlobal('navigator', { gpu: {}, deviceMemory: 4 })
    expect(getDeviceTier()).toBe('lite')
  })
  // No WebGPU no longer means no AI: Whisper transcribes on WASM regardless of
  // tier and the embedder falls back to WASM, so a desktop-class machine still
  // runs the lite pipeline. Full (vocal separation, whisper-medium) stays
  // WebGPU-only.
  it('returns lite (not full) without WebGPU on a desktop-class machine', () => {
    vi.stubGlobal('navigator', { gpu: undefined, deviceMemory: 8, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0' })
    expect(getDeviceTier()).toBe('lite')
  })
  it('returns lite without WebGPU on a multi-core desktop with no deviceMemory (Firefox forks, e.g. Zen on SteamOS)', () => {
    vi.stubGlobal('navigator', { gpu: undefined, hardwareConcurrency: 8, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0' })
    expect(getDeviceTier()).toBe('lite')
  })
  it('stays manual without WebGPU on low-memory devices', () => {
    vi.stubGlobal('navigator', { gpu: undefined, deviceMemory: 4, userAgent: 'Mozilla/5.0 (X11; Linux) Chrome/126.0' })
    expect(getDeviceTier()).toBe('manual')
  })
  it('stays manual without WebGPU on mobile (WASM whisper is too slow on phone CPUs)', () => {
    vi.stubGlobal('navigator', { gpu: undefined, deviceMemory: 8, hardwareConcurrency: 8, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1' })
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

describe('probeWebGPUAdapter', () => {
  beforeEach(() => resetWebGPUAdapterProbe())

  it('is true when an adapter is actually granted', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } })
    expect(await probeWebGPUAdapter()).toBe(true)
  })

  // The false positive this function exists to catch: navigator.gpu is present,
  // but no adapter is available, so ORT silently drops to WASM.
  it('is false when navigator.gpu exists but grants no adapter', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } })
    expect(await probeWebGPUAdapter()).toBe(false)
  })

  it('is false when requestAdapter throws', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => { throw new Error('no gpu') } } })
    expect(await probeWebGPUAdapter()).toBe(false)
  })

  it('is false when there is no WebGPU at all', async () => {
    vi.stubGlobal('navigator', {})
    expect(await probeWebGPUAdapter()).toBe(false)
  })

  it('memoizes — the answer cannot change within a session', async () => {
    let calls = 0
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => { calls++; return {} } } })
    await probeWebGPUAdapter()
    await probeWebGPUAdapter()
    expect(calls).toBe(1)
  })
})
