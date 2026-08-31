import type { TimedLine } from '../core/types'

/**
 * Contiguous row ranges sharing a translation group, so display can render the
 * translation ONCE and bracket it across the rows it covers.
 *
 * Only contiguous runs merge: group ids are dense per attach, but a stale id
 * reused non-adjacently must never pull unrelated rows together.
 */
export function groupRanges(
  lines: TimedLine[],
): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = []
  let i = 0
  while (i < lines.length) {
    const id = lines[i].translationGroup
    let end = i
    if (id != null) {
      while (end + 1 < lines.length && lines[end + 1].translationGroup === id) end++
    }
    out.push({ start: i, end, text: lines[i].translation ?? '' })
    i = end + 1
  }
  return out
}
