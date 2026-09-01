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
    // Already-timed lyrics are USABLE AS-IS. They may be exact — a .lrc/.srt the
    // user had alongside their own audio — or a second or so out, as a fetched
    // LRCLIB entry typically is (measured: same master, median 0.24-0.73s after
    // one constant shift). We cannot tell which acoustically: two Whisper-free
    // estimators were measured and both missed by ~0.8s, because a densely-sung
    // track has vocal energy nearly everywhere, so the envelope knows THAT
    // someone is singing but never WHICH words.
    //
    // So do not demand anything. Play. If the lyrics turn out to be off, the
    // player offers a nudge — the user discovers that by listening, which is the
    // only reliable test available and the one they would apply anyway. Forcing
    // a drag on the exact case is friction that also invites damaging timings
    // that were already right.
    if (linesAreTimed(lines)) return null
    return manualAlignMode(tier)
  }

  if (linesAreTimed(lines)) return null
  if (canPlayback) return 'tap'
  return null
}
