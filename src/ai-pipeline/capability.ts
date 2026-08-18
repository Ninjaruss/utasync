import type { DeviceTier } from '../core/types'

/** Estimate RAM (GB) when navigator.deviceMemory is unavailable.
 * deviceMemory is a Chromium-only API — its absence means Firefox or Safari,
 * NOT a low-memory device. Pinning absent to 4GB permanently locked every
 * Firefox user out of the full tier (word timestamps, vocal separation,
 * whisper-medium). Use core count as a coarse desktop-class signal instead;
 * mobile browsers stay conservative. */
function isMobileBrowser(nav: Navigator & { userAgentData?: { mobile?: boolean } }): boolean {
  return nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobi/i.test(nav.userAgent ?? '')
}

function estimateDeviceMemory(nav: Navigator & { userAgentData?: { mobile?: boolean } }): number {
  if (isMobileBrowser(nav)) return 4
  const cores = nav.hardwareConcurrency ?? 4
  if (cores >= 8) return 8
  if (cores >= 4) return 6
  return 4
}

/** True when the browser exposes WebGPU (navigator.gpu). */
export function hasWebGPU(): boolean {
  return !!(navigator as Navigator & { gpu?: unknown }).gpu
}

export function getDeviceTier(): DeviceTier {
  // navigator.gpu (WebGPU) and navigator.deviceMemory aren't in the base lib types.
  const nav = navigator as Navigator & { gpu?: unknown; deviceMemory?: number }
  const gpu = !!nav.gpu
  const memory: number = nav.deviceMemory ?? estimateDeviceMemory(nav)
  if (gpu && memory >= 6) return 'full'
  if (gpu && memory >= 4) return 'lite'
  // No WebGPU is a browser property, not a hardware one (Firefox forks on
  // Linux/SteamOS, older Safari). Whisper transcribes on WASM regardless of
  // tier and the embedder falls back to WASM, so a desktop-class machine still
  // gets the lite pipeline. Mobile stays manual — WASM Whisper on a phone CPU
  // is too slow to offer honestly. Full (vocal separation, whisper-medium)
  // remains WebGPU-only.
  if (!isMobileBrowser(nav) && memory >= 6) return 'lite'
  return 'manual'
}

/** Vocal separation needs WebGPU + enough RAM for Demucs + Whisper. */
export function canUseVocalSeparation(tier: DeviceTier = getDeviceTier()): boolean {
  return tier === 'full'
}

type GpuLike = { requestAdapter?: () => Promise<unknown> }

let adapterProbe: Promise<boolean> | null = null

/**
 * True when a WebGPU **adapter** can actually be acquired.
 *
 * `hasWebGPU()` only reports that `navigator.gpu` exists, which is not the same
 * question: on Linux, on blocklisted GPUs, and in some worker contexts
 * `requestAdapter()` resolves null, onnxruntime falls back to WASM, and a
 * separation run that should take two minutes takes an hour.
 *
 * Caching rule: only a *definitive* answer is memoized for the session.
 * `gpu`/`requestAdapter` missing, or `requestAdapter()` resolving `null`, are
 * definitive — the browser is telling us there is no adapter, and hardware
 * cannot change mid-session. A *thrown* error is not definitive — it can come
 * from a transient condition (context already busy, momentary driver hiccup)
 * — so it resolves `false` for the caller but is never cached; the next call
 * re-probes from scratch.
 */
export function probeWebGPUAdapter(): Promise<boolean> {
  if (!adapterProbe) {
    adapterProbe = (async () => {
      const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu
      if (!gpu?.requestAdapter) return false
      try {
        return !!(await gpu.requestAdapter())
      } catch {
        adapterProbe = null
        return false
      }
    })()
  }
  return adapterProbe
}

/** Clears the memoized probe (tests). */
export function resetWebGPUAdapterProbe(): void {
  adapterProbe = null
}
