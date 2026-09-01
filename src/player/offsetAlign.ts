import type { TimedLine } from '../core/types'

/**
 * The constant that reconciles an imported LRC with the local recording.
 *
 * A found LRCLIB entry is not "for another master" in any deep sense: measured
 * against human truth it describes the local audio to within a median 0.24-0.73s
 * once ONE constant offset is removed (tests/ai-pipeline/lrc-truth.test.ts). The
 * constant cannot be recovered acoustically — estimating it from the first vocal
 * onset, and by sliding every line start against the vocal-activity envelope,
 * both missed by ~0.8s against a known 1.26s, because a densely-sung track has
 * vocal energy nearly everywhere. The user supplies it in one drag instead.
 */

/** How far the user moved `lineIndex` from where it currently sits. */
export function offsetForLine(lines: TimedLine[], lineIndex: number, droppedAtSec: number): number {
  const line = lines[lineIndex]
  if (!line) return 0
  return droppedAtSec - line.startTime
}

/**
 * Shift every line by the same delta, clamped so nothing lands before the file
 * starts. An `endTime` of 0 means "unknown", not "zero seconds", so it is left
 * alone rather than shifted into a real-looking time.
 */
export function shiftLinesBy(lines: TimedLine[], deltaSec: number): TimedLine[] {
  if (deltaSec === 0) return lines.map((l) => ({ ...l }))
  return lines.map((l) => ({
    ...l,
    startTime: Math.max(0, l.startTime + deltaSec),
    endTime: l.endTime > 0 ? Math.max(0, l.endTime + deltaSec) : l.endTime,
  }))
}
