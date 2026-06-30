import type { Language, TimedLine } from '../core/types'
import { alignLyrics, lineWeight, sanitizeTranscript, type TranscriptWord } from '../ai-pipeline/aligner'
import { anchorLineByPartialMatch } from '../ai-pipeline/partialMatchAnchor'
import { normalizeForMatch, scoreLineAlignment } from '../ai-pipeline/contentAligner'

export interface RepeatedStanza {
  /** Normalized row texts in order. */
  lines: string[]
  /** Sheet start index for each occurrence (>=2). */
  occurrences: number[]
}

function stanzaKey(lineTexts: readonly string[], start: number, len: number): string {
  return lineTexts.slice(start, start + len).map((t) => normalizeForMatch(t)).join('\u0001')
}

/** Find consecutive line runs (1–6 rows) that repeat verbatim in the sheet. */
export function findRepeatedStanzas(lineTexts: readonly string[]): RepeatedStanza[] {
  const maxLen = Math.min(6, lineTexts.length)
  const byKey = new Map<string, { lines: string[]; occurrences: number[] }>()

  for (let len = maxLen; len >= 1; len--) {
    for (let start = 0; start <= lineTexts.length - len; start++) {
      const key = stanzaKey(lineTexts, start, len)
      if (byKey.has(key)) continue
      const occ: number[] = []
      for (let i = 0; i <= lineTexts.length - len; i++) {
        if (stanzaKey(lineTexts, i, len) === key) occ.push(i)
      }
      if (occ.length >= 2) {
        byKey.set(key, { lines: lineTexts.slice(start, start + len), occurrences: occ })
      }
    }
  }

  // Prefer stanzas whose first occurrence is earliest so a 4-line chorus at rows 1–4
  // wins over a longer 6-line run that only repeats later (Veil second/third chorus).
  const all = [...byKey.values()].sort(
    (a, b) =>
      a.occurrences[0] - b.occurrences[0]
      || b.lines.length - a.lines.length
      || b.occurrences.length - a.occurrences.length,
  )
  const used = new Set<number>()
  const picked: RepeatedStanza[] = []
  for (const stanza of all) {
    const covered = new Set<number>()
    for (const start of stanza.occurrences) {
      for (let k = 0; k < stanza.lines.length; k++) covered.add(start + k)
    }
    let overlaps = false
    for (const idx of covered) {
      if (used.has(idx)) {
        overlaps = true
        break
      }
    }
    if (overlaps) continue
    for (const idx of covered) used.add(idx)
    picked.push(stanza)
  }
  return picked
}

function applyReferenceStanzaTiming(
  out: TimedLine[],
  refStart: number,
  targetStart: number,
  blockLen: number,
  blockStartTime: number,
  blockEndTime: number,
  sourceLanguage: Language,
): void {
  const refLines = out.slice(refStart, refStart + blockLen)
  const refDur = Math.max(0.5, refLines[blockLen - 1].endTime - refLines[0].startTime)
  const targetDur = Math.max(refDur * 0.85, blockEndTime - blockStartTime)
  let cum = 0
  const weights = refLines.map((l) => Math.max(1, lineWeight(l.original, sourceLanguage)))
  const total = weights.reduce((a, b) => a + b, 0) || 1

  for (let k = 0; k < blockLen; k++) {
    const li = targetStart + k
    const startFrac = cum / total
    cum += weights[k]
    const endFrac = cum / total
    const start = blockStartTime + targetDur * startFrac
    const end = blockStartTime + targetDur * endFrac
    out[li].startTime = start
    out[li].endTime = Math.max(end, start + 0.35)
  }
}

function enforceBlockMonotonic(out: TimedLine[], blockStart: number, blockLen: number): void {
  for (let k = 1; k < blockLen; k++) {
    const li = blockStart + k
    if (out[li].startTime < out[li - 1].startTime) out[li].startTime = out[li - 1].startTime
    const ownEnd = Math.max(out[li].endTime, out[li].startTime)
    out[li].endTime = Math.min(ownEnd, out[li + 1]?.startTime ?? ownEnd)
  }
  for (let k = blockLen - 2; k >= 0; k--) {
    const li = blockStart + k
    if (out[li].endTime > out[li + 1].startTime) out[li].endTime = out[li + 1].startTime
  }
}

function enforceSheetMonotonicity(out: TimedLine[]): void {
  for (let i = 1; i < out.length; i++) {
    if (out[i].startTime < out[i - 1].startTime) out[i].startTime = out[i - 1].startTime
  }
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].endTime > out[i + 1].startTime) out[i].endTime = out[i + 1].startTime
    const ownEnd = Math.max(out[i].endTime, out[i].startTime)
    out[i].endTime = Math.min(ownEnd, out[i + 1].startTime)
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i].endTime <= out[i].startTime) out[i].endTime = out[i].startTime + 0.3
  }
}

const STANZA_WINDOW_LEAD_S = 8
const STANZA_WINDOW_TAIL_S = 14
const STANZA_MIN_LINE_S = 0.55

