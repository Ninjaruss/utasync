import type { TimedLine } from '../core/types'

/**
 * Lead time before the stored line start for playback, highlighting, and A/B
 * loop jumps. LRC/Whisper timestamps often land on the first sung syllable
 * rather than the vocal onset, so replaying from raw startTime skips the
 * opening word or two.
 */
export const VOCAL_ONSET_LEAD_S = 0.18

/** Seek/highlight time for a line — slightly before its stored start. */
export function linePlaybackStart(line: TimedLine, lead = VOCAL_ONSET_LEAD_S): number {
  return Math.max(0, line.startTime - lead)
}

/** Effective end time for overlap checks (untimed lines use the next line's start). */
export function lineEffectiveEnd(line: TimedLine, lineIndex: number, lines: TimedLine[]): number {
  if (line.endTime > line.startTime) return line.endTime
  const next = lines[lineIndex + 1]
  return next ? next.startTime : Infinity
}

/** Index of the lyric row containing `t`, or -1 when between / outside timed lines. */
export function lineIndexAtPlayhead(lines: TimedLine[], t: number, lead = VOCAL_ONSET_LEAD_S): number {
  const adjusted = t + lead
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startTime <= adjusted && adjusted < lineEffectiveEnd(line, i, lines)) return i
  }
  return -1
}

/** True when a lyric line overlaps the [a, b) loop window. */
export function lineOverlapsABLoop(
  line: TimedLine,
  lineIndex: number,
  lines: TimedLine[],
  a: number,
  b: number,
): boolean {
  const end = lineEffectiveEnd(line, lineIndex, lines)
  return line.startTime < b && end > a
}
