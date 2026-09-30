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
    // Already-timed lyrics are accepted as-is: no transcription is run, and the
    // player simply plays them.
    //
    // THIS IS A TEMPORARY DEFAULT, NOT A DEFENSIBLE POLICY. The rationale that used
    // to sit here cited two measurements — an LRCLIB median error of "0.24-0.73s
    // after one constant shift", and two Whisper-free estimators that "both missed
    // by ~0.8s" — and neither has a source: no audit, plan, spec or test records
    // them, and `git log -S` finds no commit introducing the estimators. They are
    // logged as UNSOURCED in docs/superpowers/audits/2026-09-28-measurement-ledger.md
    // (L1, L2) and must not be cited to justify anything.
    //
    // Worse, the first figure would not support this policy even if it were right:
    // 0.3-0.7s of error is inside the band the app already treats as needing
    // correction (drag re-timing exists for it, and its measured target is a 0.82s
    // worst line). So "the timings are probably a bit out" is an argument FOR
    // verifying them, not against it.
    //
    // What still speaks for this behaviour is narrower and does hold: the app cannot
    // currently distinguish an exact .lrc the user supplied alongside their own audio
    // from a fetched catalogue entry, and the only estimator built so far is
    // unvalidated. Running full auto-align instead would be worse — it re-transcribes
    // (minutes) to possibly overwrite timings that were already right.
    //
    // The replacement is plan item W1.2: a CHEAP acoustic screen of claimed timings
    // (corroborated global-offset estimate, escalating only when inconclusive) that
    // can say "these are fine" or "these are off by ~0.4s" without a full run. Flip
    // this branch once that screen exists AND has been measured against committed
    // audio, not before.
    if (linesAreTimed(lines)) return null
    return manualAlignMode(tier)
  }

  if (linesAreTimed(lines)) return null
  if (canPlayback) return 'tap'
  return null
}
