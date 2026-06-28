import type { Token } from '../core/types'
import { katakanaToHiragana } from '../language/japanese/phonetics'

/** One column of a global alignment. `a`/`b` are indices into the input strings,
 * or -1 when that side is a gap. */
export interface AlignColumn { a: number; b: number }

const KANJI_RE = /[㐀-鿿]/

const MATCH = 2
const MISMATCH = -1
const GAP = -1

/** Needleman–Wunsch global alignment of two kana strings. Returns the alignment
 * path as ordered columns. Matching characters dominate, so shared kana anchor the
 * frame and substitutions/indels fall into the gaps between anchors. */
export function nwAlign(A: string, B: string): AlignColumn[] {
  const n = A.length
  const m = B.length
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i++) score[i][0] = i * GAP
  for (let j = 1; j <= m; j++) score[0][j] = j * GAP
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = score[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? MATCH : MISMATCH)
      score[i][j] = Math.max(diag, score[i - 1][j] + GAP, score[i][j - 1] + GAP)
    }
  }
  const cols: AlignColumn[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && score[i][j] === score[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? MATCH : MISMATCH)) {
      cols.push({ a: i - 1, b: j - 1 }); i--; j--
    } else if (i > 0 && score[i][j] === score[i - 1][j] + GAP) {
      cols.push({ a: i - 1, b: -1 }); i--
    } else {
      cols.push({ a: -1, b: j - 1 }); j--
    }
  }
  cols.reverse()
  return cols
}

/** Hiragana-only comparable form: katakana→hiragana, NFKC, drop the long-sound mark,
 * keep only hiragana. Mirrors readingReconciler.normalizeKanaForCompare. */
export function comparableKana(text: string): string {
  let out = ''
  for (const ch of katakanaToHiragana(text).normalize('NFKC')) {
    if (ch === 'ー') continue
    if (/[ぁ-ん]/.test(ch)) out += ch
  }
  return out
}

/** Build the line's expected kana string `a` (concatenated dictionary readings) plus
 * `owner`, mapping each kana position back to its source token index. Kana-only
 * tokens contribute their own reading; tokens with no usable kana contribute nothing. */
export function buildExpectedKana(tokens: Token[]): { a: string; owner: number[] } {
  let a = ''
  const owner: number[] = []
  tokens.forEach((t, idx) => {
    const source = t.reading ?? (KANJI_RE.test(t.surface) ? '' : t.surface)
    for (const ch of comparableKana(source)) { a += ch; owner.push(idx) }
  })
  return { a, owner }
}

/** Fraction of a token's reading kana that must match to call the dictionary confirmed. */
const VERIFY_MATCH_RATIO = 0.6

export type ReadingDecisionKind = 'verified' | 'adopt' | 'mismatch' | 'neutral' | 'skip'

export interface ReadingDecision {
  kind: ReadingDecisionKind
  /** Hiragana sung reading, only for kind === 'adopt'. */
  audioReading?: string
  confidence?: number
}

function kanjiRunOf(surface: string): string {
  return [...surface].filter((ch) => KANJI_RE.test(ch)).join('')
}

export function resolveLineReadings(tokens: Token[], windowText: string): ReadingDecision[] {
  const decisions: ReadingDecision[] = tokens.map(() => ({ kind: 'skip' as ReadingDecisionKind }))
  const { a: A, owner } = buildExpectedKana(tokens)
  const B = comparableKana(windowText)

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx]
    if (!KANJI_RE.test(token.surface) || !token.reading) { decisions[idx] = { kind: 'skip' }; continue }
    const kanji = kanjiRunOf(token.surface)
    if (kanji && windowText.includes(kanji)) { decisions[idx] = { kind: 'verified', confidence: 1 }; continue }
    decisions[idx] = { kind: 'neutral' }
  }

  if (!A || !B) return decisions
  const cols = nwAlign(A, B)
  const colOfA: number[] = new Array(A.length).fill(-1)
  cols.forEach((c, k) => { if (c.a >= 0) colOfA[c.a] = k })
  let lineMatches = 0
  for (const c of cols) if (c.a >= 0 && c.b >= 0 && A[c.a] === B[c.b]) lineMatches++

  for (let idx = 0; idx < tokens.length; idx++) {
    if (decisions[idx].kind !== 'neutral') continue // skip / verified-by-kanji already set
    const token = tokens[idx]
    const aIdxs: number[] = []
    owner.forEach((o, ai) => { if (o === idx) aIdxs.push(ai) })
    if (aIdxs.length === 0) continue
    const firstCol = colOfA[aIdxs[0]]
    const lastCol = colOfA[aIdxs[aIdxs.length - 1]]

    let span = ''
    let tokMatches = 0
    for (let k = firstCol; k <= lastCol; k++) {
      const c = cols[k]
      if (c.b >= 0) span += B[c.b]
      if (c.a >= 0 && c.b >= 0 && A[c.a] === B[c.b]) tokMatches++
    }
    const R = comparableKana(token.reading!)
    const matchRatio = R.length ? tokMatches / R.length : 0
    if (matchRatio >= VERIFY_MATCH_RATIO) {
      decisions[idx] = { kind: 'verified', confidence: Math.min(1, matchRatio) }
    }
    // adoption/mismatch handled in Task 4
  }

  return decisions
}