function blockHasSquashedLine(
  out: TimedLine[],
  refStart: number,
  blockStart: number,
  blockLen: number,
): boolean {
  for (let k = 0; k < blockLen; k++) {
    const span = out[blockStart + k].endTime - out[blockStart + k].startTime
    const refSpan = out[refStart + k].endTime - out[refStart + k].startTime
    if (span < STANZA_MIN_LINE_S || (refSpan > 0.4 && span < refSpan * 0.35)) return true
  }
  return false
}

function naturalBlockEndTime(
  hintStart: number,
  refDur: number,
  nextStart: number,
  alignedBlockEnd: number,
): number {
  return Math.min(nextStart, hintStart + refDur * 1.35, alignedBlockEnd + 2)
}

/**
 * Re-anchor later occurrences of repeating stanzas with a forward transcript cursor,
 * partial-substring fallback, and reference timing from the first occurrence.
 */
export function realignRepeatedStanzaOccurrences(
  lines: TimedLine[],
  words: TranscriptWord[],
  lineTexts: readonly string[],
  sourceLanguage: Language,
): TimedLine[] {
  const stanzas = findRepeatedStanzas(lineTexts)
  if (!stanzas.length) return lines

  const clean = sanitizeTranscript(words)
  const lastTime = clean.at(-1)?.endTime ?? 0
  const out = lines.map((l) => ({ ...l }))

  for (const stanza of stanzas) {
    // Two-occurrence blocks are often verse pairs with divergent Whisper text on the
    // second pass (Veil post-chorus). Reserve block re-anchor for 3+ chorus repeats.
    if (stanza.occurrences.length < 3) continue
    const blockLen = stanza.lines.length
    const refStart = stanza.occurrences[0]
    let searchFrom = out[refStart + blockLen - 1].endTime

    for (let o = 1; o < stanza.occurrences.length; o++) {
      const blockStart = stanza.occurrences[o]
      const hintStart = out[blockStart].startTime
      const prevEnd = blockStart > 0 ? out[blockStart - 1].endTime : 0
      const nextStart =
        blockStart + blockLen < out.length ? out[blockStart + blockLen].startTime : lastTime
      const refDur = Math.max(
        1,
        out[refStart + blockLen - 1].endTime - out[refStart].startTime,
      )
      const windowStart = Math.max(searchFrom - 0.3, prevEnd - 0.5, hintStart - STANZA_WINDOW_LEAD_S)
      const windowEnd = Math.min(
        lastTime,
        nextStart + 2,
        hintStart + refDur * 1.5 + STANZA_WINDOW_TAIL_S,
      )
      const windowWords = clean.filter(
        (w) => w.endTime > windowStart && w.startTime < windowEnd,
      )

      if (windowWords.length > 0) {
        const aligned = alignLyrics(stanza.lines, windowWords, undefined, sourceLanguage)
        for (let k = 0; k < blockLen; k++) {
          const li = blockStart + k
          const floor = k === 0 ? Math.max(searchFrom, prevEnd) : out[li - 1].endTime
          out[li].startTime = Math.max(aligned.lines[k].startTime, floor)
          out[li].endTime = Math.max(aligned.lines[k].endTime, out[li].startTime + 0.25)
        }
      }

      const alignedBlockEnd = out[blockStart + blockLen - 1].endTime
      const blockEnd = naturalBlockEndTime(hintStart, refDur, nextStart, alignedBlockEnd)
      if (blockHasSquashedLine(out, refStart, blockStart, blockLen)) {
        applyReferenceStanzaTiming(
          out,
          refStart,
          blockStart,
          blockLen,
          Math.max(searchFrom, prevEnd),
          blockEnd,
          sourceLanguage,
        )
      }

      for (let k = 0; k < blockLen; k++) {
        const li = blockStart + k
        const localWords = clean.filter(
          (w) =>
            w.endTime > out[li].startTime - 4
            && w.startTime < (out[li + 1]?.startTime ?? nextStart) + 3,
        )
        const score = scoreLineAlignment(out[li].original, localWords, sourceLanguage)
        if (score.quality !== 'needs_review') continue
        const partial = anchorLineByPartialMatch(
          out[li].original,
          clean,
          Math.max(searchFrom, out[li].startTime - 6),
          Math.min(windowEnd, nextStart + 2),
        )
        if (!partial) continue
        out[li].startTime = Math.max(partial.startTime, k === 0 ? searchFrom : out[li - 1].endTime)
        out[li].endTime = Math.max(partial.endTime, out[li].startTime + 0.4)
      }

      let weak = 0
      for (let k = 0; k < blockLen; k++) {
        const li = blockStart + k
        const localWords = clean.filter(
          (w) => w.endTime > out[li].startTime - 3 && w.startTime < out[li].endTime + 6,
        )
        if (scoreLineAlignment(out[li].original, localWords, sourceLanguage).quality === 'needs_review') {
          weak++
        }
      }
      if (weak >= Math.ceil(blockLen / 2) || blockHasSquashedLine(out, refStart, blockStart, blockLen)) {
        applyReferenceStanzaTiming(
          out,
          refStart,
          blockStart,
          blockLen,
          Math.max(searchFrom, prevEnd),
          blockEnd,
          sourceLanguage,
        )
      }

      enforceBlockMonotonic(out, blockStart, blockLen)
      searchFrom = out[blockStart + blockLen - 1].endTime
    }
  }

  enforceSheetMonotonicity(out)
  return out
}
