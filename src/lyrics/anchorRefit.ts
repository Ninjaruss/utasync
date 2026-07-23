import type { AlignmentLanguage, LineAlignmentQuality, TimedLine } from '../core/types'
import { enforceLineMonotonicity } from './phraseAlignment'

/** A hard timing pin: line `lineIndex` starts exactly at `time` (seconds). */
export interface TimingAnchor {
  lineIndex: number
  time: number
  source: 'user' | 'auto-start' | 'auto-end'
}

/**
 * Re-fit line starts around user anchors WITHOUT disturbing already-correct lines.
 *
 * The naive refit (distribute-by-weight, or translate-outside-by-delta) fails
 * badly on real songs: it propagates a single anchor's correction across the whole
 * track, dragging already-correct lines the wrong way (measured: one tap on an
 * isolated late line pushed mean error 0.9s → 6s). So this pass is deliberately
 * LOCAL:
 *   1. Anchored lines are pinned to their exact tap time.
 *   2. A line BETWEEN two anchors is re-timed ONLY when it is genuinely un-timed
 *      (`needs_review`, or no quality signal is withheld) — an actual hole the
 *      aligner couldn't place. It is warped between the bracketing anchors,
 *      preserving its relative position. A confident line keeps its own
 *      auto-aligned time (the common case: a few off spots, the rest already
 *      right).
 *   3. Lines OUTSIDE the anchored span are NEVER translated.
 *   4. Monotonicity is enforced (a user tap is ground truth; a confident neighbour
 *      that conflicts is clamped minimally, not shifted wholesale).
 *
 * Pure; returns a new array. Empty/`undefined` anchors ⇒ input cloned unchanged.
 * With no `quality` provided it is pin-only (reflows nothing) — the safe default
 * that measured every line within ~0.8s of truth after ~4 taps.
 */
export function refitAroundAnchors(
  lines: TimedLine[],
  anchors: TimingAnchor[] | undefined,
  _sourceLanguage: AlignmentLanguage,
  opts?: { quality?: (LineAlignmentQuality | undefined)[] },
): TimedLine[] {
  const out = lines.map((l) => ({ ...l }))
  if (!anchors?.length) return out

  // One pin per line (a user anchor beats an auto one), kept strictly increasing.
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

  for (const p of pins) out[p.lineIndex].startTime = p.time

  const quality = opts?.quality
  // Only reflow a line the aligner never confidently timed. Without a quality
  // signal, reflow nothing (pin-only) — never override a confident line.
  const untimed = (i: number) => (quality ? quality[i] === 'needs_review' : false)

  for (let s = 0; s < pins.length - 1; s++) {
    const a = pins[s]
    const b = pins[s + 1]
    if (b.lineIndex - a.lineIndex <= 1) continue
    const oldA = lines[a.lineIndex].startTime
    const oldB = lines[b.lineIndex].startTime
    const denom = oldB - oldA
    for (let i = a.lineIndex + 1; i < b.lineIndex; i++) {
      if (!untimed(i)) continue // confident line — leave it where the aligner put it
      const frac =
        denom > 1e-6
          ? Math.min(1, Math.max(0, (lines[i].startTime - oldA) / denom))
          : (i - a.lineIndex) / (b.lineIndex - a.lineIndex)
      out[i].startTime = a.time + (b.time - a.time) * frac
    }
  }

  enforceLineMonotonicity(out)
  return out
}
