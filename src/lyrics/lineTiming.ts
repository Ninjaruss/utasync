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

/**
 * Whether a line carries real timing. Deliberately the same test the rest of the app uses to
 * answer "does this song have timing?" (SettingsView's songHasTiming, EditMode, bilingual.ts,
 * replaceLyricsLoss): an untimed line is exactly { startTime: 0, endTime: 0 } — what songBuilder
 * leaves after a fresh lyrics import and TapSyncEditor stores for every line the user did not tap.
 * A genuinely timed first line still counts, because its endTime is > 0.
 *
 * Defined here, in the leaf both the exporters and the playhead rules need, so there is one
 * definition rather than two that can drift.
 */
export function lineHasTiming(line: TimedLine): boolean {
  return line.startTime > 0 || line.endTime > 0
}

/** Effective end time for overlap checks (a line with a start but no end runs to the next line). */
export function lineEffectiveEnd(line: TimedLine, lineIndex: number, lines: TimedLine[]): number {
  // A line with NO timing at all has no span, so it never owns a moment of the song. This is the
  // fix for a real-browser finding (2026-09-30): falling through to the next line's start gave the
  // last such line the span [0, Infinity), and the app highlighted it — a fresh, unaligned import
  // showed the LAST lyric line glowing for the entire song, and a gap between tapped lines showed
  // an untimed line for the length of the gap. Measured before the fix: 86 of 86 samples in real
  // playback highlighted row 46 of 47 on a song where nothing is known about timing.
  //
  // Returning the line's own start makes the span empty ([start, start) contains nothing), which is
  // what "untimed" means. A timed first line that legitimately starts at 0 is untouched: its
  // endTime > 0, so lineHasTiming is true and the branches below run as before.
  if (!lineHasTiming(line)) return line.startTime
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
