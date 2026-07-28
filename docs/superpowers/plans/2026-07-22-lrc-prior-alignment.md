# LRC-Prior Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use a song's existing line timing (pasted LRC / subtitle / prior alignment) as a monotonic prior that constrains auto-alignment, so a confident-but-wrong transcript match can no longer drop a line onto entirely different content.

**Architecture:** A pure module `src/lyrics/lrcPrior.ts` with `fitPriorTimeMap` (deterministic exhaustive 2-point RANSAC affine `actual ≈ a·prior + b`, robust past 40% outliers, tempo-capable) and `applyLrcPrior` (rescale the prior onto this audio, then per-line keep-match-or-fall-back-to-prior + monotonicity). Wired into `AutoAlignFlow` as a late guardrail after gap-recovery; no-op for plain-text songs so the offline corpus is byte-identical. Validated offline against a Recollect fixture built from real diagnostic data.

**Tech Stack:** TypeScript, React, Vitest. Reuses `computeLineMatchedSpans` (`src/ai-pipeline/contentAligner.ts`, type `LineMatchedSpan = { firstTime; lastEndTime; matchedChars; totalChars }`), `enforceLineMonotonicity` (`src/lyrics/phraseAlignment.ts`), `sanitizeTranscript` (already imported in AutoAlignFlow).

**Standing constraint:** All commits UNSIGNED — `git commit --no-gpg-sign`. Commit only when the user has asked; if unsure, pause.

**Scope:** Phase 1 = a single affine (uniform tempo) prior, automatic whenever a song carries timing. Deferred (documented, not built): the explicit three-way "Align using these as a guide" paste button (the behavior is reachable via Edit-mode Re-align today), and piecewise/tempo-drift maps.

---

## File Structure

- `src/lyrics/lrcPrior.ts` — NEW. `median`, `lsFit`, `fitPriorTimeMap`, `applyLrcPrior`. All pure.
- `src/ai-pipeline/AutoAlignFlow.tsx` — MODIFY. Import + one guardrail block after gap-recovery (after line 446).
- `tests/lyrics/lrcPrior.test.ts` — NEW. Unit tests for the fit + gate.
- `tests/lyrics/lrcPrior.recollect.test.ts` — NEW. The real-data fixture proof.

---

### Task 1: Robust affine fit (`fitPriorTimeMap`)

**Files:**
- Create: `src/lyrics/lrcPrior.ts`
- Test: `tests/lyrics/lrcPrior.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lyrics/lrcPrior.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fitPriorTimeMap } from '../../src/lyrics/lrcPrior'

describe('fitPriorTimeMap', () => {
  const allCovered = (n: number) => Array<number>(n).fill(1)

  it('recovers identity for same-tempo pairs', () => {
    const prior = [2, 5, 9, 14, 20]
    const actual = [2.1, 4.9, 9.1, 13.8, 20.2]
    const { a, b } = fitPriorTimeMap(prior, actual, allCovered(5))
    expect(a).toBeCloseTo(1, 1)
    expect(Math.abs(b)).toBeLessThan(0.5)
  })

  it('recovers a tempo scale + offset', () => {
    const prior = [10, 20, 30, 40, 50]
    const actual = prior.map((p) => 1.3 * p + 4) // a=1.3, b=4
    const { a, b } = fitPriorTimeMap(prior, actual, allCovered(5))
    expect(a).toBeCloseTo(1.3, 1)
    expect(b).toBeCloseTo(4, 0)
  })

  it('is robust when 40% of confident pairs are late outliers', () => {
    // 6 correct (y≈x) + 4 late-by-12 outliers = 40% contamination.
    const prior = [5, 10, 15, 40, 60, 80, 20, 25, 30, 35]
    const actual = [5, 10, 15, 40, 60, 80, 32, 37, 42, 47] // last 4 are +12 late
    const { a, b } = fitPriorTimeMap(prior, actual, allCovered(10))
    expect(a).toBeCloseTo(1, 1)
    expect(Math.abs(b)).toBeLessThan(1)
  })

  it('ignores low-coverage pairs', () => {
    const prior = [5, 10, 15, 20]
    const actual = [5, 10, 999, 20] // line 2 is garbage but low coverage
    const cov = [1, 1, 0.1, 1]
    const { a, b } = fitPriorTimeMap(prior, actual, cov)
    expect(a).toBeCloseTo(1, 1)
    expect(Math.abs(b)).toBeLessThan(0.5)
  })

  it('returns identity with no confident pairs', () => {
    expect(fitPriorTimeMap([5, 10], [5, 10], [0, 0])).toEqual({ a: 1, b: 0 })
  })

  it('returns a pure offset with a single confident pair', () => {
    expect(fitPriorTimeMap([10], [13], [1])).toEqual({ a: 1, b: 3 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lyrics/lrcPrior.test.ts`
