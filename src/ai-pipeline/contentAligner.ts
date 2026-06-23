import type { Language, TimedLine } from '../core/types'
import { lineWeight, type TranscriptWord } from './aligner'

// Characters worth matching on: lowercase Latin letters and Japanese scripts
// (kana + prolonged mark + kanji blocks). Everything else (spaces, punctuation,
// full-width symbols) is dropped so it can't block a match.
const MATCH_CHAR = /[a-z぀-ヿー㐀-鿿豈-﫿]/

/**
 * Curated orthography aliases, normalized symmetrically on both the lyric
 * line and the transcript so a stylized/alternate spelling on either side
 * still matches. A full kanji<->reading conversion was tried and measured
 * against a real transcript (tests/ai-pipeline/alignment-benchmark.test.ts):
 * it fixed mismatches like these but *regressed* overall mean error
 * (0.429s -> 0.489s) — collapsing kanji to hiragana shrinks the matching
 * alphabet and made the LCS more prone to anchoring on the wrong occurrence of
 * a common mora sequence elsewhere in the song. This is the narrow, measured-safe
 * version: only specific spellings that caused real, reproducible errors are
 * normalized, leaving the otherwise-precise kanji/kanji matching intact.
 *
 * - キミ -> 君: katakana stylization of "you", conventional in J-pop lyric
 *   sheets; Whisper's Japanese ASR normally outputs the kanji.
 *
 * 滑り -> すべり (verb stem of 滑り込む/滑り出す) was also tried — Whisper does
 * sometimes render it phonetically — but measured against two independent real
 * transcriptions of the same song it was a wash, not a win: it fixed the one
 * occurrence Whisper rendered as kana but *regressed* a different occurrence
 * Whisper had already rendered correctly as kanji, because expanding 1 kanji
 * char into 3 common, low-uniqueness hiragana chars gives the LCS more room to
 * anchor on the wrong occurrence elsewhere in the song. Unlike キミ->君 (which
 * had zero measured downside), this one isn't a clean win — left out.
 */
const LYRIC_ORTHOGRAPHY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['キミ', '君'],
]

/** Sighs / filler rows that are rarely transcribed — do not anchor by coincidence. */
const INTERJECTION_RE = /^(嗚呼|うーん|うー|あー|…|\.\.\.|\.{2,})/
const JA_SCRIPT = /[぀-ヿ㐀-鿿]/

export function isInterjectionLyricLine(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (INTERJECTION_RE.test(t)) return true
  const glyphs = t.replace(/[….\s]/g, '')
  // Repeated single mora (ああ) — not real two-kana words like ねこ or そら.
  return glyphs.length === 2 && glyphs[0] === glyphs[1] && JA_SCRIPT.test(t)
}

function applyOrthographyAliases(text: string): string {
  let out = text
  for (const [from, to] of LYRIC_ORTHOGRAPHY_ALIASES) out = out.split(from).join(to)
  return out
}

export function normalizeForMatch(text: string): string {
  let out = ''
  for (const ch of applyOrthographyAliases(text).toLowerCase()) if (MATCH_CHAR.test(ch)) out += ch
  return out
}

interface LyricChar { ch: string; line: number }
interface TransChar { ch: string; time: number }

function buildLyricChars(lineTexts: string[]): LyricChar[] {
  const out: LyricChar[] = []
  lineTexts.forEach((line, li) => {
    for (const ch of normalizeForMatch(line)) out.push({ ch, line: li })
  })
  return out
}

function buildTransChars(words: TranscriptWord[]): TransChar[] {
  const out: TransChar[] = []
  for (const w of words) {
    const n = normalizeForMatch(w.word)
    const k = Math.max(1, n.length)
    const duration = w.endTime - w.startTime
    let j = 0
    for (const ch of n) {
      // First char anchors to word onset — mid-word interpolation was pushing
      // line starts ~50–150ms late vs. when the singer actually begins.
      const time =
        j === 0
          ? w.startTime
          : j === k - 1
            ? w.endTime
            : w.startTime + duration * ((j + 0.5) / k)
      out.push({ ch, time })
      j++
    }
  }
  return out
}

