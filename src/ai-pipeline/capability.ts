import type { DeviceTier } from '../core/types'

export function getDeviceTier(): DeviceTier {
  const gpu = !!(navigator as any).gpu
  const memory: number = (navigator as any).deviceMemory ?? 4
  if (gpu && memory >= 6) return 'full'
  if (gpu && memory >= 4) return 'lite'
  return 'manual'
}
