import type { DeviceTier } from '../core/types'

/** Estimate RAM (GB) when navigator.deviceMemory is unavailable.
 * deviceMemory is a Chromium-only API — its absence means Firefox or Safari,
 * NOT a low-memory device. Pinning absent to 4GB permanently locked every
 * Firefox user out of the full tier (word timestamps, vocal separation,
 * whisper-medium). Use core count as a coarse desktop-class signal instead;
 * mobile browsers stay conservative. */
function estimateDeviceMemory(nav: Navigator & { userAgentData?: { mobile?: boolean } }): number {
  const mobile = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobi/i.test(nav.userAgent ?? '')
  if (mobile) return 4
  const cores = nav.hardwareConcurrency ?? 4
  if (cores >= 8) return 8
  if (cores >= 4) return 6
  return 4
}

export function getDeviceTier(): DeviceTier {
  // navigator.gpu (WebGPU) and navigator.deviceMemory aren't in the base lib types.
  const nav = navigator as Navigator & { gpu?: unknown; deviceMemory?: number }
  const gpu = !!nav.gpu
  const memory: number = nav.deviceMemory ?? estimateDeviceMemory(nav)
  if (gpu && memory >= 6) return 'full'
  if (gpu && memory >= 4) return 'lite'
  return 'manual'
}

/** Vocal separation needs WebGPU + enough RAM for Demucs + Whisper. */
export function canUseVocalSeparation(tier: DeviceTier = getDeviceTier()): boolean {
  return tier === 'full'
}
