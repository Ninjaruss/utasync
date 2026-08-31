import type { TimedLine, LyricsData } from '../core/types'
import { hasVisibleTranslation } from './bilingual'
import { smartAttachSecondLanguage, type SmartAttachResult } from './lineAligner'
import type { TranslationApplyMeta } from './SecondLanguagePanel'

/**
 * Below this mean confidence a translation fit is probably for the wrong song
 * (or an unrelated block of text) rather than a messy-but-correct match. Lives
 * here (not in SecondLanguagePanel) so both the interactive paste path AND the
 * automatic re-fit (`refitStaleTranslation`) share one gate without an import
 * cycle between the two modules.
 *
 * Measured 2026-08-30 via a throwaway cross-song probe over the 3 corpus songs
 * that carry a committed English translation (veil, akfg-firsttake, guitar-loneliness;
 * only 6 ordered cross-song pairs exist, so this is a small sample):
 *  - composite perturbation (messy but CORRECT fit): mean confidence 0.35-0.45
 *  - cross-song paste (WRONG song entirely), where a confidence signal was
 *    produced at all: mean confidence 0.16-0.25
 * The two ranges do not overlap; 0.30 sits in the gap.
 *
 * Caveat: 1 of the 6 cross-song pairs produced NO confidence array at all
 * (the dense slot-fit path skips DP scoring when line counts happen to align),
 * which falls back to the "trust it" default below and slips past this gate
 * undetected. The gate therefore fails open on line-count coincidences rather
 * than catching every wrong-song paste — it screens the flagrant case, not
 * every case.
 */
export const WRONG_SONG_MEAN_CONFIDENCE = 0.3

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
export function lastTranslatedRowIndex(lines: TimedLine[]): number {
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

/** Re-fits a previously-stored translation pairing after auto-align or gap
 * recovery may have changed line boundaries out from under it (Task 12): both
 * can re-time AND re-split/re-merge lines relative to what the pairing was built
 * against, silently leaving it describing rows that no longer exist. Re-fits
 * ONLY when the primary text/line-count actually changed (shouldRefitTranslation
 * keys on text, never timing) and only when a `translationSource` is stored to
 * re-fit against — costs one cached embedding pass, which is cheap next to
 * shipping a translation that quietly no longer lines up. Returns the input
 * `lyrics` unchanged (by reference) when no re-fit is needed, possible, or safe,
 * so callers can cheaply detect "nothing to do" with `!==`. */
export async function refitStaleTranslation(
  prevLines: TimedLine[],
  lyrics: LyricsData,
  meta: { title: string; artist: string },
): Promise<LyricsData> {
  if (!lyrics.translationSource) return lyrics
  if (!shouldRefitTranslation(prevLines, lyrics.lines)) return lyrics
  // A re-fit is automatic and unprompted. If the user has hand-fixed this
  // pairing (repair popover pick, or an AlignmentEditor confirm), that edit is
  // ground truth and must never be silently clobbered by re-deriving from the
  // stored paste (IMPORTANT 3 — do not invent a diffing scheme, just honour
  // the mark the edit itself left behind).
  if (lyrics.translationPairing?.userEdited) return lyrics
  try {
    const result = await smartAttachSecondLanguage(lyrics.lines, lyrics.translationSource, undefined, {
      songTitle: meta.title,
      artist: meta.artist,
    })
    const conf = (result.confidence ?? []).filter((c): c is number => typeof c === 'number')
    const mean = conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : 1
    // A re-fit is automatic and unprompted, so it must clear the SAME bars an
    // interactive attach does. A stale pairing is bad; silently replacing the
    // user's translations with a failed blind-positional fit is far worse
    // (CRITICAL 2).
    if (result.mismatchedBlocks.length > 0 || mean < WRONG_SONG_MEAN_CONFIDENCE) return lyrics
    const applyMeta = buildApplyMeta(result, lyrics.translationSource, mean)
    return {
      ...lyrics,
      lines: result.lines,
      unplacedTranslations: applyMeta.unplaced,
      translationSource: applyMeta.source,
      translationPairing: applyMeta.pairing,
    }
  } catch {
    // A failed re-fit must not lose the song's timing/text — the caller already
    // has that in `lyrics`; leave the (now possibly stale) pairing as-is rather
    // than throwing away a successful align/gap-recovery over a re-fit error.
    return lyrics
  }
}
