/** Shared LRC ground-truth helpers: parse synced LRC, match sheet rows to LRC
 * rows monotonically by text similarity, and score an alignment against that
 * truth. Used by scripts/audit-vs-lrc.mjs and tests/ai-pipeline/lrc-truth.test.ts.
 *
 * SCORING HAS TWO FRAMES, AND ONLY ONE OF THEM DECIDES.
 *
 *  - absolute: |our startTime − truth|. This is what a listener hears; it
 *    includes any constant whole-song lag or lead. This is the gate.
 *  - residual: |our startTime − (truth + offset)|, where `offset` is the robust
 *    median of (matched-evidence time − truth). Before 2026-09-28 this was the
 *    ONLY frame, which meant a uniform desync — the most audible timing defect
 *    there is — scored as exactly 0.00s of error. Retained because it separates
 *    "we inherited a constant offset" from "our relative structure is wrong".
 *    Never asserted on its own.
 *
 * The offset is returned so callers can assert it: on a version-exact fixture it
 * should be ~0, and a non-zero value is our measured systematic bias rather than
 * a property of the recording. Where a fixture's audio is a different edit than
 * the LRC, part of it is a genuine version difference — so each song's bound is
 * set from that song's own documented version status. */
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

/** Sorted-copy percentile, matching the convention the truth instrument has
 * always used (for p=0.9 and n=36 this is index 32, not the interpolated 0.9
 * quantile) so historical numbers stay comparable. */
export function percentile(xs, p) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}

export function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Coverage floor for a line's matched span to be trusted as evidence — for the
 * offset fit AND for the transcript-error column. Unchanged from the original
 * instrument (`audit-vs-lrc.mjs`) so the offset stays comparable across rounds. */
export const EVIDENCE_MIN_COVERAGE = 0.5

/**
 * Score an alignment against LRC truth in both frames.
 *
 * @param lines      aligned rows, `{ startTime }` (or anything with a numeric startTime)
 * @param spans      parallel `LineMatchedSpan[]` (`{ firstTime, matchedChars, totalChars }`)
 * @param truthTime  parallel `(number|null)[]` from `matchSheetToLrc`
 * @param opts.lineTexts  for the worst-line report only
 */
export function scoreAgainstTruth(lines, spans, truthTime, opts = {}) {
  const lineTexts = opts.lineTexts ?? []
  const coverage = (s) => (s ? s.matchedChars / Math.max(1, s.totalChars) : 0)

  // The offset is fitted on confident evidence only, exactly as before.
  const diffs = []
  for (let i = 0; i < lines.length; i++) {
    if (truthTime[i] == null) continue
    const s = spans[i]
    if (!s || s.firstTime == null) continue
    if (coverage(s) < EVIDENCE_MIN_COVERAGE) continue
    diffs.push(s.firstTime - truthTime[i])
  }
  const offset = median(diffs) ?? 0

  const residual = []
  const absolute = []
  const signed = []
  const transcript = []
  const worst = []
  // Partition by whether the transcript carried usable evidence for the line.
  // Both halves are reported, because they answer different questions:
  //  - `absolute` (all lines with truth) is what the listener hears — the
  //    headline, and what the experience must improve.
  //  - `ev*` (lines the transcript could vouch for) is what the aligner can be
  //    held accountable for, and is asserted tightly.
  //  - `noEvidence` is counted and bounded, so lines cannot be made
  //    un-anchorable to escape the tight bounds.
  const evAbsolute = []
  let noEvidenceCount = 0
  let noEvidenceWorst = 0
  for (let i = 0; i < lines.length; i++) {
    const t = truthTime[i]
    if (t == null) continue
    const s = spans[i]
    const confident = !!(s && s.firstTime != null && coverage(s) >= EVIDENCE_MIN_COVERAGE)
    if (confident) {
      transcript.push(Math.abs(s.firstTime - (t + offset)))
    } else {
      noEvidenceCount++
    }
    residual.push(Math.abs(lines[i].startTime - (t + offset)))
    const abs = Math.abs(lines[i].startTime - t)
    absolute.push(abs)
    if (confident) evAbsolute.push(abs)
    else noEvidenceWorst = Math.max(noEvidenceWorst, abs)
    signed.push(lines[i].startTime - t)
    worst.push({ index: i, error: +abs.toFixed(2), text: (lineTexts[i] ?? '').slice(0, 22) })
  }
  worst.sort((a, b) => b.error - a.error)

  const fracOf = (xs, t) => (xs.length ? xs.filter((e) => e <= t).length / xs.length : null)

  return {
    // --- the reported, assertable systematic offset ---
    offset,
    nOffsetPairs: diffs.length,
    // --- absolute frame, all truth lines: the headline ---
    n: absolute.length,
    absP50: median(absolute),
    absP90: percentile(absolute, 0.9),
    absWorst: absolute.length ? Math.max(...absolute) : null,
    absMean: absolute.length ? absolute.reduce((a, b) => a + b, 0) / absolute.length : null,
    fracWithin250: fracOf(absolute, 0.25),
    fracWithin500: fracOf(absolute, 0.5),
    fracWithin1000: fracOf(absolute, 1),
    signedMean: signed.length ? signed.reduce((a, b) => a + b, 0) / signed.length : null,
    // --- absolute frame, evidence-backed lines only: the aligner's accountability ---
    nEvidence: evAbsolute.length,
    evP50: median(evAbsolute),
    evP90: percentile(evAbsolute, 0.9),
    evWorst: evAbsolute.length ? Math.max(...evAbsolute) : null,
    evFracWithin250: fracOf(evAbsolute, 0.25),
    evFracWithin500: fracOf(evAbsolute, 0.5),
    // --- the lines no transcript evidence could reach: bounded, never ignored ---
    nNoEvidence: noEvidenceCount,
    noEvidenceWorst,
    // --- residual frame: diagnostic only ---
    resP50: median(residual),
    resP90: percentile(residual, 0.9),
    resWorst: residual.length ? Math.max(...residual) : null,
    resOver1s: residual.filter((e) => e > 1).length,
    // --- transcript evidence, also in the residual frame ---
    nTranscript: transcript.length,
    transcriptP50: median(transcript),
    transcriptP90: percentile(transcript, 0.9),
    // --- details ---
    over1s: absolute.filter((e) => e > 1).length,
    worst: worst.slice(0, 5),
  }
}

