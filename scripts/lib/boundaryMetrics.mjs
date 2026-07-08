/**
 * Boundary-accuracy metrics: do aligned line ends track the sung audio?
 * Inputs: lines (TimedLine[]), spans (LineMatchedSpan|null per line, from
 * computeLineMatchedSpans over SANITIZED words), words (sanitized transcript).
 * Only well-matched lines are scored; a line whose LCS span no longer overlaps
 * its own window (repeat-stanza retarget) is skipped, not penalized.
 */
export const EARLY_END_THRESHOLD_S = 0.35
export const OVERLAP_EPS_S = 0.05
export const MIN_SPAN_COVERAGE = 0.55
// Only a word this long can meaningfully "contain" a line boundary.
const MID_WORD_MIN_DURATION_S = 0.4
const MID_WORD_MARGIN_S = 0.15

function wellMatched(line, span) {
  if (!span || span.totalChars === 0) return false
  if (span.matchedChars / span.totalChars < MIN_SPAN_COVERAGE) return false
  return span.firstTime < line.endTime && span.lastEndTime > line.startTime
}

export function computeBoundaryMetrics(lines, spans, words, opts = {}) {
  const early = opts.earlyEndThresholdS ?? EARLY_END_THRESHOLD_S
  const eps = opts.overlapEpsS ?? OVERLAP_EPS_S
  const lastAudio = words.length ? words[words.length - 1].endTime : 0
  let measured = 0
  let earlyEnd = 0
  let lateEnd = 0
  let midWord = 0
  let beyondAudio = 0
  const gaps = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const span = spans[i]
    if (!wellMatched(line, span)) {
      if (!span && line.startTime >= lastAudio - 1) beyondAudio++
      continue
    }
    measured++
    if (span.lastEndTime - line.endTime > early) earlyEnd++
    for (const w of words) {
      if (w.endTime - w.startTime < MID_WORD_MIN_DURATION_S) continue
      if (
        line.endTime > w.startTime + MID_WORD_MARGIN_S &&
        line.endTime < w.endTime - MID_WORD_MARGIN_S
      ) {
        midWord++
        break
      }
    }
    const next = lines[i + 1]
    const nextSpan = spans[i + 1]
    if (next && wellMatched(next, nextSpan)) {
      if (line.endTime - nextSpan.firstTime > eps && nextSpan.firstTime >= span.firstTime) lateEnd++
      gaps.push(next.startTime - line.endTime)
    }
  }
  gaps.sort((a, b) => a - b)
  const pct = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] : 0)
  return {
    measured,
    earlyEnd,
    lateEnd,
    midWord,
    beyondAudio,
    gapP50: Number(pct(0.5).toFixed(2)),
    gapP95: Number(pct(0.95).toFixed(2)),
  }
}
