import type { AlignmentLanguage, LineAlignmentQuality, TimedLine } from '../core/types'
import { lineWeight, type TranscriptWord } from '../ai-pipeline/aligner'
import { normalizeForMatch } from '../ai-pipeline/contentAligner'

const JA_SCRIPT_RE = /[぀-ヿ㐀-鿿]/

/** Rough duration a line should take to sing. `lineWeight` counts JA characters
 * (≈ morae) or EN words, which sing at very different rates — ~0.25s per JA
 * char, ~0.4s per EN word. Clamped: no line plausibly sings under 0.8s or over 12s. */
export function expectedLineDuration(text: string, sourceLanguage: AlignmentLanguage): number {
  const weight = Math.max(1, lineWeight(text, sourceLanguage))
  const unit = JA_SCRIPT_RE.test(text) ? 0.25 : 0.4
  return Math.min(12, Math.max(0.8, weight * unit))
}

/** Lower bound on a plausible sung span (mirrors phraseAlignment's minSungSpan). */
export function minLineDuration(text: string): number {
  const glyphs = normalizeForMatch(text).length
  return Math.max(0.8, Math.min(4.5, glyphs * 0.14))
}

/** A span under this fraction of the per-text floor is compressed. Shared by
 * degeneracy detection, the packer's region-edge clamp bound, the
 * needs_review → approximate upgrade gate, and the off-timing banner. */
export const COMPRESSION_FRACTION = 0.55

/**
 * Lines the "N line(s) off-timing" banner owns: every needs_review line, plus
 * any approximate line squashed below the compression threshold of its
 * per-text floor — a visibly-squashed span is mistimed no matter which chip it
 * wears. After the packing floors (round 6 B) and the coverage-gated upgrade
 * (round 6 C) the second set is structurally near-empty; counting it keeps the
 * banner honest should either invariant regress.
 */
export function offTimingLineCount(
  lines: readonly TimedLine[],
  lineAlignmentQuality: readonly LineAlignmentQuality[],
): number {
  let count = 0
  for (let i = 0; i < lineAlignmentQuality.length; i++) {
    const quality = lineAlignmentQuality[i]
    if (quality === 'needs_review') {
      count++
      continue
    }
    if (quality !== 'approximate') continue
    const line = lines[i]
    const text = line ? line.original || line.translation : ''
    if (!text.trim()) continue
    if (line.endTime - line.startTime < minLineDuration(text) * COMPRESSION_FRACTION - 1e-6) count++
  }
  return count
}

export interface ActivityRegion {
  start: number
  end: number
}

/** Sub-spans of [windowStart, windowEnd] where transcript words exist. Gaps
 * longer than maxGapS are instrumental breaks and split regions, so lines
 * redistributed onto activity never claim dead air. Words must be sorted by
 * startTime (sanitizeTranscript output is). */
export function findActivityRegions(
  words: TranscriptWord[],
  windowStart: number,
  windowEnd: number,
  maxGapS = 4,
): ActivityRegion[] {
  const regions: ActivityRegion[] = []
  for (const w of words) {
    if (w.endTime <= windowStart || w.startTime >= windowEnd) continue
    const start = Math.max(w.startTime, windowStart)
    const end = Math.min(w.endTime, windowEnd)
    const last = regions[regions.length - 1]
    if (last && start - last.end <= maxGapS) last.end = Math.max(last.end, end)
    else regions.push({ start, end })
  }
  return regions.filter((r) => r.end - r.start > 0.2)
}
