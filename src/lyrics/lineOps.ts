import type { TimedLine } from '../core/types'

/** Replace one element immutably. */
function replaceAt(lines: TimedLine[], i: number, next: TimedLine): TimedLine[] {
  return lines.map((l, j) => (j === i ? next : l))
}

export function stampStart(lines: TimedLine[], i: number, time: number): TimedLine[] {
  return replaceAt(lines, i, { ...lines[i], startTime: Math.max(0, time) })
}

export function nudgeStart(lines: TimedLine[], i: number, delta: number): TimedLine[] {
  return replaceAt(lines, i, { ...lines[i], startTime: Math.max(0, lines[i].startTime + delta) })
}

/**
 * Update original and/or translation. Changing `original` invalidates derived
 * enrichment (reading/furigana/tokens/grammar) so the player re-enriches it.
 */
export function setText(lines: TimedLine[], i: number, patch: { original?: string; translation?: string }): TimedLine[] {
  const cur = lines[i]
  const next: TimedLine = { ...cur, ...patch }
  if (patch.original !== undefined && patch.original !== cur.original) {
    delete next.reading
    delete next.furigana
    delete next.tokens
    delete next.grammarAnnotations
  }
  return replaceAt(lines, i, next)
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
