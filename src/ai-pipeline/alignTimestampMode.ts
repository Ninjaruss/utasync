import type { DeviceTier } from '../core/types'

/** Word-level timestamp merge can stall for minutes on phones / long songs. */
export function preferredWhisperTimestampMode(tier: DeviceTier, durationSec: number): 'word' | 'segment' {
  if (tier === 'lite') return 'segment'
  if (durationSec > 180) return 'segment'
  return 'word'
}