interface LcsMatch {
  /** Matched transcript time per lyric char index, or -1 (monotonic by construction). */
  matchTime: Float64Array
  /** Matched transcript char index per lyric char index, or -1. */
  matchBIndex: Int32Array
}

// Longest common subsequence over the two char streams.
function lcsMatchTimes(A: LyricChar[], B: TransChar[]): LcsMatch {
  const m = A.length, n = B.length
  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))
  for (let i = 1; i <= m; i++) {
    const row = dp[i], prev = dp[i - 1]
    for (let j = 1; j <= n; j++) {
      row[j] = A[i - 1].ch === B[j - 1].ch ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1])
    }
  }
  const matchTime = new Float64Array(m).fill(-1)
  const matchBIndex = new Int32Array(m).fill(-1)
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (A[i - 1].ch === B[j - 1].ch) { matchTime[i - 1] = B[j - 1].time; matchBIndex[i - 1] = j - 1; i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  return { matchTime, matchBIndex }
}

// Minimum run of *consecutive* lyric chars matched to *consecutive* transcript
// chars before a match is trusted to anchor a line's time. Japanese has a small,
// heavily-repeated character set (の/に/は/を/...), so a single isolated char can
// coincidentally LCS-match the wrong occurrence far away in the transcript —
// that one stray match would otherwise drag the whole line's start time off,
// even while the song's aggregate per-character confidence stays high (most
// *other* chars matched correctly). A real word/phrase match naturally produces
// several consecutive char matches in a row, so requiring a short run filters
// out the single-char coincidences without rejecting genuine short words.
const MIN_RELIABLE_RUN = 2

interface LineAnchors {
  /** Earliest reliably matched time per line; NaN where a line had no run of MIN_RELIABLE_RUN+ consecutive matched chars. */
  starts: Float64Array
  /** Latest reliably matched time per line (own last sung char) — same NaN rule as `starts`. */
  ends: Float64Array
}

interface ReliableRun {
  startTime: number
  endTime: number
  /** Matched char count — used to weigh this run against others on the same line. */
  length: number
}

// Two runs on the same line are treated as one continuous utterance (e.g. a
// skipped/unmatched particle mid-phrase) when the gap between them is this
// small; word-internal char-to-char gaps in real transcripts run well under a
// second, so this comfortably covers genuine continuations without merging
// runs that land in clearly different parts of the song.
const RUN_CLUSTER_GAP_S = 2.5

/**
 * Groups a line's reliable runs by time-proximity and keeps only the cluster
 * with the most matched characters. A short line repeated many times in a
 * song (a common chorus phrase like "ねえ") can have its longest-substring LCS
 * match split across two *different, far-apart* real occurrences — e.g. a
 * 2-char prefix coincidentally matching an earlier line's sung instant while
 * the rest of this line matches its own, correct, much-later instant. Taking
 * the earliest run blindly (old behavior) anchored the line to the wrong,
 * earlier occurrence even though the bulk of its content matched elsewhere.
 * Trusting the larger cluster favors the occurrence with stronger evidence.
 */
function strongestCluster(runs: ReliableRun[]): ReliableRun {
  const sorted = [...runs].sort((a, b) => a.startTime - b.startTime)
  const clusters: ReliableRun[][] = [[sorted[0]]]
  for (let k = 1; k < sorted.length; k++) {
    const current = clusters[clusters.length - 1]
    const gap = sorted[k].startTime - current[current.length - 1].endTime
    if (gap <= RUN_CLUSTER_GAP_S) current.push(sorted[k])
    else clusters.push([sorted[k]])
  }
  let best = clusters[0]
  let bestChars = best.reduce((a, r) => a + r.length, 0)
  for (const cluster of clusters.slice(1)) {
    const chars = cluster.reduce((a, r) => a + r.length, 0)
    if (chars > bestChars) {
      best = cluster
      bestChars = chars
    }
  }
  return { startTime: best[0].startTime, endTime: best[best.length - 1].endTime, length: bestChars }
}

