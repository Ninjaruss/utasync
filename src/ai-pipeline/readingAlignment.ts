/** One column of a global alignment. `a`/`b` are indices into the input strings,
 * or -1 when that side is a gap. */
export interface AlignColumn { a: number; b: number }

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
