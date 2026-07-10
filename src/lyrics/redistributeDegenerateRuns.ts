import type { Language, TimedLine } from '../core/types'
import { sanitizeTranscript, type TranscriptWord } from '../ai-pipeline/aligner'
import { scoreLineAlignment } from '../ai-pipeline/contentAligner'
import {
  transcriptWindowForLine,
  LINE_VALIDATE_WINDOW_LEAD_S,
  LINE_VALIDATE_WINDOW_TAIL_S,
} from './phraseAlignment'
import { expectedLineDuration, minLineDuration, findActivityRegions, type ActivityRegion } from './lineDegeneracy'

/** Consecutive starts closer than this are a pileup. */
const PILEUP_GAP_S = 0.4
/** A span under this fraction of the per-text floor is compressed. */
const COMPRESSION_FRACTION = 0.55
/** A span over max(18s, 2.5× expected) is an absorption. */
const ABSORPTION_FACTOR = 2.5
const ABSORPTION_MIN_S = 18
/** Redistributed lines never stretch beyond 1.5× their expected duration. */
const MAX_STRETCH = 1.5

export interface RedistributionResult {
  lines: TimedLine[]
  /** True where the pass re-timed the line. */
  redistributed: boolean[]
  /** True where the re-timed span overlaps transcript activity. */
  onActivity: boolean[]
}

function lineTextOf(l: TimedLine): string {
  return l.original || l.translation
}

function runIsDegenerate(
  lines: TimedLine[],
  from: number,
  to: number,
  sourceLanguage: Language,
): boolean {
  for (let k = from; k <= to; k++) {
    const text = lineTextOf(lines[k])
    if (!text.trim()) continue
    const dur = lines[k].endTime - lines[k].startTime
    if (dur < minLineDuration(text) * COMPRESSION_FRACTION) return true
    const ceiling = Math.max(ABSORPTION_MIN_S, expectedLineDuration(text, sourceLanguage) * ABSORPTION_FACTOR)
    if (dur > ceiling) return true
    if (k > from && lines[k].startTime - lines[k - 1].startTime < PILEUP_GAP_S) return true
  }
  return false
}

/**
 * Final graceful-degradation tuner. Whisper can miss whole sections (misheard
 * vocals, overlapping vocalists, effects), leaving runs of unanchorable lines
 * that the earlier passes cram into a point (pileup), squeeze to slivers
 * (compression), or stretch across an instrumental (absorption). Re-time each
 * degenerate run across the transcript activity between its anchored
 * neighbours, proportional to each line's expected sung duration; instrumental
 * gaps (>4s without words) are never claimed. Anchored ('good') lines are
 * never moved.
 */
export function redistributeDegenerateRuns(
  linesIn: TimedLine[],
  words: TranscriptWord[],
  sourceLanguage: Language,
): RedistributionResult {
  const lines = linesIn.map((l) => ({ ...l }))
  const redistributed = lines.map(() => false)
  const onActivity = lines.map(() => false)
  const clean = sanitizeTranscript(words)
  if (clean.length === 0 || lines.length === 0) return { lines, redistributed, onActivity }
  const lastTime = clean[clean.length - 1].endTime

  const anchored = lines.map((l, i) => {
    const text = lineTextOf(l)
    if (!text.trim()) return true // blank rows are never redistributed
    const prevEnd = i > 0 ? lines[i - 1].endTime : 0
    const nextStart = i + 1 < lines.length ? lines[i + 1].startTime : lastTime
    const windowWords = transcriptWindowForLine(
      clean, l, prevEnd, nextStart, lastTime,
      LINE_VALIDATE_WINDOW_LEAD_S, LINE_VALIDATE_WINDOW_TAIL_S,
    )
    return scoreLineAlignment(text, windowWords, sourceLanguage).quality === 'good'
  })

  let i = 0
  while (i < lines.length) {
    if (anchored[i]) { i++; continue }
    let j = i
    while (j + 1 < lines.length && !anchored[j + 1]) j++
    redistributeRun(lines, i, j, clean, sourceLanguage, lastTime, redistributed, onActivity)
    i = j + 1
  }
  return { lines, redistributed, onActivity }
}

function redistributeRun(
  lines: TimedLine[],
  from: number,
  to: number,
  clean: TranscriptWord[],
  sourceLanguage: Language,
  lastTime: number,
  redistributed: boolean[],
  onActivity: boolean[],
): void {
  if (!runIsDegenerate(lines, from, to, sourceLanguage)) return
  const windowStart = from > 0 ? lines[from - 1].endTime : 0
  const windowEnd = to + 1 < lines.length ? lines[to + 1].startTime : lastTime
  if (windowEnd - windowStart < 0.5) return

  const weights: number[] = []
  for (let k = from; k <= to; k++) {
    weights.push(expectedLineDuration(lineTextOf(lines[k]), sourceLanguage))
  }
  const totalExpected = weights.reduce((a, b) => a + b, 0)
  const regions = findActivityRegions(clean, windowStart, windowEnd)

  if (regions.length === 0) {
    const scale = Math.min(MAX_STRETCH, (windowEnd - windowStart) / totalExpected)
    let cursor = windowStart
    for (let k = from; k <= to; k++) {
      const dur = weights[k - from] * scale
      lines[k].startTime = cursor
      lines[k].endTime = Math.min(windowEnd, cursor + dur)
      cursor = lines[k].endTime
      redistributed[k] = true
      onActivity[k] = false
    }
    return
  }

  const capacity = regions.reduce((a, r) => a + (r.end - r.start), 0)
  const scale = Math.min(MAX_STRETCH, capacity / totalExpected)

  // Pack lines into the activity regions, keeping each line wholly inside one
  // region so it never straddles (and thus "claims") an instrumental gap. A
  // line takes its scaled expected duration; if that doesn't fit in the room
  // left in the current region, we advance to the next region rather than
  // clamp the line to a sub-minLineDuration sliver at the boundary. The unspent
  // tail of a region is simply left as an unclaimed rest. Only when a line
  // cannot fit even at the start of a fresh region (its share exceeds a whole
  // region) do we clamp it to that region's end — a genuine capacity limit.
  let ri = 0
  let cursor = regions[0].start
  for (let k = from; k <= to; k++) {
    const dur = weights[k - from] * scale
    // Advance to a region with room for this line (or the last region).
    while (ri < regions.length - 1 && regions[ri].end - cursor < dur) {
      ri++
      cursor = regions[ri].start
    }
    const start = cursor
    const end = Math.min(regions[ri].end, cursor + dur)
    lines[k].startTime = start
    lines[k].endTime = Math.max(end, start)
    cursor = lines[k].endTime
    redistributed[k] = true
    onActivity[k] = clean.some((w) => w.startTime < lines[k].endTime && w.endTime > lines[k].startTime)
  }
}
