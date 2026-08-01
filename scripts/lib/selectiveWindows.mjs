/**
 * Selective refine-window construction for the hybrid CTC spike.
 *
 * Windows are CLOSED on both sides — by anchor-line baseline start times, or
 * by 0 / durationSec at the song edges — never open-ended. Open-ended
 * windows were a measured dead-end: CTC pays nothing for blanks and smears
 * tokens across silence/instrumental stretches (corpus mean drift 39s).
 *
 * Window bounds are derived only from baseline start times and trusted
 * anchor indices, never from CTC output: self-anchoring (deriving the next
 * window's bounds from a prior CTC pass) was provably vacuous.
 *
 * Anchor lines are never re-timed by this module or its consumer — the
 * blanket-refine variant (commit 531e0d3) lost by re-timing lines that were
 * already right. Only gaps that contain untrusted interior lines become
 * windows.
 */
export const MAX_TOKENS_PER_SEC = 12 // sung romaji rarely exceeds ~10 chars/s; lyrics can't fit -> cram risk
export const MAX_SEC_PER_TOKEN = 4 // mostly-instrumental window: CTC would smear

/**
 * Contract:
 * - `lines[i].startTime` and `tokensPerLine[i]` are parallel arrays over the
 *   same line indices (same length, same ordering).
 * - `anchorIdx` must be valid, in-range indices into `lines` (trusted lines
 *   that anchor a window boundary and are never re-timed by the caller).
 * - `durationSec` and `padSec` are required finite numbers (padSec may be 0,
 *   but not undefined/NaN/Infinity) — a non-finite value would silently
 *   propagate to NaN window bounds since NaN comparisons never trip the
 *   density guards below.
 */
export function buildSelectiveWindows({ lines, tokensPerLine, anchorIdx, durationSec, padSec }) {
  if (!Number.isFinite(durationSec) || !Number.isFinite(padSec)) {
    throw new Error(`buildSelectiveWindows: durationSec/padSec must be finite (got ${durationSec}, ${padSec})`)
  }
  for (const i of anchorIdx) {
    if (!Number.isInteger(i) || i < 0 || i >= lines.length) {
      throw new Error(`buildSelectiveWindows: anchorIdx ${i} out of range [0, ${lines.length})`)
    }
  }
  const n = lines.length
  const anchors = [...anchorIdx].sort((a, b) => a - b)
  const bounds = [
    { idx: -1, t: 0 },
    ...anchors.map((i) => ({ idx: i, t: lines[i].startTime })),
    { idx: n, t: durationSec },
  ]
  const windows = []
  for (let b = 0; b + 1 < bounds.length; b++) {
    const lo = bounds[b]
    const hi = bounds[b + 1]
    const lineIdx = []
    let tokens = 0
    for (let li = lo.idx + 1; li < hi.idx; li++) {
      if (tokensPerLine[li] > 0) {
        lineIdx.push(li)
        tokens += tokensPerLine[li]
      }
    }
    if (!lineIdx.length) continue
    const t0 = Math.max(0, lo.t - padSec)
    const t1 = Math.min(durationSec, hi.t + padSec)
    const span = t1 - t0
    if (span <= 0) continue
    if (tokens / span > MAX_TOKENS_PER_SEC) continue
    if (span / tokens > MAX_SEC_PER_TOKEN) continue
    windows.push({ lineIdx, t0, t1 })
  }
  return windows
}
