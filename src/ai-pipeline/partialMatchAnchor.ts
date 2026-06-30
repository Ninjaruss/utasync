import type { TranscriptWord } from './aligner'
import { normalizeForMatch } from './contentAligner'

/** Distinctive substrings to hunt when full-line LCS fails (longest first). */
export function distinctiveSubstrings(lineText: string): string[] {
  const norm = normalizeForMatch(lineText)
  if (norm.length < 2) return []
  const out: string[] = []
  if (norm.length <= 12) out.push(norm)
  for (const part of lineText.trim().split(/\s+/)) {
    const pn = normalizeForMatch(part)
    if (pn.length >= 3) out.push(pn)
  }
  for (const len of [10, 8, 6, 4]) {
    if (norm.length >= len) out.push(norm.slice(-len))
  }
  if (norm.length >= 4) out.push(norm.slice(0, Math.min(6, norm.length)))
  // Short distinctive grams — Whisper often keeps one mora (e.g. 救え) when the full line is misheard.
  const tailRegion = norm.slice(-Math.min(12, norm.length))
  for (let i = 0; i < tailRegion.length - 1; i++) {
    out.push(tailRegion.slice(i, i + 2))
    if (i + 2 < tailRegion.length) out.push(tailRegion.slice(i, i + 3))
  }
  return [...new Set(out)].filter((s) => s.length >= 2).sort((a, b) => b.length - a.length)
}

export interface PartialAnchorMatch {
  startTime: number
  endTime: number
  needle: string
}

/**
 * Find transcript audio that partially matches lyric text — useful when Whisper
 * mis-hears a chorus repeat but still catches a distinctive substring.
 */
export function anchorLineByPartialMatch(
  lineText: string,
  words: readonly TranscriptWord[],
  searchFrom: number,
  searchTo: number,
): PartialAnchorMatch | null {
  const needles = distinctiveSubstrings(lineText)
  if (!needles.length) return null

  let best: PartialAnchorMatch & { score: number } | null = null

  for (let i = 0; i < words.length; i++) {
    if (words[i].startTime > searchTo + 1) break
    if (words[i].endTime < searchFrom - 1) continue

    let acc = ''
    let accStart = words[i].startTime
    for (let j = i; j < words.length; j++) {
      if (words[j].startTime > searchTo + 2) break
      if (words[j].endTime < searchFrom - 1) continue
      if (acc && words[j].startTime - words[j - 1].endTime > 1.8) break

      if (!acc) accStart = words[j].startTime
      acc += normalizeForMatch(words[j].word)
      const accEnd = words[j].endTime

      for (const needle of needles) {
        if (needle.length < 2) continue

        const wordNorm = normalizeForMatch(words[j].word)
        const inAcc = acc.includes(needle)
        const exactWord = wordNorm.length >= 2 && wordNorm === needle
        const wordCarriesNeedle =
          wordNorm.length >= 4 && (wordNorm.includes(needle) || needle.includes(wordNorm))
        if (!inAcc && !exactWord && !wordCarriesNeedle) continue

        const startTime = exactWord || wordCarriesNeedle ? words[j].startTime : accStart
        const endTime = exactWord || wordCarriesNeedle ? words[j].endTime : accEnd
        const proximityBonus = startTime >= searchFrom - 0.5 ? 2 : -3
        const score =
          needle.length
          + proximityBonus
          + (exactWord ? 4 : inAcc && acc === needle ? 3 : inAcc && acc.endsWith(needle) ? 1 : 0)

        if (!best || score > best.score) {
          best = { startTime, endTime, needle, score }
        }
      }

      if (acc.length > 48) break
    }
  }

  if (!best) return null
  return { startTime: best.startTime, endTime: best.endTime, needle: best.needle }
}
