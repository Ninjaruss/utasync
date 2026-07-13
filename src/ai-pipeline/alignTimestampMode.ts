import type { DeviceTier, TimedLine, TimedTranscriptWord } from '../core/types'

export interface TimestampModeOptions {
  /** User opted into the slower word-level pass for verified readings (D2). */
  accurateReadings?: boolean
}

/** Word-level timestamps verify readings and refine phrase boundaries, but the
 * merge can stall for minutes on phones / long songs — so the default falls back
 * to segment timestamps there. The user can opt back into word mode for accuracy:
 * the opt-in is honored on lite tier too (a lite device is often just a browser
 * without deviceMemory, not a phone), so lite users aren't permanently locked to
 * the coarser segment boundaries. */
export function preferredWhisperTimestampMode(
  tier: DeviceTier,
  durationSec: number,
  options?: TimestampModeOptions,
): 'word' | 'segment' {
  if (options?.accurateReadings && tier !== 'manual') return 'word'
  if (tier === 'lite') return 'segment'
  if (durationSec > 180) return 'segment'
  return 'word'
}

/** Whether the "Accurate readings (slower)" opt-in is worth surfacing: whenever the
 * default would otherwise use segment mode — full tier on long songs, lite tier on
 * any song (lite defaults to segment across the board). */
export function accurateReadingsAvailable(tier: DeviceTier, durationSec: number): boolean {
  if (tier === 'full') return durationSec > 180
  return tier === 'lite'
}

/** Rough extra-time estimate for the word-level pass, shown next to the opt-in.
 * Null when the slower pass would not actually run (already word mode, or unsupported tier). */
export function accurateReadingsEstimate(tier: DeviceTier, durationSec: number): string | null {
  if (!accurateReadingsAvailable(tier, durationSec)) return null
  return '~3–8 min'
}

/** Number of merged segments to see before suggesting the word-level pass. */
const MERGED_SEGMENT_SUGGEST_THRESHOLD = 2

/** Contiguous line-index runs that share one long transcript chunk (segment mode).
 * A line belongs to a chunk when its timing OVERLAPS the chunk by a meaningful
 * amount — not only when its start falls inside.  This catches tail-straddling
 * chunks where a previous line's closing syllables share the chunk with the next
 * line (…わからないんだ｜ローリング), which a start-only test would miss. */
export function findMergedLineGroups(
  lines: TimedLine[],
  transcriptWords: readonly { startTime: number; endTime: number }[],
): number[][] {
  const groups: number[][] = []
  const used = new Set<number>()
  for (const w of transcriptWords) {
    if (w.endTime - w.startTime < 1.8) continue
    const hits: number[] = []
    for (let i = 0; i < lines.length; i++) {
      const overlap = Math.min(lines[i].endTime, w.endTime) - Math.max(lines[i].startTime, w.startTime)
      if (overlap > 0.3) hits.push(i)
    }
    if (hits.length < 2) continue
    const lo = Math.min(...hits)
    const hi = Math.max(...hits)
    const run: number[] = []
    for (let i = lo; i <= hi; i++) {
      if (hits.includes(i) && !used.has(i)) run.push(i)
    }
    if (run.length >= 2) {
      groups.push(run)
      for (const i of run) used.add(i)
    }
  }
  return groups
}

/** True when consecutive rows in a group share one vocal run (not a segment boundary artifact). */
export function mergedGroupNeedsRealign(
  lines: TimedLine[],
  group: readonly number[],
): boolean {
  if (group.length < 2) return false
  for (let k = 0; k < group.length - 1; k++) {
    const gap = lines[group[k + 1]].startTime - lines[group[k]].endTime
    const short = lines[group[k]].endTime - lines[group[k]].startTime < 1.2
    if (gap < 1.5 || short) return true
  }
  return false
}

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
 * approximate) and the device can actually run word mode (full or lite tier —
 * the opt-in is honored on lite too). */
export function suggestsWordLevelAlignment(
  lines: TimedLine[],
  transcriptWords: TimedTranscriptWord[] | undefined,
  tier: DeviceTier,
): boolean {
  if (tier === 'manual' || !transcriptWords?.length) return false
  return countMergedTranscriptSegments(lines, transcriptWords) >= MERGED_SEGMENT_SUGGEST_THRESHOLD
}
