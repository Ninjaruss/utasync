import type { DeviceTier, TimedLine, TimedTranscriptWord } from '../core/types'

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

/** Number of merged segments to see before suggesting the word-level pass. */
const MERGED_SEGMENT_SUGGEST_THRESHOLD = 2

/** Count transcript chunks that span two or more lyric lines. Segment-mode Whisper
 * groups several sung lines into one chunk (e.g. 角を曲がって｜此処…); word mode does
 * not. A chunk is "merged" when ≥2 lines start within its [start, end) window. */
export function countMergedTranscriptSegments(
  lines: TimedLine[],
  transcriptWords: TimedTranscriptWord[],
): number {
  let merged = 0
  for (const w of transcriptWords) {
    let linesInChunk = 0
    for (const l of lines) {
      if (l.startTime >= w.startTime && l.startTime < w.endTime) linesInChunk++
      if (linesInChunk >= 2) break
    }
    if (linesInChunk >= 2) merged++
  }
  return merged
}

/** Whether to suggest re-running with the slower word-level pass: the segment
 * transcript grouped multiple lines into shared chunks (so per-line timing is
 * approximate) and the device can actually run word mode (full tier only). */
export function suggestsWordLevelAlignment(
  lines: TimedLine[],
  transcriptWords: TimedTranscriptWord[] | undefined,
  tier: DeviceTier,
): boolean {
  if (tier !== 'full' || !transcriptWords?.length) return false
  return countMergedTranscriptSegments(lines, transcriptWords) >= MERGED_SEGMENT_SUGGEST_THRESHOLD
}
