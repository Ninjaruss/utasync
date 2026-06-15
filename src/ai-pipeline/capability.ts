import type { DeviceTier } from '../core/types'

export function getDeviceTier(): DeviceTier {
  // navigator.gpu (WebGPU) and navigator.deviceMemory aren't in the base lib types.
  const nav = navigator as Navigator & { gpu?: unknown; deviceMemory?: number }
  const gpu = !!nav.gpu
  const memory: number = nav.deviceMemory ?? 4
  if (gpu && memory >= 6) return 'full'
  if (gpu && memory >= 4) return 'lite'
  return 'manual'
}
