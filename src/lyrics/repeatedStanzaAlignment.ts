import type { Language, TimedLine } from '../core/types'
import { alignLyrics, lineWeight, sanitizeTranscript, type TranscriptWord } from '../ai-pipeline/aligner'
import { anchorLineByPartialMatch } from '../ai-pipeline/partialMatchAnchor'
import { normalizeForMatch, qualityRank, scoreLineAlignment } from '../ai-pipeline/contentAligner'
import { isRepetitionOnlyLine } from './lineAligner'

export interface RepeatedStanza {
  /** Normalized row texts in order. */
  lines: string[]
  /** Sheet start index for each occurrence (>=2). */
  occurrences: number[]
}

function stanzaKey(lineTexts: readonly string[], start: number, len: number): string {
  return lineTexts.slice(start, start + len).map((t) => normalizeForMatch(t)).join('\u0001')
}

// Ad-libs — "(Ah)", "(Tested my fate)", "（…）" — vary across chorus repeats
// (stranger-than-heaven final chorus) without changing which occurrence a line
// belongs to. Strip them before repeat comparison.
const AD_LIB_RE = /[（(][^）)]*[）)]/g
function strippedForRepeat(text: string): string {
  const stripped = normalizeForMatch(text.replace(AD_LIB_RE, ' '))
  // A pure-ad-lib line ("(Hey)") strips to '' — compare its real content
  // instead, so "(Hey)" doesn't spuriously group with "(Woo)".
  return stripped || normalizeForMatch(text)
}

function charLcsLen(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m || !n) return 0
  let prev = new Uint16Array(n + 1)
  let row = new Uint16Array(n + 1)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1])
    }
    ;[prev, row] = [row, prev]
  }
  return prev[n]
}

/** Near-identical after ad-lib stripping (final-chorus "、oh" tails etc.). */
const REPEAT_LINE_SIMILARITY = 0.85
// Short JA lines differing by one kana score deceptively high (きらきらひ vs
// きらきらほ → 0.80; 7 chars → 0.857), so fuzzy matching needs enough signal —
// same guard idea as the >=10-char gate in lineAligner's substring similarity.
const REPEAT_FUZZY_MIN_CHARS = 8
function linesSimilar(a: string, b: string): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length < REPEAT_FUZZY_MIN_CHARS || b.length < REPEAT_FUZZY_MIN_CHARS) return false
  return charLcsLen(a, b) / Math.max(a.length, b.length) >= REPEAT_LINE_SIMILARITY
}

/** Find consecutive line runs (1–6 rows) that repeat in the sheet — verbatim,
 * or near-identical (>=0.85 char similarity) after ad-lib stripping. */