// Reliable (MIN_RELIABLE_RUN+ consecutive matched chars) start/end anchors per line.
function anchorsByLine(A: LyricChar[], match: LcsMatch, lineCount: number): LineAnchors {
  const { matchTime, matchBIndex } = match
  const runsByLine: ReliableRun[][] = Array.from({ length: lineCount }, () => [])
  const m = A.length
  let runStart = 0
  for (let idx = 0; idx <= m; idx++) {
    const continuesRun =
      idx < m
      && matchBIndex[idx] >= 0
      && idx > runStart
      && matchBIndex[idx] === matchBIndex[idx - 1] + 1
      && A[idx].line === A[idx - 1].line
      // Adjacent in the transcript char *array* isn't adjacent in *time* when
      // nothing else was transcribed in between (a real silence/instrumental
      // gap, or a skipped line). Without this, two genuinely separate sung
      // instants (e.g. a short phrase's first occurrence and a much later
      // recurrence) merge into one "run" purely because no other char sits
      // between them in the array, defeating the clustering below before it
      // ever sees a split point.
      && matchTime[idx] - matchTime[idx - 1] <= RUN_CLUSTER_GAP_S
    if (continuesRun) continue

    // Run [runStart, idx) just ended — record it if long enough and matched.
    const runLength = idx - runStart
    if (runLength >= MIN_RELIABLE_RUN && matchBIndex[runStart] >= 0) {
      const li = A[runStart].line
      runsByLine[li].push({ startTime: matchTime[runStart], endTime: matchTime[idx - 1], length: runLength })
    }
    runStart = idx
  }

  const starts = new Float64Array(lineCount).fill(NaN)
  const ends = new Float64Array(lineCount).fill(NaN)
  for (let li = 0; li < lineCount; li++) {
    if (runsByLine[li].length === 0) continue
    const { startTime, endTime } = strongestCluster(runsByLine[li])
    starts[li] = startTime
    ends[li] = endTime
  }
  return { starts, ends }
}

interface LineCharStats {
  matchedCount: number
  unmatchedHead: number
  unmatchedTail: number
  firstMatchedTime: number
  lastMatchedTime: number
}

/** Per-line LCS coverage — used to reserve time for lyric tails Whisper skipped. */
function lineCharStats(A: LyricChar[], match: LcsMatch, lineCount: number): LineCharStats[] {
  const stats: LineCharStats[] = Array.from({ length: lineCount }, () => ({
    matchedCount: 0,
    unmatchedHead: 0,
    unmatchedTail: 0,
    firstMatchedTime: Infinity,
    lastMatchedTime: -Infinity,
  }))
  for (let li = 0; li < lineCount; li++) {
    let head = 0
    for (let idx = 0; idx < A.length; idx++) {
      if (A[idx].line !== li) continue
      if (match.matchTime[idx] >= 0) break
      head++
    }
    stats[li].unmatchedHead = head
    let tail = 0
    for (let idx = A.length - 1; idx >= 0; idx--) {
      if (A[idx].line !== li) continue
      if (match.matchTime[idx] >= 0) break
      tail++
    }
    stats[li].unmatchedTail = tail
  }
  for (let idx = 0; idx < A.length; idx++) {
    const t = match.matchTime[idx]
    if (t < 0) continue
    const li = A[idx].line
    stats[li].matchedCount++
    stats[li].firstMatchedTime = Math.min(stats[li].firstMatchedTime, t)
    stats[li].lastMatchedTime = Math.max(stats[li].lastMatchedTime, t)
  }
  return stats
}

/** Trailing space-separated repeat (ローリング ローリング) or echo tail (…ように ように). */
function lyricRepetitionTailFraction(text: string): number {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return 0
  const last = parts[parts.length - 1]
  if (parts[parts.length - 2] === last) {
    return normalizeForMatch(last).length / Math.max(1, normalizeForMatch(text).length)
  }
  if (parts.length === 2 && parts[0].endsWith(parts[1])) {
    return normalizeForMatch(parts[1]).length / Math.max(1, normalizeForMatch(text).length)
  }
  return 0
}

