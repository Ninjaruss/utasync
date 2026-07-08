import type { Language, LineAlignmentQuality, TimedLine } from '../core/types'
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
  // Whisper segment output on AKFG / similar J-rock (measured on First Take audit).
  ['超え', '越え'],
  ['堅い', '固い'],
  ['堅', '固'],
  ['顔', '丘'],
  ['わけ', '理由'],
  // AKFG First Take bridge — Whisper consistently mishears this phrase.
  ['鼓動', '孤独'],
  ['浅く出す', '暴き出す'],
  ['明日を', '朝だ'],
  // AKFG First Take chorus — Whisper segment mishearings (UserRockRoll audit).
  ['ロリーロリー', 'ローリングローリング'],
  ['どころから待って', '心絡まって'],
  ['ここから待ってるように', '心絡まって'],
  ['初めからもない', '初めから持ってない'],
  ['傷つく地面', '凍てつく地面'],
  ['体のように', '転がるように'],
  ['痛つく世界', '凍てつく世界'],
  ['楽しみも', 'この先も'],
  ['軽くて色に', '転がるように'],
  ['なくされちゃえも', 'なくした'],
  ['わからないんだろうに', 'わからないんだ'],
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
// `time` is the char's sung *onset* (used to anchor line starts); `endTime` is
// where the char stops being sung (used to anchor line ends). They differ for a
// drawn-out closing mora — a single held token like も spanning 157.5→159s — and
// keeping them apart stops a line from ending at the instant its last syllable
// merely begins (which clipped the held tail off AB-loops / exports).
interface TransChar { ch: string; time: number; endTime: number }

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
      // Char offset: the last char owns the word's real end (a held final mora
      // keeps its full duration); interior chars split the span evenly.
      const endTime = j === k - 1 ? w.endTime : w.startTime + duration * ((j + 1) / k)
      out.push({ ch, time, endTime })
      j++
    }
  }
  return out
}

interface LcsMatch {
  /** Matched transcript *onset* per lyric char index, or -1 (monotonic by construction). */
  matchTime: Float64Array
  /** Matched transcript *offset* per lyric char index, or -1 — where the char stops being sung. */
  matchEndTime: Float64Array
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
  const matchEndTime = new Float64Array(m).fill(-1)
  const matchBIndex = new Int32Array(m).fill(-1)
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (A[i - 1].ch === B[j - 1].ch) {
      matchTime[i - 1] = B[j - 1].time
      matchEndTime[i - 1] = B[j - 1].endTime
      matchBIndex[i - 1] = j - 1
      i--; j--
    }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  return { matchTime, matchEndTime, matchBIndex }
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
  /** Lyric-char (A) index of this run's last matched char. */
  endLyricIdx: number
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
  return {
    startTime: best[0].startTime,
    endTime: best[best.length - 1].endTime,
    length: bestChars,
    endLyricIdx: best[best.length - 1].endLyricIdx,
  }
}

/** Reliable (MIN_RELIABLE_RUN+) contiguous matched-char runs per lyric line. */
function collectReliableRunsByLine(A: LyricChar[], match: LcsMatch, lineCount: number): ReliableRun[][] {
  const { matchTime, matchEndTime, matchBIndex } = match
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
      runsByLine[li].push({
        // Start at the first char's onset, end at the last char's offset — so a
        // held closing mora keeps its full sung duration in the run's end time.
        startTime: matchTime[runStart],
        endTime: matchEndTime[idx - 1],
        length: runLength,
        endLyricIdx: idx - 1,
      })
    }
    runStart = idx
  }
  return runsByLine
}

// Reliable (MIN_RELIABLE_RUN+ consecutive matched chars) start/end anchors per line.
function anchorsByLine(A: LyricChar[], match: LcsMatch, lineCount: number): LineAnchors {
  const runsByLine = collectReliableRunsByLine(A, match, lineCount)
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
  /** Trailing glyphs past the reliable-run end — includes isolated coincidental
   * matches the reliable run excludes (so a stray final-mora match can't hide a
   * line's unanchored drawn-out tail the way unmatchedTail does). */
  unreliableTail: number
  firstMatchedTime: number
  lastMatchedTime: number
}

