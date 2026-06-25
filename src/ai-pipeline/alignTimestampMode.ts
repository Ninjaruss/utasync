import type { DeviceTier } from '../core/types'

export interface TimestampModeOptions {
  /** User opted into the slower word-level pass for verified readings (D2). */
  accurateReadings?: boolean
}

/** Word-level timestamps verify readings and refine phrase boundaries, but the
 * merge can stall for minutes on phones / long songs — so the default falls back
 * to segment timestamps there. The user can opt back into word mode for accuracy. */
export function preferredWhisperTimestampMode(
  tier: DeviceTier,
  durationSec: number,
  options?: TimestampModeOptions,
): 'word' | 'segment' {
  if (tier === 'lite') return 'segment'
  if (options?.accurateReadings) return 'word'
  if (durationSec > 180) return 'segment'
  return 'word'
}

/** Whether the "Accurate readings (slower)" opt-in is worth surfacing: only on full
 * tier for long songs, where the default would otherwise drop to segment mode. */
export function accurateReadingsAvailable(tier: DeviceTier, durationSec: number): boolean {
  return tier === 'full' && durationSec > 180
}

/** Rough extra-time estimate for the word-level pass, shown next to the opt-in.
 * Null when the slower pass would not actually run (already word mode, or unsupported tier). */
export function accurateReadingsEstimate(tier: DeviceTier, durationSec: number): string | null {
  if (!accurateReadingsAvailable(tier, durationSec)) return null
  return '~3–8 min'
}
