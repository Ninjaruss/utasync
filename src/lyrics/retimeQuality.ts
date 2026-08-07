import type { TimedLine, LineAlignmentQuality } from '../core/types'

/**
 * Per-line alignment quality carried forward across a manual timing edit.
 *
 * A hand-edited line is ground truth, so its flag clears to 'good'. Every other
 * line keeps whatever the aligner said about it: dropping the whole array on any
 * edit — which is what used to happen — made one nudge erase every off-timing
 * chip, the "N lines may be off" banner and the tap-anchor prompt, leaving the
 * user with no idea which lines still needed attention.
 *
 * Returns undefined (fall back to no quality data) when the indices can't be
 * trusted: a stale array, or lines added/removed so positions have shifted.
 */
export function retimeQuality(
  quality: LineAlignmentQuality[] | undefined,
  before: TimedLine[],
  after: TimedLine[],
): LineAlignmentQuality[] | undefined {
  if (!quality) return undefined
  if (quality.length !== before.length || after.length !== before.length) return undefined

  return quality.map((q, i) => {
    const wasRetimed =
      after[i].startTime !== before[i].startTime || after[i].endTime !== before[i].endTime
    return wasRetimed ? 'good' : q
  })
}