/** Per-line LCS coverage — used to reserve time for lyric tails Whisper skipped. */
function lineCharStats(A: LyricChar[], match: LcsMatch, lineCount: number): LineCharStats[] {
  const stats: LineCharStats[] = Array.from({ length: lineCount }, () => ({
    matchedCount: 0,
    unmatchedHead: 0,
    unmatchedTail: 0,
    unreliableTail: 0,
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
  }
  // Sung-time bounds come from reliable runs only — isolated LCS coincidences on
  // common morae (の/を/て/…) across instrumental gaps must not stretch a line's
  // estimated end across 30s+ of unrelated audio (see Veil line 3 audit).
  const runsByLine = collectReliableRunsByLine(A, match, lineCount)
  for (let li = 0; li < lineCount; li++) {
    if (runsByLine[li].length === 0) continue
    const { startTime, endTime, endLyricIdx } = strongestCluster(runsByLine[li])
    stats[li].firstMatchedTime = startTime
    stats[li].lastMatchedTime = endTime
    // Count this line's glyphs that fall after its reliable-run end. Unlike
    // unmatchedTail this includes isolated coincidental matches (common single
    // morae like て/た/の) the reliable run excludes, so a stray final-mora hit
    // can't mask a drawn-out tail and skip the orphan-gap fill below.
    let unreliable = 0
    for (let idx = A.length - 1; idx >= 0; idx--) {
      if (A[idx].line !== li) continue
      if (idx <= endLyricIdx) break
      unreliable++
    }
    stats[li].unreliableTail = unreliable
  }
  return stats
}

/** Typical sung span from glyph count — floors zero-duration lines on weak anchors. */
function minSungDuration(lineText: string): number {
  const glyphs = normalizeForMatch(lineText).length
  return Math.max(0.8, Math.min(4.5, glyphs * 0.14))
}

/** Max orphan gap (seconds) a line will claim from trailing dropped syllables. A
 * larger gap is an instrumental break, not the line's sung tail. */
const ORPHAN_GAP_FILL_MAX_S = 4

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
  hasAnchor?: readonly boolean[],
): number {
  const { unmatchedHead, matchedCount, firstMatchedTime } = stats[li]
  let start = starts[li]
  if (unmatchedHead > 0 && matchedCount > 0 && Number.isFinite(firstMatchedTime)) {
    const end = estimatedLineEnd(li, starts, ownEndAnchors, stats, lineTexts, hasAnchor)
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
  hasAnchor?: readonly boolean[],
): number {
  const { matchedCount, unmatchedTail, lastMatchedTime } = stats[li]
  const ownEnd = ownEndAnchors[li]
  const trustTranscriptEnd = hasAnchor?.[li] !== false
  let end = Number.isNaN(ownEnd)
    ? trustTranscriptEnd ? lastMatchedTime : NaN
    : trustTranscriptEnd
      ? Math.max(ownEnd, lastMatchedTime)
      : ownEnd
  if (!Number.isFinite(end)) return NaN
  const start = starts[li]
  const tailReserve = Math.max(unmatchedTail, stats[li].unreliableTail)
  if (tailReserve > 0 && matchedCount > 0) {
    const sungSpan = Math.max(0, end - start)
    if (sungSpan > 0) end += sungSpan * (tailReserve / matchedCount)
  }
  const repFrac = lyricRepetitionTailFraction(lineTexts[li] ?? '')
  if (repFrac > 0 && end > start) {
    end += (end - start) * repFrac
  }
  return end
}

// Forward jumps beyond this after the previous line's vocal end are suspicious —
// real instrumental bridges between consecutive lyric rows are rarely 22s+.
const FORWARD_GAP_SOFT_CAP_S = 22
const FORWARD_GAP_WEAK_COVERAGE = 0.55
// A large unmatched lyric prefix means Whisper only caught a suffix elsewhere
// (often a chorus reprise at song end).
const FORWARD_GAP_HEAD_FRAC = 0.2

function lineMatchCoverage(li: number, stats: LineCharStats[], lineTexts: string[]): number {
  const glyphs = normalizeForMatch(lineTexts[li] ?? '').length
  if (glyphs === 0) return 0
  return stats[li].matchedCount / glyphs
}

function previousLineVocalEnd(
  li: number,
  anchors: Float64Array,
  ownEndAnchors: Float64Array,
): number {
  const end = ownEndAnchors[li]
  if (Number.isFinite(end)) return end
  const start = anchors[li]
  return Number.isFinite(start) ? start : NaN
}

/**
 * Drop start anchors that sit implausibly far after the previous line's vocal
 * end. LCS happily matches a later chorus reprise when Whisper skipped the
 * first singing (or only hallucinated the tail at song end).
 */
function rejectDistantForwardAnchors(
  anchors: Float64Array,
  ownEndAnchors: Float64Array,
  stats: LineCharStats[],
  lineTexts: string[],
): void {
  let lastKeptIdx = -1
  for (let li = 0; li < anchors.length; li++) {
    if (Number.isNaN(anchors[li])) continue
    if (lastKeptIdx >= 0) {
      const prevEnd = previousLineVocalEnd(lastKeptIdx, anchors, ownEndAnchors)
      if (Number.isFinite(prevEnd)) {
        const gap = anchors[li] - prevEnd
        const coverage = lineMatchCoverage(li, stats, lineTexts)
        const glyphs = normalizeForMatch(lineTexts[li] ?? '').length
        const headFrac = glyphs > 0 ? stats[li].unmatchedHead / glyphs : 0
        if (
          gap > FORWARD_GAP_SOFT_CAP_S
          && (coverage < FORWARD_GAP_WEAK_COVERAGE || headFrac > FORWARD_GAP_HEAD_FRAC)
        ) {
          anchors[li] = NaN
          ownEndAnchors[li] = NaN
          continue
        }
      }
    }
    lastKeptIdx = li
  }
}

/** Unanchored rows interpolated toward song end belong right after prior vocals. */
function clampUnanchoredForwardStarts(
  starts: number[],
  hasAnchor: readonly boolean[],
  ownEndAnchors: Float64Array,
  stats: LineCharStats[],
  lineTexts: string[],
): void {
  for (let li = 0; li < starts.length - 1; li++) {
    if (hasAnchor[li + 1]) continue
    const effEnd = estimatedLineEnd(li, starts, ownEndAnchors, stats, lineTexts, hasAnchor)
    if (!Number.isFinite(effEnd)) continue
    const fairStart = effEnd + Math.min(minSungDuration(lineTexts[li + 1] ?? ''), 4)
    if (starts[li + 1] > fairStart + 6) starts[li + 1] = fairStart
  }
  for (let li = 1; li < starts.length; li++) {
    if (starts[li] < starts[li - 1]) starts[li] = starts[li - 1]
  }
}

/** Push each line's start to at least the previous line's estimated vocal end. */
function strengthenLineBoundaries(
  starts: number[],
  ownEndAnchors: Float64Array,
  stats: LineCharStats[],
  lineTexts: string[],
  hasAnchor?: readonly boolean[],
): void {
  for (let li = 0; li < starts.length; li++) {
    starts[li] = estimatedLineStart(li, starts, ownEndAnchors, stats, lineTexts, hasAnchor)
  }
  for (let li = 0; li < starts.length - 1; li++) {
    const effEnd = estimatedLineEnd(li, starts, ownEndAnchors, stats, lineTexts, hasAnchor)
    if (!Number.isFinite(effEnd)) continue
    if (starts[li + 1] < effEnd) starts[li + 1] = effEnd
  }
  for (let li = 1; li < starts.length; li++) {
    if (!isInterjectionLyricLine(lineTexts[li])) continue
    const prevEnd = estimatedLineEnd(li - 1, starts, ownEndAnchors, stats, lineTexts, hasAnchor)
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
      const total = w.slice(l, n).reduce((a, b) => a + b, 0) || 1
      let acc = 0
      for (let k = l; k < n; k++) {
        acc += w[k]
        out[k] = left + (lastTime - left) * (acc / total)
      }
    }
    l = r
  }
  return out
}

export type LineAnchorSource = 'lcs' | 'interpolated' | 'interjection'

/** Minimum LCS coverage for a line to count as well-anchored (matches phrase re-align). */
export const LINE_QUALITY_MIN_COVERAGE = 0.55

export interface LineAlignmentScore {
  coverage: number
  anchorSource: LineAnchorSource
  quality: LineAlignmentQuality
}

export function qualityRank(quality: LineAlignmentQuality): number {
  if (quality === 'good') return 2
  if (quality === 'approximate') return 1
  return 0
}

function classifyLineQuality(anchorSource: LineAnchorSource, coverage: number): LineAlignmentQuality {
  if (anchorSource === 'interjection') return 'approximate'
  if (anchorSource === 'lcs' && coverage >= LINE_QUALITY_MIN_COVERAGE) return 'good'
  if (anchorSource === 'lcs' && coverage >= 0.35) return 'approximate'
  return 'needs_review'
}

/** Score how well lyric text correlates with transcript words in a time window. */
export function scoreLineAlignment(
  lineText: string,
  windowWords: TranscriptWord[],
  sourceLanguage: Language,
): LineAlignmentScore {
  const text = lineText.trim()
  if (!text || windowWords.length === 0) {
    return { coverage: 0, anchorSource: 'interpolated', quality: 'needs_review' }
  }
  const { confidence, anchorSources } = alignByContent([text], windowWords, undefined, sourceLanguage)
  const anchorSource = anchorSources[0]
  const coverage = confidence
  return { coverage, anchorSource, quality: classifyLineQuality(anchorSource, coverage) }
}

export interface LineMatchedSpan {
  /** Onset of the line's first reliably matched transcript char. */
  firstTime: number
  /** Offset of the line's last reliably matched transcript char. */
  lastEndTime: number
  matchedChars: number
  totalChars: number
}

/**
 * Per-line matched transcript span from the same char-LCS alignByContent uses.
 * Only runs of MIN_RELIABLE_RUN+ consecutive lyric chars matched to consecutive
 * transcript chars count (same coincidence filter as line anchoring). Null =
 * no reliable match for that line. Pass sanitized words (sanitizeTranscript)
 * for parity with the alignment pipeline.
 *
 * Unlike collectReliableRunsByLine there is no RUN_CLUSTER_GAP_S split: this
 * measures the whole-line matched span for audit metrics, so all reliable runs
 * on a line are merged rather than reduced to the strongest time-cluster.
 */
export function computeLineMatchedSpans(
  lineTexts: string[],
  words: TranscriptWord[],
): Array<LineMatchedSpan | null> {
  const totals = lineTexts.map((t) => normalizeForMatch(t).length)
  const A = buildLyricChars(lineTexts)
  const B = buildTransChars(words)
  const spans: Array<LineMatchedSpan | null> = lineTexts.map(() => null)
  if (A.length === 0 || B.length === 0) return spans
  const match = lcsMatchTimes(A, B)
  let i = 0
  while (i < A.length) {
    if (match.matchBIndex[i] < 0) {
      i++
      continue
    }
    let j = i + 1
    while (
      j < A.length &&
      match.matchBIndex[j] === match.matchBIndex[j - 1] + 1 &&
      A[j].line === A[j - 1].line
    ) j++
    if (j - i >= MIN_RELIABLE_RUN) {
      for (let k = i; k < j; k++) {
        const li = A[k].line
        const s = spans[li] ?? {
          firstTime: Infinity,
          lastEndTime: -Infinity,
          matchedChars: 0,
          totalChars: totals[li],
        }
        s.firstTime = Math.min(s.firstTime, match.matchTime[k])
        s.lastEndTime = Math.max(s.lastEndTime, match.matchEndTime[k])
        s.matchedChars++
        spans[li] = s
      }
    }
    i = j
  }
  return spans
}

export function alignByContent(
  lineTexts: string[],
  words: TranscriptWord[],
  existingLines: TimedLine[] | undefined,
  sourceLanguage: Language,
): { lines: TimedLine[]; confidence: number; anchorSources: LineAnchorSource[] } {
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
    return {
      lines: lineTexts.map((_, li) => buildLine(li, 0, 0)),
      confidence: 0,
      anchorSources: lineTexts.map(() => 'interpolated' as const),
    }
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
  rejectDistantForwardAnchors(anchors, ownEndAnchors, stats, lineTexts)
  const hasAnchor = Array.from(anchors, (a) => !Number.isNaN(a))
  const lastTime = B[B.length - 1].endTime
  const starts = interpolateAnchors(anchors, lineTexts, sourceLanguage, lastTime)

  strengthenLineBoundaries(starts, ownEndAnchors, stats, lineTexts, hasAnchor)
  clampUnanchoredForwardStarts(starts, hasAnchor, ownEndAnchors, stats, lineTexts)

  const lines = starts.map((s, li) => {
    const nextStart = li + 1 < starts.length ? starts[li + 1] : lastTime
    const effEnd = estimatedLineEnd(li, starts, ownEndAnchors, stats, lineTexts, hasAnchor)
    const endBase = Number.isFinite(effEnd)
      ? effEnd
      : Number.isNaN(ownEndAnchors[li])
        ? nextStart
        : Math.max(ownEndAnchors[li], s)
    const minEnd = s + Math.min(minSungDuration(lineTexts[li] ?? ''), Math.max(0, nextStart - s))
    const cappedEnd = Math.min(Math.max(endBase, minEnd), nextStart)
    // Orphan-gap fill: when Whisper mis-transcribed this line's tail (so its end
    // anchored early) and the next line is anchored and close, the untranscribed
    // trailing syllables are sung in the gap between them — claim it rather than
    // leaving a rest, so the line spans its real sung duration (tightens AB-loop /
    // export and the boundary on merged-segment splits like 角を曲がって｜此処…).
    const orphan = nextStart - cappedEnd
    const lineGlyphs = normalizeForMatch(lineTexts[li] ?? '').length
    const coverage = lineGlyphs > 0 ? stats[li].matchedCount / lineGlyphs : 0
    const weakTail =
      stats[li].unreliableTail > 0
      || stats[li].unmatchedTail > 0
      || (coverage > 0 && coverage < 0.82)
    const fillOrphan =
      li + 1 < starts.length &&
      weakTail &&
      hasAnchor[li] &&
      hasAnchor[li + 1] &&
      orphan > 0 &&
      orphan < ORPHAN_GAP_FILL_MAX_S
    return buildLine(li, s, Math.max(s, fillOrphan ? nextStart : cappedEnd))
  })
  const anchorSources: LineAnchorSource[] = lineTexts.map((text, li) => {
    if (isInterjectionLyricLine(text)) return 'interjection'
    return hasAnchor[li] ? 'lcs' : 'interpolated'
  })
  return { lines, confidence, anchorSources }
}
