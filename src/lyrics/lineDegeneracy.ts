import type { Language } from '../core/types'
import { lineWeight, type TranscriptWord } from '../ai-pipeline/aligner'
import { normalizeForMatch } from '../ai-pipeline/contentAligner'

const JA_SCRIPT_RE = /[぀-ヿ㐀-鿿]/

/** Rough duration a line should take to sing. `lineWeight` counts JA characters
 * (≈ morae) or EN words, which sing at very different rates — ~0.25s per JA
 * char, ~0.4s per EN word. Clamped: no line plausibly sings under 0.8s or over 12s. */
export function expectedLineDuration(text: string, sourceLanguage: Language): number {
  const weight = Math.max(1, lineWeight(text, sourceLanguage))
  const unit = JA_SCRIPT_RE.test(text) ? 0.25 : 0.4
  return Math.min(12, Math.max(0.8, weight * unit))
}

/** Lower bound on a plausible sung span (mirrors phraseAlignment's minSungSpan). */
export function minLineDuration(text: string): number {
  const glyphs = normalizeForMatch(text).length
  return Math.max(0.8, Math.min(4.5, glyphs * 0.14))
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
