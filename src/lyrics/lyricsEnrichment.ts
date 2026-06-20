import type { TimedLine } from '../core/types'
import { isParticleToken } from '../core/language'
import { hasVisibleTranslation } from './bilingual'

/** Bump when persisted enrichment shape changes and songs should re-normalize once. */
export const LYRICS_ENRICHMENT_VERSION = 1

/** True when tokenization still needs to run for these lines. */
export function linesNeedEnrichment(lines: TimedLine[], enrichmentVersion?: number): boolean {
  if (lines.length === 0) return false

  const missingTokens = lines.some(
    (line) => line.original.trim().length > 0 && !line.tokens?.length,
  )
  if (missingTokens) return true

  if (enrichmentVersion === LYRICS_ENRICHMENT_VERSION) return false

  // Legacy rows: tokens present but no version stamp yet — treat as cached.
  return false
}

/** True when one line's tokens exist but word-pair alignment was never computed. */
export function lineNeedsAlignment(line: TimedLine): boolean {
  if (!line.tokens?.length || !hasVisibleTranslation(line)) return false
  const alignable = line.tokens.filter(
    (t) => !isParticleToken(t) && t.surface.trim().length > 0,
  )
  if (alignable.length === 0) return false
  return !alignable.some((t) => t.alignmentIndices?.length)
}

/** True when any line still needs word-pair alignment. */
export function linesNeedAlignment(lines: TimedLine[]): boolean {
  return lines.some(lineNeedsAlignment)
}

/** True when enrichment or word-pair alignment made forward progress. */
export function enrichmentMadeProgress(
  before: TimedLine[],
  after: TimedLine[],
  enrichmentVersion?: number,
): boolean {
  if (linesNeedEnrichment(before, enrichmentVersion) && !linesNeedEnrichment(after, LYRICS_ENRICHMENT_VERSION)) {
    return true
  }
  if (linesNeedAlignment(before) && !linesNeedAlignment(after)) return true
  return false
}
