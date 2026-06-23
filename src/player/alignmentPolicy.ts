// src/player/alignmentPolicy.ts
//
// Re-alignment entry point: Edit mode → Auto-align (confirm dialog). Play mode
// intentionally has no re-align control — timing changes are destructive and
// belong in the edit context alongside lyric edits.
import type { TimedLine, DeviceTier, AlignmentMode } from '../core/types'

export type AlignMode = 'auto' | 'tap'

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
    // Imported LRCLIB/YouTube timestamps are for another master — align once to local audio.
    if (alignmentMode === 'auto') return null
    return manualAlignMode(tier)
  }
  if (linesAreTimed(lines)) return null
  if (canPlayback) return 'tap'
  return null
}
