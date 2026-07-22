import type { AlignmentLanguage, TimedLine } from '../core/types'
import { lineWeight } from '../ai-pipeline/aligner'
import { enforceLineMonotonicity } from './phraseAlignment'

/** When the aligner has crammed the opening lines onto an instrumental intro
 * (first sung line starts well BEFORE the detected vocal onset), pin the opening
 * to `onsetTime` and re-spread the crammed leading lines forward, by singing
 * weight, up to the first line already placed at/after the onset. Start-only;
 * conservative — no-op unless the first line is at least MIN_GAP before the onset
 * AND there is a later line to bound the re-spread. Returns a new lines array. */
export function anchorLeadingEdge(
  lines: TimedLine[],
  onsetTime: number,
  sourceLanguage: AlignmentLanguage,
  opts?: { minGapSec?: number },
): TimedLine[] {
  const MIN_GAP = opts?.minGapSec ?? 3.0
  const lineText = (l: TimedLine) => (l.original || l.translation).trim()

  const firstIdx = lines.findIndex((l) => lineText(l).length > 0)
  if (firstIdx === -1) return lines

  // Not crammed before the onset — leave it alone.
  if (onsetTime - lines[firstIdx].startTime < MIN_GAP) return lines

  // Find the first line already placed at/after the onset to bound the re-spread.
  let boundIdx = -1
  for (let j = firstIdx + 1; j < lines.length; j++) {
    if (lines[j].startTime >= onsetTime) {
      boundIdx = j
      break
    }
  }
  if (boundIdx === -1) return lines // degenerate: whole song before onset

  const out = lines.map((l) => ({ ...l }))
  const span = out[boundIdx].startTime - onsetTime

  const weights: number[] = []
  let totalWeight = 0
  for (let i = firstIdx; i < boundIdx; i++) {
    const w = Math.max(1e-3, lineWeight(lineText(out[i]) || out[i].original || out[i].translation, sourceLanguage))
    weights.push(w)
    totalWeight += w
  }

  let cursor = onsetTime
  for (let i = firstIdx; i < boundIdx; i++) {
    out[i].startTime = cursor
    cursor += (span * weights[i - firstIdx]) / totalWeight
  }

  enforceLineMonotonicity(out)
  return out
}
