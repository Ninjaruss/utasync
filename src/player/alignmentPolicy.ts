// src/player/alignmentPolicy.ts
//
// Re-alignment entry point: Edit mode → Auto-align (confirm dialog). Play mode
// intentionally has no re-align control — timing changes are destructive and
// belong in the edit context alongside lyric edits.
import type { TimedLine, DeviceTier, AlignmentMode } from '../core/types'

export type AlignMode = 'auto' | 'tap' | 'offset'

export function linesAreTimed(lines: TimedLine[]): boolean {
  return lines.some((l) => l.endTime > 0)
}

export function manualAlignMode(tier: DeviceTier): AlignMode {
  return tier === 'manual' ? 'tap' : 'auto'
}

// Decides whether the player must run alignment automatically on load.
export function chooseAutoAlignment(
  hasStoredAudio: boolean,
  lines: TimedLine[],
  tier: DeviceTier,
  canPlayback = hasStoredAudio,
  alignmentMode: AlignmentMode = 'manual',
): AlignMode | null {
  if (lines.length === 0) return null
  if (hasStoredAudio) {
    if (alignmentMode === 'auto') return null
    // Imported timestamps are NOT simply "for another master". Measured against
    // human truth, a found LRCLIB entry describes the local recording to within a
    // median 0.24-0.73s once ONE constant offset is removed
    // (tests/ai-pipeline/lrc-truth.test.ts) — same master, shifted by about a
    // second. So when the lines are already timed, the song does not need a full
    // transcription; it needs that single constant.
    //
    // We cannot find the constant acoustically: estimating it from the first
    // vocal onset, and by sliding every line start against the vocal-activity
    // envelope, both failed (errors of 0.79s and 0.86s against a known 1.26s,
    // with a flat correlation peak). A densely-sung track has vocal energy almost
    // everywhere, so the envelope knows THAT someone is singing, never WHICH
    // words — and the offset is a which-words question. The user can answer it in
    // one drag, hearing the result as they go.
    if (linesAreTimed(lines)) return 'offset'
    return manualAlignMode(tier)
  }
  if (linesAreTimed(lines)) return null
  if (canPlayback) return 'tap'
  return null
}
