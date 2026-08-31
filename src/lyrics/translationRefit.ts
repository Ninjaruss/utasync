import type { TimedLine } from '../core/types'
import { hasVisibleTranslation } from './bilingual'
import type { SmartAttachResult } from './lineAligner'
import type { TranslationApplyMeta } from './SecondLanguagePanel'

/**
 * True when a stored pairing is stale because the PRIMARY rows changed shape.
 * Timing-only changes do not invalidate a pairing — the pairing is about text.
 */
export function shouldRefitTranslation(prev: TimedLine[], next: TimedLine[]): boolean {
  if (prev.length !== next.length) return true
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].original !== next[i].original) return true
  }
  return false
}

/** Bump when the fitter changes materially, so stored songs can be re-fitted. */
export const TRANSLATION_PAIRING_VERSION = 1

/** Anchor every unplaced line to the last row that actually has a translation,
 * so repair can show it in context rather than as a nameless tail. */
function lastTranslatedRowIndex(lines: TimedLine[]): number {
  let idx = -1
  lines.forEach((l, i) => {
    if (hasVisibleTranslation(l)) idx = i
  })
  return idx
}

/** Builds the provenance carried alongside a translation fit (paste, or a
 * Task 12 re-fit), so it can be persisted for repair (Task 11) and further
 * re-fitting without re-asking the user to paste. Shared by SecondLanguagePanel
 * (fresh paste) and PlayerView's refitStaleTranslation (Task 12). */
export function buildApplyMeta(
  result: SmartAttachResult,
  secondary: string,
  meanConfidence: number,
): TranslationApplyMeta {
  return {
    source: secondary,
    // undefined means the fitter declined to pair that row (metadata/header/
    // duplicate) — excluded from the mean rather than treated as zero.
    unplaced: (result.extras ?? []).map((text) => ({
      text,
      afterLineIndex: lastTranslatedRowIndex(result.lines),
    })),
    pairing: {
      method: result.method,
      meanConfidence,
      flaggedLineCount: result.lines.filter((l) => !hasVisibleTranslation(l)).length,
      version: TRANSLATION_PAIRING_VERSION,
    },
  }
}
