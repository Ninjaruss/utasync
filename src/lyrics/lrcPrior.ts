import type { TimedLine } from '../core/types'
import type { LineMatchedSpan } from '../ai-pipeline/contentAligner'
import { enforceLineMonotonicity } from './phraseAlignment'

/** Median of a numeric array (0 for empty). Does not mutate the input. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Ordinary least-squares fit y ≈ a·x + b. Falls back to unit slope when x has
 * ~no spread (all points at one prior time). */
export function lsFit(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length
  if (n === 0) return { a: 1, b: 0 }
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx)
    sxy += (xs[i] - mx) * (ys[i] - my)
  }
  if (sxx < 1e-6) return { a: 1, b: my - mx }
  const a = sxy / sxx
  return { a, b: my - a * mx }
}

/**
 * Robust affine map from prior (LRC) time to this-audio time: actual ≈ a·prior +
 * b, where a is the tempo scale and b the offset. Deterministic exhaustive
 * 2-point RANSAC over the confidently-matched, positively-timed pairs (songs have
 * ≤ ~60 lines, so enumerating all pairs is cheap and needs no PRNG), then a
 * least-squares refit on the winning inlier set. Robust past 40% outliers because
 * a clean inlier pair is always enumerated. Fallbacks: 0 pairs → identity; 1 pair
 * → unit-slope offset; no 2-inlier consensus → robust median offset.
 */
export function fitPriorTimeMap(
  priorTimes: number[],
  actualTimes: number[],
  coverage: number[],
  opts?: {
    minCoverage?: number
    inlierTolSec?: number
    minSlope?: number
    maxSlope?: number
    identityTolSec?: number
  },
): { a: number; b: number } {
  const COV = opts?.minCoverage ?? 0.5
  const TOL = opts?.inlierTolSec ?? 2.5
  const MINA = opts?.minSlope ?? 0.5
  const MAXA = opts?.maxSlope ?? 2.0
  const IDTOL = opts?.identityTolSec ?? 4

  const P: number[] = []
  const M: number[] = []
  for (let i = 0; i < priorTimes.length; i++) {
    if (coverage[i] >= COV && priorTimes[i] > 0) {
      P.push(priorTimes[i])
      M.push(actualTimes[i])
    }
  }
  const n = P.length
  if (n === 0) return { a: 1, b: 0 }
  if (n === 1) return { a: 1, b: M[0] - P[0] }

  // Regime decision. The median ABSOLUTE identity residual can't be inflated by a
  // minority of grossly-misplaced (bulged) lines, so a small value means the
  // recording already matches the prior's tempo. In that case use unit slope with
  // a robust offset over the identity-inliers (this rejects the bulge). Fitting a
  // free slope to noisy/bulged placements can otherwise lock onto a spurious
  // shallow line threading the bulge — the failure this guards against.
  const resid = P.map((p, i) => M[i] - p)
  const medAbs = median(resid.map((r) => Math.abs(r)))
  if (medAbs <= IDTOL) {
    const inl = resid.filter((r) => Math.abs(r) <= IDTOL)
    return { a: 1, b: inl.length ? median(inl) : 0 }
  }

  // Different-tempo regime: deterministic exhaustive 2-point RANSAC (slope-banded)
  // + least-squares refit on the winning inlier set.
  let best: number[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dp = P[j] - P[i]
      if (Math.abs(dp) < 1e-6) continue
      const a = (M[j] - M[i]) / dp
      if (a < MINA || a > MAXA) continue
      const b = M[i] - a * P[i]
      const inliers: number[] = []
      for (let k = 0; k < n; k++) {
        if (Math.abs(M[k] - (a * P[k] + b)) <= TOL) inliers.push(k)
      }
      if (inliers.length > best.length) best = inliers
    }
  }
  if (best.length < 2) return { a: 1, b: median(resid) }
  return lsFit(best.map((k) => P[k]), best.map((k) => M[k]))
}

/**
 * Constrain aligned lines to a timing prior (the song's existing line times, from
 * a pasted LRC / subtitle / prior alignment). Rescales the prior onto this audio
 * (fitPriorTimeMap), then for each line keeps its confident placement when it
 * agrees with the rescaled prior (within toleranceSec) and otherwise snaps it to
 * the prior. Guards: with no positive prior time the pass leaves lines untouched
 * (nothing to constrain). Pure; returns a new array; enforces monotonicity.
 */
export function applyLrcPrior(
  lines: TimedLine[],
  spans: Array<LineMatchedSpan | null>,
  priorTimes: number[],
  opts?: { toleranceSec?: number; minCoverage?: number },
): TimedLine[] {
  const T = opts?.toleranceSec ?? 2.5
  const COV = opts?.minCoverage ?? 0.5
  if (!priorTimes.some((t) => t > 0)) return lines

  // Defensive: the caller guarantees equal lengths, but a mismatched call would
  // index past an array and write NaN startTimes; leave the lines untouched.
  if (spans.length !== lines.length || priorTimes.length !== lines.length) return lines

  const coverage = spans.map((s) => (s ? s.matchedChars / Math.max(1, s.totalChars) : 0))
  const actual = lines.map((l) => l.startTime)
  const { a, b } = fitPriorTimeMap(priorTimes, actual, coverage, { minCoverage: COV, inlierTolSec: T })

  const out = lines.map((l) => ({ ...l }))
  for (let i = 0; i < out.length; i++) {
    const expected = a * priorTimes[i] + b
    const keep = coverage[i] >= COV && Math.abs(actual[i] - expected) <= T
    out[i].startTime = keep ? actual[i] : expected
  }
  enforceLineMonotonicity(out)
  return out
}