export function findRepeatedStanzas(lineTexts: readonly string[]): RepeatedStanza[] {
  const maxLen = Math.min(6, lineTexts.length)
  const stripped = lineTexts.map((t) => strippedForRepeat(t))
  const byKey = new Map<string, { lines: string[]; occurrences: number[] }>()

  const blocksSimilar = (a: number, b: number, len: number): boolean => {
    for (let k = 0; k < len; k++) {
      if (!linesSimilar(stripped[a + k], stripped[b + k])) return false
    }
    return true
  }

  for (let len = maxLen; len >= 1; len--) {
    for (let start = 0; start <= lineTexts.length - len; start++) {
      const key = stanzaKey(lineTexts, start, len)
      if (byKey.has(key)) continue
      const occ: number[] = []
      for (let i = 0; i <= lineTexts.length - len; i++) {
        if (blocksSimilar(i, start, len)) occ.push(i)
      }
      if (occ.length >= 2) {
        byKey.set(key, {
          lines: lineTexts.slice(occ[0], occ[0] + len),
          occurrences: occ,
        })
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
 * Score a block against local transcript windows: `rank` is the summed per-line
 * quality rank (higher is better), `review` is the count of needs_review lines
 * (lower is better). The gate accepts a speculative 2-occurrence re-anchor only
 * when it strictly REDUCES needs_review lines — a block with none to begin with
 * (e.g. akfg's second ローリング block, already clean) has nothing to fix, so the
 * re-anchor is pure boundary risk and is declined.
 */
function blockQualityScore(
  out: TimedLine[],
  blockStart: number,
  blockLen: number,
  clean: TranscriptWord[],
  sourceLanguage: Language,
): { rank: number; review: number } {
  let rank = 0
  let review = 0
  for (let k = 0; k < blockLen; k++) {
    const li = blockStart + k
    const localWords = clean.filter(
      (w) => w.endTime > out[li].startTime - 3 && w.startTime < out[li].endTime + 6,
    )
    const quality = scoreLineAlignment(out[li].original, localWords, sourceLanguage).quality
    rank += qualityRank(quality)
    if (quality === 'needs_review') review++
  }
  return { rank, review }
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
    // Two-occurrence blocks are often verse pairs with divergent Whisper text on
    // the second pass (Veil post-chorus) — but real 2x choruses exist (stranger
    // bridge). Instead of skipping wholesale, re-anchor speculatively and keep
    // the result only when it scores strictly better than the current placement.
    const gated = stanza.occurrences.length === 2
    const blockLen = stanza.lines.length
    const refStart = stanza.occurrences[0]
    let searchFrom = out[refStart + blockLen - 1].endTime

    for (let o = 1; o < stanza.occurrences.length; o++) {
      const blockStart = stanza.occurrences[o]
      const beforeBlock = gated
        ? out.slice(blockStart, blockStart + blockLen).map((l) => ({ ...l }))
        : null
      const beforeScore = gated
        ? blockQualityScore(out, blockStart, blockLen, clean, sourceLanguage)
        : null
      const searchFromBefore = searchFrom
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
      if (beforeBlock && beforeScore) {
        const afterScore = blockQualityScore(out, blockStart, blockLen, clean, sourceLanguage)
        // Keep only a strictly-better placement: it must FIX at least one
        // needs_review line and never trade one away, and its summed quality
        // rank must strictly improve. Otherwise revert (restore lines and the
        // pre-block search cursor). A block with no needs_review lines to begin
        // with can never satisfy this, so clean 2x blocks are left untouched.
        const strictlyBetter =
          afterScore.review < beforeScore.review && afterScore.rank > beforeScore.rank
        if (!strictlyBetter) {
          for (let k = 0; k < blockLen; k++) out[blockStart + k] = beforeBlock[k]
          searchFrom = Math.max(searchFromBefore, out[blockStart + blockLen - 1].endTime)
          continue
        }
      }
      searchFrom = out[blockStart + blockLen - 1].endTime
    }
  }

  enforceSheetMonotonicity(out)
  return out
}

const SHARED_TAIL_MIN_CHARS = 6
const REPETITION_REF_MIN_SPAN_S = 1.4

function sharedSuffixPrefixLen(prevNorm: string, wordNorm: string): number {
  const max = Math.min(prevNorm.length, wordNorm.length)
  for (let len = max; len >= SHARED_TAIL_MIN_CHARS; len--) {
    if (prevNorm.endsWith(wordNorm.slice(0, len))) return len
  }
  return 0
}

function findSharedTailWord(
  prevLineText: string,
  words: readonly TranscriptWord[],
  searchFrom: number,
  searchTo: number,
): TranscriptWord | null {
  const prevNorm = normalizeForMatch(prevLineText)
  let best: TranscriptWord | null = null
  let bestShared = 0
  for (const w of words) {
    if (w.endTime <= searchFrom || w.startTime >= searchTo) continue
    const shared = sharedSuffixPrefixLen(prevNorm, normalizeForMatch(w.word))
    if (shared > bestShared) {
      bestShared = shared
      best = w
    }
  }
  return bestShared >= SHARED_TAIL_MIN_CHARS ? best : null
}

/**
 * When a repetition-only row (e.g. ローリング ローリング) repeats later but Whisper
 * drops or mishears the sung tail, re-split the preceding row + repetition pair
 * using lyric-weight timing from the first good occurrence (same split as chorus 1).
 */
export function realignRepeatedRepetitionOnlyLines(
  lines: TimedLine[],
  words: TranscriptWord[],
  lineTexts: readonly string[],
  sourceLanguage: Language,
): TimedLine[] {
  const clean = sanitizeTranscript(words)
  const out = lines.map((l) => ({ ...l }))
  const firstGoodByNorm = new Map<string, number>()

  for (let i = 0; i < out.length; i++) {
    const text = lineTexts[i] ?? out[i].original
    if (!isRepetitionOnlyLine(text)) continue
    const span = out[i].endTime - out[i].startTime
    if (span >= REPETITION_REF_MIN_SPAN_S && !firstGoodByNorm.has(normalizeForMatch(text))) {
      firstGoodByNorm.set(normalizeForMatch(text), i)
    }
  }

  for (let i = 0; i < out.length; i++) {
    const text = lineTexts[i] ?? out[i].original
    if (!isRepetitionOnlyLine(text) || i === 0) continue
    const norm = normalizeForMatch(text)
    const ref = firstGoodByNorm.get(norm)
    if (ref === undefined || ref === i || ref === 0) continue

    const refSpan = out[ref].endTime - out[ref].startTime
    const refPrevSpan = out[ref - 1].endTime - out[ref - 1].startTime
    const span = out[i].endTime - out[i].startTime
    const prevSpan = out[i - 1].endTime - out[i - 1].startTime
    if (refSpan < REPETITION_REF_MIN_SPAN_S) continue

    const nextStart = i + 1 < out.length ? out[i + 1].startTime : clean.at(-1)?.endTime ?? out[i].endTime
    const searchFrom = Math.max(0, out[i - 1].startTime)
    const searchTo = nextStart + 0.5
    const tailWord = findSharedTailWord(out[i - 1].original || out[i - 1].translation, clean, searchFrom, searchTo)
    if (!tailWord) continue

    const refNextStart =
      ref + 1 < out.length ? out[ref + 1].startTime : clean.at(-1)?.endTime ?? out[ref].endTime
    const refTailWord = findSharedTailWord(
      out[ref - 1].original || out[ref - 1].translation,
      clean,
      Math.max(0, out[ref - 1].startTime),
      refNextStart + 0.5,
    )
    const refOverflow = refTailWord
      ? Math.max(0, out[ref].endTime - refTailWord.endTime)
      : 0

    const blockStartTime = out[i - 1].startTime
    const blockEndTime = Math.min(nextStart, tailWord.endTime + refOverflow)
    if (blockEndTime - blockStartTime < refSpan * 0.75) continue

    const localWords = clean.filter(
      (w) => w.endTime > out[i].startTime - 4 && w.startTime < nextStart + 4,
    )
    const weakRepetition =
      scoreLineAlignment(text, localWords, sourceLanguage).quality === 'needs_review'
      || span < refSpan * 0.85
    const weakPair =
      prevSpan < refPrevSpan * 0.88
      || blockHasSquashedLine(out, ref - 1, i - 1, 2)
    if (!weakRepetition && !weakPair) continue

    applyReferenceStanzaTiming(
      out,
      ref - 1,
      i - 1,
      2,
      blockStartTime,
      blockEndTime,
      sourceLanguage,
    )
    enforceBlockMonotonic(out, i - 1, 2)
  }

  enforceSheetMonotonicity(out)
  return out
}

/** Repair one repetition-only row + its preceding clause using reference chorus timing. */
export function repairRepetitionPairAt(
  out: TimedLine[],
  repetitionIdx: number,
  words: readonly TranscriptWord[],
  lineTexts: readonly string[],
  sourceLanguage: Language,
  options?: { preservePrevStart?: boolean },
): boolean {
  if (repetitionIdx <= 0 || repetitionIdx >= out.length) return false
  const text = lineTexts[repetitionIdx] ?? out[repetitionIdx].original
  if (!isRepetitionOnlyLine(text)) return false

  const clean = sanitizeTranscript([...words])
  const norm = normalizeForMatch(text)
  let ref = -1
  for (let j = 0; j < repetitionIdx; j++) {
    if (!isRepetitionOnlyLine(lineTexts[j] ?? out[j].original)) continue
    if (normalizeForMatch(lineTexts[j] ?? out[j].original) !== norm) continue
    const refSpan = out[j].endTime - out[j].startTime
    if (refSpan >= REPETITION_REF_MIN_SPAN_S) {
      ref = j
      break
    }
  }
  if (ref <= 0) return false

  const refSpan = out[ref].endTime - out[ref].startTime
  const refPrevSpan = out[ref - 1].endTime - out[ref - 1].startTime
  const span = out[repetitionIdx].endTime - out[repetitionIdx].startTime
  const prevSpan = out[repetitionIdx - 1].endTime - out[repetitionIdx - 1].startTime
  const nextStart =
    repetitionIdx + 1 < out.length
      ? out[repetitionIdx + 1].startTime
      : clean.at(-1)?.endTime ?? out[repetitionIdx].endTime
  const searchFrom = Math.max(0, out[repetitionIdx - 1].startTime)
  const tailWord = findSharedTailWord(
    out[repetitionIdx - 1].original || out[repetitionIdx - 1].translation,
    clean,
    searchFrom,
    nextStart + 0.5,
  )
  if (!tailWord) return false

  const refNextStart =
    ref + 1 < out.length ? out[ref + 1].startTime : clean.at(-1)?.endTime ?? out[ref].endTime
  const refTailWord = findSharedTailWord(
    out[ref - 1].original || out[ref - 1].translation,
    clean,
    Math.max(0, out[ref - 1].startTime),
    refNextStart + 0.5,
  )
  const refOverflow = refTailWord
    ? Math.max(0, out[ref].endTime - refTailWord.endTime)
    : 0

  const blockStartTime = out[repetitionIdx - 1].startTime
  const blockEndTime = Math.min(nextStart, tailWord.endTime + refOverflow)
  if (blockEndTime - blockStartTime < refSpan * 0.75) return false

  const localWords = clean.filter(
    (w) => w.endTime > out[repetitionIdx].startTime - 4 && w.startTime < nextStart + 4,
  )
  const weakRepetition =
    scoreLineAlignment(text, localWords, sourceLanguage).quality === 'needs_review'
    || span < refSpan * 0.85
  const weakPair =
    prevSpan < refPrevSpan * 0.88
    || prevSpan > refPrevSpan * 1.2
    || blockHasSquashedLine(out, ref - 1, repetitionIdx - 1, 2)
  if (!weakRepetition && !weakPair) return false

  const savedPrevStart = options?.preservePrevStart
    ? out[repetitionIdx - 1].startTime
    : undefined
  applyReferenceStanzaTiming(
    out,
    ref - 1,
    repetitionIdx - 1,
    2,
    blockStartTime,
    blockEndTime,
    sourceLanguage,
  )
  if (savedPrevStart !== undefined) {
    out[repetitionIdx - 1].startTime = savedPrevStart
  }
  enforceBlockMonotonic(out, repetitionIdx - 1, 2)
  return true
}
