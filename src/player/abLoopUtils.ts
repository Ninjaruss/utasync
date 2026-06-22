import type { ABLoop, ABLoopPlaylistEntry, TimedLine } from '../core/types'
import { linePlaybackStart, lineOverlapsABLoop } from '../lyrics/lineTiming'

export { lineOverlapsABLoop }

/** True when both endpoints are set and B is strictly after A. */
export function isValidABPair(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && a < b
}

export function isABLoopActive(loop: ABLoop): boolean {
  return isValidABPair(loop.a, loop.b)
}

/** User-facing hint when both points are set but cannot loop. */
export function abPairError(a: number | null, b: number | null): string | null {
  if (a === null || b === null) return null
  if (a >= b) return 'Point B must be after point A'
  return null
}

/**
 * Maps a lyric-line tap to an A/B loop timestamp. A always uses the line
 * start. B uses the line end when A already falls on that line so a single
 * line can loop; otherwise B uses the next line's start (line boundary).
 */
export function abEndpointFromLine(
  which: 'a' | 'b',
  line: TimedLine,
  a: number | null,
): number {
  const start = line.startTime
  const playbackStart = linePlaybackStart(line)
  if (which === 'a') return playbackStart

  const { endTime: end } = line
  const hasValidEnd = end > start

  if (a !== null && hasValidEnd) {
    if (a === playbackStart || a === start || (a >= playbackStart && a < end)) return end
  }

  return start
}

/**
 * Partial A/B loop update from a lyric tap while arming. Handles B-first
 * same-line loops: when B was placed at the line start, setting A promotes B
 * to the line end so the pair stays valid.
 */
export function abLoopPatchFromLineTap(
  which: 'a' | 'b',
  line: TimedLine,
  loop: { a: number | null; b: number | null },
): Partial<{ a: number; b: number }> {
  const { startTime: start, endTime: end } = line
  const hasValidEnd = end > start

  if (which === 'a') {
    const a = linePlaybackStart(line)
    if (loop.b !== null && hasValidEnd && loop.b === start) {
      return { a, b: end }
    }
    return { a }
  }

  return { b: abEndpointFromLine('b', line, loop.a) }
}

export type LyricLoopHighlight = 'ab' | 'playlist' | 'playlist-current'

/** Which loop highlight (if any) applies to a lyric row in play mode. */
export function lyricLoopHighlight(
  line: TimedLine,
  lineIndex: number,
  lines: TimedLine[],
  abLoop: { a: number | null; b: number | null },
  abLoopActive: boolean,
  playlistActive: boolean,
  playlistEntries: ABLoopPlaylistEntry[],
  playlistIndex: number,
): LyricLoopHighlight | null {
  if (playlistActive && playlistEntries.length > 0) {
    let inSaved = false
    for (let i = 0; i < playlistEntries.length; i++) {
      const { a, b } = playlistEntries[i]
      if (!lineOverlapsABLoop(line, lineIndex, lines, a, b)) continue
      if (i === playlistIndex) return 'playlist-current'
      inSaved = true
    }
    return inSaved ? 'playlist' : null
  }
  if (
    abLoopActive
    && abLoop.a !== null
    && abLoop.b !== null
    && lineOverlapsABLoop(line, lineIndex, lines, abLoop.a, abLoop.b)
  ) {
    return 'ab'
  }
  return null
}
