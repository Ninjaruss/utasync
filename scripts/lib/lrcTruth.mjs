/** Shared LRC ground-truth helpers: parse synced LRC and match sheet rows to
 * LRC rows monotonically by text similarity. Used by scripts/audit-vs-lrc.mjs
 * and tests/ai-pipeline/lrc-truth.test.ts. */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const { normalizeForMatch } = await import(
  pathToFileURL(join(root, 'src/ai-pipeline/contentAligner.ts')).href
)

/** Parse "[mm:ss.xx] text" LRC into { time, text } rows (non-empty text only). */
export function parseLrc(synced) {
  const rows = []
  for (const line of synced.split('\n')) {
    const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/)
    if (!m) continue
    const text = m[3].trim()
    if (!text) continue
    rows.push({ time: Number(m[1]) * 60 + Number(m[2]), text })
  }
  return rows
}

/** Char-bigram similarity of normalized texts (robust to punctuation/casing). */
function similarity(a, b) {
  const na = normalizeForMatch(a)
  const nb = normalizeForMatch(b)
  if (!na || !nb) return 0
  const grams = (s) => {
    const g = new Map()
    for (let i = 0; i < s.length - 1; i++) {
      const k = s.slice(i, i + 2)
      g.set(k, (g.get(k) ?? 0) + 1)
    }
    return g
  }
  const ga = grams(na)
  const gb = grams(nb)
  let inter = 0
  for (const [k, c] of ga) inter += Math.min(c, gb.get(k) ?? 0)
  const total = Math.max(1, Math.max(na.length, nb.length) - 1)
  return inter / total
}

const MATCH_MIN_SIM = 0.5

/** Monotonic sheet-row → LRC-row matching maximizing total similarity (DP). */
export function matchSheetToLrc(sheetLines, lrcRows) {
  const n = sheetLines.length
  const m = lrcRows.length
  const sim = Array.from({ length: n }, (_, i) => lrcRows.map((r) => similarity(sheetLines[i], r.text)))
  // dp[i][j]: best score using sheet[0..i), lrc[0..j)
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  const choice = Array.from({ length: n + 1 }, () => new Int8Array(m + 1))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = dp[i - 1][j] // skip sheet line
      let ch = 1
      if (dp[i][j - 1] > best) { best = dp[i][j - 1]; ch = 2 } // skip lrc row
      const s = sim[i - 1][j - 1]
      if (s >= MATCH_MIN_SIM && dp[i - 1][j - 1] + s > best) { best = dp[i - 1][j - 1] + s; ch = 3 }
      dp[i][j] = best
      choice[i][j] = ch
    }
  }
  const truthTime = new Array(n).fill(null)
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (choice[i][j] === 3) { truthTime[i - 1] = lrcRows[j - 1].time; i--; j-- }
    else if (choice[i][j] === 2) j--
    else i--
  }
  return truthTime
}