/**
 * Pull start earlier when Whisper matched only a suffix of the lyric line
 * (common on first-take vocals with ad-libs or kana/kanji mismatch).
 */
function estimatedLineStart(
  li: number,
  starts: readonly number[],
  ownEndAnchors: Float64Array,
  stats: LineCharStats[],
  lineTexts: string[],
): number {
  const { unmatchedHead, matchedCount, firstMatchedTime } = stats[li]
  let start = starts[li]
  if (unmatchedHead > 0 && matchedCount > 0 && Number.isFinite(firstMatchedTime)) {
    const end = estimatedLineEnd(li, starts, ownEndAnchors, stats, lineTexts)
    const anchor = Number.isFinite(end) ? end : firstMatchedTime
    const sungSpan = Math.max(0.08, anchor - firstMatchedTime)
    start = Math.min(start, firstMatchedTime - sungSpan * (unmatchedHead / matchedCount))
  }
  return Math.max(0, start)
}

/**
 * Best estimate of when a line's sung audio ends. Extends past the last reliable
 * LCS run when trailing lyric chars had no transcript match (Whisper dropped
 * syllables) so the next line does not steal the vocal tail.
 */
function estimatedLineEnd(
  li: number,
  starts: readonly number[],
  ownEndAnchors: Float64Array,
  stats: LineCharStats[],
  lineTexts: string[],
): number {
  const { matchedCount, unmatchedTail, lastMatchedTime } = stats[li]
  const ownEnd = ownEndAnchors[li]
  let end = Number.isNaN(ownEnd) ? lastMatchedTime : Math.max(ownEnd, lastMatchedTime)
  if (!Number.isFinite(end)) return NaN
  const start = starts[li]
  if (unmatchedTail > 0 && matchedCount > 0) {
    const sungSpan = Math.max(0, end - start)
    if (sungSpan > 0) end += sungSpan * (unmatchedTail / matchedCount)
  }
  const repFrac = lyricRepetitionTailFraction(lineTexts[li] ?? '')
  if (repFrac > 0 && end > start) {
    end += (end - start) * repFrac
  }
  return end
}

/** Push each line's start to at least the previous line's estimated vocal end. */
function strengthenLineBoundaries(
  starts: number[],
  ownEndAnchors: Float64Array,
  stats: LineCharStats[],
  lineTexts: string[],
): void {
  for (let li = 0; li < starts.length; li++) {
    starts[li] = estimatedLineStart(li, starts, ownEndAnchors, stats, lineTexts)
  }
  for (let li = 0; li < starts.length - 1; li++) {
    const effEnd = estimatedLineEnd(li, starts, ownEndAnchors, stats, lineTexts)
    if (!Number.isFinite(effEnd)) continue
    if (starts[li + 1] < effEnd) starts[li + 1] = effEnd
  }
  for (let li = 1; li < starts.length; li++) {
    if (!isInterjectionLyricLine(lineTexts[li])) continue
    const prevEnd = estimatedLineEnd(li - 1, starts, ownEndAnchors, stats, lineTexts)
    if (Number.isFinite(prevEnd) && starts[li] < prevEnd) starts[li] = prevEnd
  }
  for (let li = 1; li < starts.length; li++) {
    if (starts[li] < starts[li - 1]) starts[li] = starts[li - 1]
  }
}

