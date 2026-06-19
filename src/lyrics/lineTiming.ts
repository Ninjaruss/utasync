import type { TimedLine } from '../core/types'

/** Effective end time for overlap checks (untimed lines use the next line's start). */
export function lineEffectiveEnd(line: TimedLine, lineIndex: number, lines: TimedLine[]): number {
  if (line.endTime > line.startTime) return line.endTime
  const next = lines[lineIndex + 1]
  return next ? next.startTime : Infinity
}

/** Index of the lyric row containing `t`, or -1 when between / outside timed lines. */
export function lineIndexAtPlayhead(lines: TimedLine[], t: number): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startTime <= t && t < lineEffectiveEnd(line, i, lines)) return i
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
