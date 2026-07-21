import type { TimedLine, AlignmentLanguage } from '../core/types'
import { lineWeight } from '../ai-pipeline/aligner'
import { enforceLineMonotonicity } from './phraseAlignment'

/** A hard timing pin: line `lineIndex` starts exactly at `time` (seconds). */
export interface TimingAnchor {
  lineIndex: number
  time: number
  source: 'user' | 'auto-start' | 'auto-end'
}

/**
 * Re-fit line start times so every anchored line lands exactly on its anchor
 * time, distributing lines between consecutive anchors by singing weight and
 * translating lines outside the anchor span by the nearest anchor's delta. Pure;
 * returns a new array. Empty/`undefined` anchors ⇒ input cloned unchanged.
 */
export function refitAroundAnchors(
  lines: TimedLine[],
  anchors: TimingAnchor[] | undefined,
  sourceLanguage: AlignmentLanguage,
): TimedLine[] {
  const out = lines.map((l) => ({ ...l }))
  if (!anchors?.length) return out

  const byLine = new Map<number, TimingAnchor>()
  for (const a of anchors) {
    if (a.lineIndex < 0 || a.lineIndex >= out.length || !Number.isFinite(a.time)) continue
    const prev = byLine.get(a.lineIndex)
    if (!prev || a.source === 'user' || prev.source !== 'user') byLine.set(a.lineIndex, a)
  }
  const pins: TimingAnchor[] = []
  for (const p of [...byLine.values()].sort((x, y) => x.lineIndex - y.lineIndex)) {
    if (!pins.length || p.time > pins[pins.length - 1].time) pins.push(p)
  }
  if (!pins.length) return out

  const weightOf = (i: number) =>
    Math.max(0.1, lineWeight(out[i].original || out[i].translation, sourceLanguage))

  for (const p of pins) out[p.lineIndex].startTime = p.time

  for (let s = 0; s < pins.length - 1; s++) {
    const a = pins[s]
    const b = pins[s + 1]
    if (b.lineIndex - a.lineIndex <= 1) continue
    let total = 0
    for (let i = a.lineIndex; i < b.lineIndex; i++) total += weightOf(i)
    let acc = 0
    for (let i = a.lineIndex + 1; i < b.lineIndex; i++) {
      acc += weightOf(i - 1)
      out[i].startTime = a.time + ((b.time - a.time) * acc) / total
    }
  }

  const first = pins[0]
  const firstDelta = first.time - lines[first.lineIndex].startTime
  for (let i = 0; i < first.lineIndex; i++) out[i].startTime = lines[i].startTime + firstDelta
  const last = pins[pins.length - 1]
  const lastDelta = last.time - lines[last.lineIndex].startTime
  for (let i = last.lineIndex + 1; i < out.length; i++) out[i].startTime = lines[i].startTime + lastDelta

  enforceLineMonotonicity(out)
  return out
}
