import type { LineAlignmentQuality } from '../core/types'

/**
 * How much of a run actually anchored, as a 0–1 score: fully-anchored ('good')
 * lines count 1, roughly-placed ('approximate') 0.5, unplaced ('needs_review') 0.
 *
 * Unlike content confidence (matched chars — blind to WHERE a line landed), this
 * collapses when a song is mostly mis-placed, so a merged alignment can no longer
 * report a falsely-perfect confidence over two passes that each matched their own
 * script's chars but landed in the wrong places.
 *
 * Lives in its own leaf module because it has two independent consumers that must
 * not diverge: the mixed-language merge (which grades its passes with it) and
 * `alignModeChoice` (which selects the Whisper timestamp mode with it). It was
 * originally defined in `mixedLanguageAlign.ts`; importing it from there into the
 * mode policy would have coupled the policy to a module UI tests legitimately mock,
 * which is exactly the kind of hidden dependency that turns a mock into a crash.
 */
export function placementConfidence(quality: readonly LineAlignmentQuality[]): number {
  if (!quality.length) return 0
  let score = 0
  for (const q of quality) score += q === 'good' ? 1 : q === 'approximate' ? 0.5 : 0
  return score / quality.length
}
