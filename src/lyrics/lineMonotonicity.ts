import type { TimedLine } from '../core/types'

/**
 * Force a line array into a strictly usable, monotonic timeline: starts never go
 * backwards, no line's end crosses the next line's start, and no line is left with a
 * zero-or-negative span.
 *
 * Lives in its own leaf module (rather than `phraseAlignment.ts`, where it was written)
 * because it is the one thing nearly every timing pass needs: `gapRealign`, `lrcPrior`,
 * `leadingEdgeAnchor`, `lineOps`, `bilingualMerge` and `anchorRefit` all call it. Keeping it
 * in `phraseAlignment` meant that module could not import `refitAroundAnchors` (from
 * `anchorRefit`) without a cycle — and it needs to, so that a user's timing anchors are
 * re-applied in `applyRefinedAlignment` instead of being discarded by the next refine.
 *
 * `phraseAlignment` re-exports it, so the existing consumers are unchanged.
 */
export function enforceLineMonotonicity(out: TimedLine[]): void {
  for (let i = 1; i < out.length; i++) {
    if (out[i].startTime < out[i - 1].startTime) out[i].startTime = out[i - 1].startTime
  }
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].endTime > out[i + 1].startTime) out[i].endTime = out[i + 1].startTime
    const ownEnd = Math.max(out[i].endTime, out[i].startTime)
    out[i].endTime = Math.min(ownEnd, out[i + 1].startTime)
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i].endTime <= out[i].startTime) {
      out[i].endTime = out[i].startTime + 0.3
    }
  }
}
