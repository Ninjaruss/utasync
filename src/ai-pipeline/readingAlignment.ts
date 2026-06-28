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