Expected: FAIL — cannot find module `lrcPrior`.

- [ ] **Step 3: Implement `fitPriorTimeMap`**

Create `src/lyrics/lrcPrior.ts` (no imports needed yet — these three functions are pure number math; Task 2 adds the type/util imports it needs):

```ts
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
  opts?: { minCoverage?: number; inlierTolSec?: number; minSlope?: number; maxSlope?: number },
): { a: number; b: number } {
  const COV = opts?.minCoverage ?? 0.5
  const TOL = opts?.inlierTolSec ?? 2.5
  const MINA = opts?.minSlope ?? 0.5
  const MAXA = opts?.maxSlope ?? 2.0

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

  if (best.length < 2) {
    return { a: 1, b: median(P.map((p, i) => M[i] - p)) }
  }
  return lsFit(best.map((k) => P[k]), best.map((k) => M[k]))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lyrics/lrcPrior.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc -b && npx eslint src/lyrics/lrcPrior.ts tests/lyrics/lrcPrior.test.ts`
Expected: exit 0. (Task 1's file has no imports, so no unused-import risk; Task 2 adds the type/util imports when `applyLrcPrior` needs them.)

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/lrcPrior.ts tests/lyrics/lrcPrior.test.ts
git commit --no-gpg-sign -m "feat(align): robust affine prior-time map (exhaustive RANSAC)"
```

---

### Task 2: The prior gate (`applyLrcPrior`)

**Files:**
- Modify: `src/lyrics/lrcPrior.ts` (add `applyLrcPrior`)
- Test: `tests/lyrics/lrcPrior.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `tests/lyrics/lrcPrior.test.ts` (extend the import to include `applyLrcPrior`, and add the imports for the helpers below):

```ts
import { applyLrcPrior } from '../../src/lyrics/lrcPrior'
import type { TimedLine } from '../../src/core/types'
import type { LineMatchedSpan } from '../../src/ai-pipeline/contentAligner'

const line = (original: string, startTime: number): TimedLine => ({
  original, translation: '', startTime, endTime: startTime + 2,
})
const span = (coverage: number, firstTime = 0): LineMatchedSpan => ({
  firstTime, lastEndTime: firstTime + 1, matchedChars: Math.round(coverage * 100), totalChars: 100,
})

describe('applyLrcPrior', () => {
  it('keeps a confident placement that agrees with the prior', () => {
    const lines = [line('a', 2.1), line('b', 5.2), line('c', 9.0)]
    const spans = [span(1), span(1), span(1)]
    const prior = [2, 5, 9]
    const out = applyLrcPrior(lines, spans, prior)
    expect(out.map((l) => l.startTime)).toEqual([2.1, 5.2, 9.0])
  })

  it('rejects a confident placement 12s away and snaps it to the prior', () => {
    const lines = [line('a', 2), line('b', 5), line('c', 21), line('d', 14)]
    const spans = [span(1), span(1), span(1, 21), span(1)] // line c falsely matched at 21
    const prior = [2, 5, 9, 14]
    const out = applyLrcPrior(lines, spans, prior)
    expect(out[2].startTime).toBeCloseTo(9, 0) // snapped back to ~prior, not 21
    expect(out[2].startTime).toBeLessThan(14) // and monotonic before line d
  })

  it('uses the prior for a low-coverage line regardless of its placement', () => {
    const lines = [line('a', 2), line('b', 40), line('c', 12)]
    const spans = [span(1), span(0.1, 40), span(1)] // line b is garbage, low coverage
    const prior = [2, 7, 12]
    const out = applyLrcPrior(lines, spans, prior)
    expect(out[1].startTime).toBeCloseTo(7, 0)
  })

  it('is a no-op-shaped pass when there is no usable prior (all zero)', () => {
    const lines = [line('a', 3), line('b', 8)]
    const spans = [span(1, 3), span(1, 8)]
    const out = applyLrcPrior(lines, spans, [0, 0])
    // No prior signal → map is identity, expected=0 for both, but placements are
    // confident and far from 0, so they are... rejected to 0? Guard: with no
    // positive prior, applyLrcPrior must leave the lines untouched.
    expect(out.map((l) => l.startTime)).toEqual([3, 8])
  })

  it('rescales the prior for a slower recording before gating', () => {
    // Audio runs 1.25x slower than the LRC; every line confidently matches there.
    const prior = [4, 8, 12, 16, 20]
    const lines = prior.map((p, i) => line(String(i), 1.25 * p))
    const spans = prior.map(() => span(1))
    const out = applyLrcPrior(lines, spans, prior)
    out.forEach((l, i) => expect(l.startTime).toBeCloseTo(1.25 * prior[i], 0))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lyrics/lrcPrior.test.ts`
Expected: FAIL — `applyLrcPrior is not a function`.

- [ ] **Step 3: Implement `applyLrcPrior`**

First add these imports at the **top** of `src/lyrics/lrcPrior.ts` (above `median`):

```ts
import type { TimedLine } from '../core/types'
import type { LineMatchedSpan } from '../ai-pipeline/contentAligner'
import { enforceLineMonotonicity } from './phraseAlignment'
```

(No circular import: `phraseAlignment` and `contentAligner` do not import `lrcPrior`.)

Then append to `src/lyrics/lrcPrior.ts`:

```ts
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
  // Nothing to constrain if the prior carries no positive times.
  if (!priorTimes.some((t) => t > 0)) return lines

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lyrics/lrcPrior.test.ts`
Expected: PASS (all fit + gate tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc -b && npx eslint src/lyrics/lrcPrior.ts tests/lyrics/lrcPrior.test.ts`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/lrcPrior.ts tests/lyrics/lrcPrior.test.ts
git commit --no-gpg-sign -m "feat(align): applyLrcPrior gate (keep-match-or-snap-to-prior)"
```

---

### Task 3: Recollect real-data fixture (the measurable proof)

**Files:**
- Test: `tests/lyrics/lrcPrior.recollect.test.ts`

This fixture is the per-line data from the `[bulge-diag]` run (placements + coverage) plus the user's LRC truth, for lines #0–#26 (opening + the first rap bulge). It proves `applyLrcPrior` turns the +12s bulge into ≤~2s placement.

- [ ] **Step 1: Write the test**

Create `tests/lyrics/lrcPrior.recollect.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyLrcPrior } from '../../src/lyrics/lrcPrior'
import type { TimedLine } from '../../src/core/types'
import type { LineMatchedSpan } from '../../src/ai-pipeline/contentAligner'

// Recollect lines #0-#26 as the aligner actually placed them (the +12s bulge is
// #5-#14), with per-line content-match coverage, both from the [bulge-diag] run.
const placement = [
  0.0, 6.4, 12.0, 13.1, 16.3, 26.9, 34.2, 38.3, 41.0, 46.3, 47.1, 49.2, 49.6,
  50.6, 52.3, 54.3, 55.4, 59.1, 62.8, 65.3, 74.2, 75.4, 76.3, 77.5, 80.2, 81.4, 96.0,
]
const coverage = [
  1.0, 1.0, 1.0, 1.0, 1.0, 0.21, 0.23, 1.0, 0.95, 1.0, 1.0, 1.0, 1.0, 1.0, 0.92,
  1.0, 1.0, 0.96, 0.59, 0.38, 0.0, 0.07, 0.86, 0.88, 0.0, 0.13, 0.57,
]
// The user's LRC truth for the same 27 lines (the prior).
const truth = [
  3.72, 6.76, 10.08, 13.56, 16.8, 20.24, 23.52, 27.0, 29.8, 33.48, 36.16, 40.08,
  43.2, 45.64, 49.24, 52.72, 57.08, 59.76, 63.0, 65.96, 69.28, 71.52, 73.72,
  75.52, 77.64, 78.24, 93.4,
]

const lines: TimedLine[] = placement.map((t, i) => ({
  original: `line ${i}`, translation: '', startTime: t, endTime: t + 2,
}))
const spans: Array<LineMatchedSpan | null> = coverage.map((c, i) =>
  c > 0 ? { firstTime: placement[i], lastEndTime: placement[i] + 1, matchedChars: Math.round(c * 100), totalChars: 100 } : null,
)

describe('applyLrcPrior on the real Recollect bulge', () => {
  const out = applyLrcPrior(lines, spans, truth)
  const err = out.map((l, i) => Math.abs(l.startTime - truth[i]))

  it('collapses the +12s bulge (#5-#14) to within 3s of truth', () => {
    for (let i = 5; i <= 14; i++) {
      expect(err[i], `line #${i} err`).toBeLessThan(3)
    }
  })

  it('leaves the already-correct lines close to truth', () => {
    for (const i of [1, 2, 3, 4, 15, 16, 17]) {
      expect(err[i], `line #${i} err`).toBeLessThan(3)
    }
  })

  it('drops the whole-section mean error well below the pre-fix ~4s', () => {
    const mean = err.reduce((s, e) => s + e, 0) / err.length
    expect(mean).toBeLessThan(2)
  })

  it('keeps the result monotonic', () => {
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    }
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/lyrics/lrcPrior.recollect.test.ts`
Expected: PASS. If a bulge line still exceeds 3s, the affine fit picked a contaminated model — inspect `fitPriorTimeMap(truth, placement, coverage)`; the winning inlier set should be the ~correct lines (a≈1, b≈0). Do NOT loosen the 3s bound to pass; fix the fit.

- [ ] **Step 3: Commit**

```bash
git add tests/lyrics/lrcPrior.recollect.test.ts
git commit --no-gpg-sign -m "test(align): Recollect real-data fixture proves prior collapses the bulge"
```

---

### Task 4: Wire `applyLrcPrior` into `AutoAlignFlow`

**Files:**
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx` (import near line 26-27; insert a block at line 447, after `refined = gap.refined` / the gap block closes at line 446 and before the onset-anchor comment at 448)

- [ ] **Step 1: Add the import**

In `src/ai-pipeline/AutoAlignFlow.tsx`, directly after the existing line 27 `import { computeLineMatchedSpans } from './contentAligner'`, add:

```ts
import { applyLrcPrior } from '../lyrics/lrcPrior'
```

- [ ] **Step 2: Insert the guardrail block**

Between line 446 (`      }` — end of the gap-recovery block) and line 448 (the `// Leading-edge onset anchor:` comment), i.e. replacing the single blank line 447, insert:

```tsx

      // LRC-prior guardrail: when the song already carries timing (a pasted LRC,
      // a subtitle, or a prior alignment), use it as a monotonic prior so a
      // confident-but-wrong transcript match can't drop a line onto entirely
      // different content. Pure — needs no audio/stem — and a no-op for
      // plain-text songs (all startTimes 0), so freshly-added untimed songs and
      // the offline corpus are byte-identical. Runs before the acoustic onset
      // anchor so that pass sharpens the opening within the prior.
      {
        const priorTimes = song.lyrics.lines.map((l) => l.startTime)
        const hasPrior =
          priorTimes.length === refined.lines.length &&
          priorTimes.filter((t) => t > 0).length >= Math.ceil(priorTimes.length / 2)
        if (hasPrior) {
          const priorSpans = computeLineMatchedSpans(
            refined.lines.map((l) => l.original || l.translation),
            sanitizeTranscript(transcriptWords),
          )
          refined = { ...refined, lines: applyLrcPrior(refined.lines, priorSpans, priorTimes) }
        }
      }
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc -b && npx eslint src/ai-pipeline/AutoAlignFlow.tsx`
Expected: exit 0. (`song`, `refined`, `transcriptWords`, `computeLineMatchedSpans`, and `sanitizeTranscript` are all already in scope in this block — `sanitizeTranscript` is used by the onset block just below.)

- [ ] **Step 4: Run the alignment-adjacent tests**

Run: `npx vitest run tests/lyrics tests/ai-pipeline`
Expected: PASS, no regressions. The corpus baseline / LRC-truth gates here must stay green (they align plain-text songs with no prior → the new block no-ops).

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/AutoAlignFlow.tsx
git commit --no-gpg-sign -m "feat(align): apply LRC-prior guardrail in the auto-align flow"
```

---

### Task 5: Full-suite gate + verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: all pass (this session's baseline was 1579 passed | 2 skipped; expect that plus the new lrcPrior + fixture tests, 0 failures). Corpus baseline + LRC-truth gates unchanged (plain-text songs no-op the prior).

- [ ] **Step 2: Typecheck + lint the whole change**

Run: `npx tsc -b && npx eslint src/lyrics/lrcPrior.ts src/ai-pipeline/AutoAlignFlow.tsx tests/lyrics/lrcPrior.test.ts tests/lyrics/lrcPrior.recollect.test.ts`
Expected: exit 0.

- [ ] **Step 3: Manual browser verification (needs a real timed song + audio)**

Start the dev server via the preview tool. Take a song that has an LRC whose timing is approximate for its audio (or paste an LRC, then in Edit mode nudge a few times off), then run Edit-mode **Re-align**. Confirm the re-aligned lines stay near the pasted structure — in particular that no line jumps onto a far-away different lyric — versus the same song re-aligned after clearing its times ("align from scratch"), which may drift. Capture a before/after screenshot.

- [ ] **Step 4: Commit any verification fixes**

```bash
git add -A
git commit --no-gpg-sign -m "fix(align): address LRC-prior verification findings"
```

(Skip if nothing surfaced.)

---

## Notes for the executor

- `applyLrcPrior` and `fitPriorTimeMap` are **pure** — no audio, no React, no I/O. Keep them that way; all logic is testable in `tests/lyrics/lrcPrior*.test.ts`.
- Do **not** loosen the Recollect fixture bounds to make Task 3 pass — the bound *is* the spec. If it fails, the fit is wrong; fix `fitPriorTimeMap`.
- The exhaustive pair loop is O(n²) in confident lines (≤ ~60) — do not "optimize" it into a randomized RANSAC; determinism is a requirement (stable tests, reproducible alignments).
- Deferred and intentionally NOT in this plan: the explicit three-way paste button (behavior is reachable via Edit Re-align), and piecewise/tempo-drift maps. Do not add them.
