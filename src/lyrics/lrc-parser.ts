import type { TimedLine } from '../core/types'

/**
 * The numeric shape here must stay in step with `LEADING_LRC_TAGS_RE` in
 * lyricCleanup.ts, which decides what counts as a strippable LRC tag. When the
 * two disagreed, a paste like `[0:05.00]` (single-digit minutes) or `[0:05]`
 * (no fraction) was stripped as a tag by the cleanup path but NOT detected as
 * LRC here — so `linesFromPaste` fell back to plain text and the user's timings
 * were silently thrown away.
 */
const TIMESTAMP_RE = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/
const METADATA_RE = /^\[(?:ti|ar|al|by|re|ve):/i
const OFFSET_RE = /^\[offset:\s*([+-]?\d+)\]/i

function parseTimestamp(line: string): { time: number; text: string } | null {
  const match = line.match(TIMESTAMP_RE)
  if (!match) return null
  const minutes = parseInt(match[1])
  const seconds = parseInt(match[2])
  // The fraction is optional; its digit count sets the scale (1 = tenths,
  // 2 = hundredths, 3 = milliseconds).
  const frac = match[3]
  const fraction = frac ? parseInt(frac) / 10 ** frac.length : 0
  const time = minutes * 60 + seconds + fraction
  const text = line.slice(match[0].length).trim()
  return { time, text }
}

export function parseLRC(lrc: string): TimedLine[] {
  const lines: Array<{ startTime: number; text: string }> = []
  let offsetSec = 0

  for (const raw of lrc.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const offsetMatch = trimmed.match(OFFSET_RE)
    if (offsetMatch) {
      offsetSec = parseInt(offsetMatch[1], 10) / 1000
      continue
    }
    if (METADATA_RE.test(trimmed)) continue
    const parsed = parseTimestamp(trimmed)
    if (parsed) lines.push({ startTime: Math.max(0, parsed.time + offsetSec), text: parsed.text })
  }

  lines.sort((a, b) => a.startTime - b.startTime)

  return lines.map((line, i): TimedLine => ({
    startTime: line.startTime,
    endTime: lines[i + 1]?.startTime ?? line.startTime + 5,
    original: line.text,
    translation: '',
  }))
}

/**
 * True when the text looks like a timed LRC: at least two lines begin with a
 * valid [mm:ss.xx] time tag. Reuses TIMESTAMP_RE so detection and parseLRC can
 * never disagree. The >=2 threshold avoids false-triggering on a single stray
 * bracketed timecode inside otherwise plain lyrics.
 */
export function hasLrcTimestamps(text: string): boolean {
  let count = 0
  for (const raw of text.split('\n')) {
    if (TIMESTAMP_RE.test(raw.trim())) {
      count += 1
      if (count >= 2) return true
    }
  }
  return false
}

export function parseLRCPair(originalLRC: string, translationLRC: string): TimedLine[] {
  const origLines = parseLRC(originalLRC)
  const transLines = parseLRC(translationLRC)

  return origLines.map((line, i): TimedLine => ({
    ...line,
    translation: transLines[i]?.original ?? '',
  }))
}
