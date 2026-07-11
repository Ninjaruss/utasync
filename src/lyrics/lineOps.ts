import type { TimedLine } from '../core/types'

/** Replace one element immutably. */
function replaceAt(lines: TimedLine[], i: number, next: TimedLine): TimedLine[] {
  return lines.map((l, j) => (j === i ? next : l))
}

export function stampStart(lines: TimedLine[], i: number, time: number): TimedLine[] {
  return replaceAt(lines, i, { ...lines[i], startTime: Math.max(0, time) })
}

/**
 * Set a line's start and/or end anchor in one commit. `end: null` clears the
 * explicit end back to auto (endTime === startTime — the line then runs until
 * the next line starts, per `lineEffectiveEnd`). An explicit end never
 * precedes the start: it's clamped, collapsing to auto at the boundary.
 */
export function stampTimes(
  lines: TimedLine[],
  i: number,
  patch: { start?: number; end?: number | null },
): TimedLine[] {
  const cur = lines[i]
  const start = patch.start !== undefined ? Math.max(0, patch.start) : cur.startTime
  const hadExplicitEnd = cur.endTime > cur.startTime
  const end =
    patch.end === null ? start
    : patch.end !== undefined ? Math.max(start, patch.end)
    : hadExplicitEnd ? Math.max(start, cur.endTime)
    : start
  return replaceAt(lines, i, { ...cur, startTime: start, endTime: end })
}

/**
 * Apply original/translation text changes and drop derived enrichment that would
 * be stale (readings, tokens, word-pair indices, grammar annotations).
 */
export function applyLineTextPatch(
  line: TimedLine,
  patch: { original?: string; translation?: string },
): TimedLine {
  const next: TimedLine = { ...line, ...patch }
  const originalChanged = patch.original !== undefined && patch.original !== line.original
  const translationChanged = patch.translation !== undefined && patch.translation !== line.translation
  if (originalChanged) {
    delete next.reading
    delete next.furigana
    delete next.grammarAnnotations
  }
  if (originalChanged || translationChanged) {
    delete next.tokens
  }
  return next
}

/** Update one line's original and/or translation (see `applyLineTextPatch`). */
export function setText(lines: TimedLine[], i: number, patch: { original?: string; translation?: string }): TimedLine[] {
  return replaceAt(lines, i, applyLineTextPatch(lines[i], patch))
}

export function addLine(lines: TimedLine[], afterIndex: number): TimedLine[] {
  const start = lines[afterIndex]?.startTime ?? 0
  const blank: TimedLine = { startTime: start, endTime: start, original: '', translation: '' }
  return [...lines.slice(0, afterIndex + 1), blank, ...lines.slice(afterIndex + 1)]
}

export function deleteLine(lines: TimedLine[], i: number): TimedLine[] {
  return lines.filter((_, j) => j !== i)
}

export function mergeWithNext(lines: TimedLine[], i: number): TimedLine[] {
  if (i >= lines.length - 1) return lines
  const a = lines[i]
  const b = lines[i + 1]
  const merged: TimedLine = {
    startTime: a.startTime,
    endTime: b.endTime,
    original: [a.original, b.original].filter(Boolean).join(' '),
    translation: [a.translation, b.translation].filter(Boolean).join(' '),
  }
  return [...lines.slice(0, i), merged, ...lines.slice(i + 2)]
}

export function splitLine(lines: TimedLine[], i: number, charOffset: number): TimedLine[] {
  const cur = lines[i]
  const left = cur.original.slice(0, charOffset).trim()
  const right = cur.original.slice(charOffset).trim()
  const a: TimedLine = { startTime: cur.startTime, endTime: cur.endTime, original: left, translation: cur.translation }
  const b: TimedLine = { startTime: cur.startTime, endTime: cur.endTime, original: right, translation: '' }
  return [...lines.slice(0, i), a, b, ...lines.slice(i + 1)]
}

export function reorder(lines: TimedLine[], from: number, to: number): TimedLine[] {
  const copy = [...lines]
  const [moved] = copy.splice(from, 1)
  copy.splice(to, 0, moved)
  return copy
}
