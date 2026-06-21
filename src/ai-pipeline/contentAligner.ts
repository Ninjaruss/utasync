import type { Language, TimedLine } from '../core/types'
import { lineWeight, type TranscriptWord } from './aligner'

// Characters worth matching on: lowercase Latin letters and Japanese scripts
// (kana + prolonged mark + kanji blocks). Everything else (spaces, punctuation,
// full-width symbols) is dropped so it can't block a match.
const MATCH_CHAR = /[a-z぀-ヿー㐀-鿿豈-﫿]/

export function normalizeForMatch(text: string): string {
  let out = ''
  for (const ch of text.toLowerCase()) if (MATCH_CHAR.test(ch)) out += ch
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

// Earliest *reliably* matched time per line; NaN where a line had no run of
// MIN_RELIABLE_RUN+ consecutive matched chars.
function anchorsByLine(A: LyricChar[], match: LcsMatch, lineCount: number): Float64Array {
  const { matchTime, matchBIndex } = match
  const anchors = new Float64Array(lineCount).fill(NaN)
  const m = A.length
  let runStart = 0
  for (let idx = 0; idx <= m; idx++) {
    const continuesRun =
      idx < m
      && matchBIndex[idx] >= 0
      && idx > runStart
      && matchBIndex[idx] === matchBIndex[idx - 1] + 1
      && A[idx].line === A[idx - 1].line
    if (continuesRun) continue

    // Run [runStart, idx) just ended — commit it if long enough and matched.
    if (idx > runStart && matchBIndex[runStart] >= 0 && idx - runStart >= MIN_RELIABLE_RUN) {
      const li = A[runStart].line
      const mt = matchTime[runStart]
      if (Number.isNaN(anchors[li]) || mt < anchors[li]) anchors[li] = mt
    }
    runStart = idx
  }
  return anchors
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

  const anchors = anchorsByLine(A, match, lineCount)
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

  // Monotonic guard.
  for (let li = 1; li < starts.length; li++) if (starts[li] < starts[li - 1]) starts[li] = starts[li - 1]

  // Each line ends at the next line's start (a rest fills any instrumental gap);
  // the last line holds to the end of the transcript.
  const lines = starts.map((s, li) =>
    buildLine(li, s, li + 1 < starts.length ? Math.max(s, starts[li + 1]) : Math.max(s, lastTime)),
  )
  return { lines, confidence }
}