// Fill NaN line-anchors by interpolating between known neighbours, weighted by
// each line's token weight (long lines take proportionally longer).
function interpolateAnchors(
  anchors: Float64Array,
  lineTexts: string[],
  sourceLanguage: Language,
  lastTime: number,
): number[] {
  const n = anchors.length
  const w = lineTexts.map((t) => Math.max(1, lineWeight(t, sourceLanguage)))
  const out = Array.from(anchors)
  // Leading run with no anchor: scale up from 0 to the first known anchor.
  let first = 0
  while (first < n && Number.isNaN(out[first])) first++
  if (first === n) return out.map((_, i) => (i / Math.max(1, n)) * lastTime) // nothing matched
  for (let i = 0; i < first; i++) {
    const num = w.slice(0, i).reduce((a, b) => a + b, 0)
    const den = w.slice(0, first).reduce((a, b) => a + b, 0) || 1
    out[i] = out[first] * (num / den)
  }
  // Middle/trailing gaps. For an unanchored run (l..r-1) between known anchors
  // out[l-1] and out[r], place each line by its cumulative token weight so long
  // lines occupy proportionally more of the interval. A trailing run (no right
  // anchor) holds the last known time.
  let l = first
  while (l < n) {
    if (!Number.isNaN(out[l])) { l++; continue }
    let r = l
    while (r < n && Number.isNaN(out[r])) r++
    const left = out[l - 1]
    if (r < n) {
      const right = out[r]
      const total = w.slice(l, r + 1).reduce((a, b) => a + b, 0) || 1
      let acc = 0
      for (let k = l; k < r; k++) { acc += w[k]; out[k] = left + (right - left) * (acc / total) }
    } else {
      for (let k = l; k < n; k++) out[k] = left
    }
    l = r
  }
  return out
}

export function alignByContent(
  lineTexts: string[],
  words: TranscriptWord[],
  existingLines: TimedLine[] | undefined,
  sourceLanguage: Language,
): { lines: TimedLine[]; confidence: number } {
  const lineCount = lineTexts.length
  const buildLine = (li: number, startTime: number, endTime: number): TimedLine => ({
    startTime,
    endTime,
    original: existingLines?.[li]?.original ?? lineTexts[li],
    translation: existingLines?.[li]?.translation ?? lineTexts[li],
  })

  const A = buildLyricChars(lineTexts)
  const B = buildTransChars(words)
  if (A.length === 0 || B.length === 0 || lineCount === 0) {
    return { lines: lineTexts.map((_, li) => buildLine(li, 0, 0)), confidence: 0 }
  }

  const match = lcsMatchTimes(A, B)
  const matched = Array.from(match.matchTime).reduce((acc, t) => acc + (t >= 0 ? 1 : 0), 0)
  const confidence = matched / A.length
  const stats = lineCharStats(A, match, lineCount)

  const { starts: anchors, ends: ownEndAnchors } = anchorsByLine(A, match, lineCount)
  for (let li = 0; li < lineCount; li++) {
    if (stats[li].lastMatchedTime > -Infinity) {
      ownEndAnchors[li] = Number.isNaN(ownEndAnchors[li])
        ? stats[li].lastMatchedTime
        : Math.max(ownEndAnchors[li], stats[li].lastMatchedTime)
    }
  }
  for (let li = 0; li < lineCount; li++) {
    if (isInterjectionLyricLine(lineTexts[li])) {
      anchors[li] = NaN
      ownEndAnchors[li] = NaN
    }
  }
  // Robustify: a later line anchored earlier than an earlier kept line is a wrong
  // match against a repeated phrase — drop it so it interpolates from neighbours.
  let lastKept = -Infinity
  for (let li = 0; li < anchors.length; li++) {
    if (Number.isNaN(anchors[li])) continue
    if (anchors[li] < lastKept) anchors[li] = NaN
    else lastKept = anchors[li]
  }
  const lastTime = B[B.length - 1].time
  const starts = interpolateAnchors(anchors, lineTexts, sourceLanguage, lastTime)

  strengthenLineBoundaries(starts, ownEndAnchors, stats, lineTexts)

  const lines = starts.map((s, li) => {
    const nextStart = li + 1 < starts.length ? starts[li + 1] : lastTime
    const effEnd = estimatedLineEnd(li, starts, ownEndAnchors, stats, lineTexts)
    const endBase = Number.isFinite(effEnd)
      ? effEnd
      : Number.isNaN(ownEndAnchors[li])
        ? nextStart
        : Math.max(ownEndAnchors[li], s)
    const cappedEnd = Math.min(Math.max(endBase, s), nextStart)
    return buildLine(li, s, Math.max(s, cappedEnd))
  })
  return { lines, confidence }
}
