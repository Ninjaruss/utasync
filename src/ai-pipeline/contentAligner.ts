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
    let j = 0
    for (const ch of n) {
      out.push({ ch, time: w.startTime + (w.endTime - w.startTime) * ((j + 0.5) / k) })
      j++
    }
  }
  return out
}

// Longest common subsequence over the two char streams. Returns, for each lyric
// char index, the matched transcript time or -1 (monotonic by construction).
function lcsMatchTimes(A: LyricChar[], B: TransChar[]): Float64Array {
  const m = A.length, n = B.length
  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))
  for (let i = 1; i <= m; i++) {
    const row = dp[i], prev = dp[i - 1]
    for (let j = 1; j <= n; j++) {
      row[j] = A[i - 1].ch === B[j - 1].ch ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1])
    }
  }
  const matchTime = new Float64Array(m).fill(-1)
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (A[i - 1].ch === B[j - 1].ch) { matchTime[i - 1] = B[j - 1].time; i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  return matchTime
}

// Earliest matched time per line; NaN where a line had no matched char.
function anchorsByLine(A: LyricChar[], matchTime: Float64Array, lineCount: number): Float64Array {
  const anchors = new Float64Array(lineCount).fill(NaN)
  for (let idx = 0; idx < A.length; idx++) {
    const mt = matchTime[idx]
    if (mt < 0) continue
    const li = A[idx].line
    if (Number.isNaN(anchors[li]) || mt < anchors[li]) anchors[li] = mt
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

  const matchTime = lcsMatchTimes(A, B)
  const matched = Array.from(matchTime).reduce((acc, t) => acc + (t >= 0 ? 1 : 0), 0)
  const confidence = matched / A.length

  const anchors = anchorsByLine(A, matchTime, lineCount)
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
