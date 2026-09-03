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

const WEBGPU_OFF_KEY = 'utasync:devWebGPUOff'

/**
 * Dev-only switch that makes the app behave as though the browser had no
 * WebGPU, so the WASM path — lite tier on a desktop, manual on a phone — can be
 * driven in a browser that does have it. Every machine within reach has a
 * WebGPU adapter, which is why this path had never been exercised live.
 *
 * Set with `?webgpu=off`, cleared with `?webgpu=on`. It persists in
 * sessionStorage so reloads and in-app navigation keep it.
 *
 * Production strips this: `import.meta.env.DEV` is statically false there, so
 * the whole body folds away. It is also inert in workers, which have no
 * sessionStorage — worker-side tier reads see the real hardware.
 *
 * Resolved once per page load and memoized, for the same reason the adapter
 * probe is: getDeviceTier() is called from render paths, and neither the URL
 * nor the hardware can change without a navigation. Without this, every one of
 * those calls pays a URL parse and two storage hits.
 */
let forcedOff: boolean | null = null

function webGPUForcedOff(): boolean {
  // `?.` because this module is also imported by the node-side audit scripts
  // (scripts/audit-corpus.mjs via wordAligner), where `import.meta.env` does
  // not exist at all and a bare property read throws. Vite still folds the
  // whole branch away in production — verified by scripts/bundle-syntax-floor
  // style inspection of the emitted chunk.
  if (!import.meta.env?.DEV) return false
  if (forcedOff === null) {
    try {
      const param = new URLSearchParams(location.search).get('webgpu')
      if (param === 'off') sessionStorage.setItem(WEBGPU_OFF_KEY, '1')
      else if (param === 'on') sessionStorage.removeItem(WEBGPU_OFF_KEY)
      forcedOff = sessionStorage.getItem(WEBGPU_OFF_KEY) === '1'
    } catch {
      forcedOff = false
    }
  }
  return forcedOff
}

/** Clears the memoized dev switch (tests). */
export function resetWebGPUOverride(): void {
  forcedOff = null
}

/** True when the browser exposes WebGPU (navigator.gpu). */
export function hasWebGPU(): boolean {
  if (webGPUForcedOff()) return false
  return !!(navigator as Navigator & { gpu?: unknown }).gpu
}

export function getDeviceTier(): DeviceTier {
  // navigator.gpu (WebGPU) and navigator.deviceMemory aren't in the base lib types.
  const nav = navigator as Navigator & { gpu?: unknown; deviceMemory?: number }
  const gpu = hasWebGPU() && !!nav.gpu
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
      if (!hasWebGPU()) return false
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
