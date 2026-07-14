import type { AlignmentLanguage, Language } from '../core/types'

const WHISPER_LANGUAGE: Record<Language, string> = {
  ja: 'japanese',
  en: 'english',
}

/** Whisper `language` option for a detected sheet language. 'mixed' returns
 * undefined so Whisper auto-detects the language per 30s chunk — forcing a
 * single language on a code-switching song garbles the other language's
 * sections (JA-forced English comes out as katakana soup and vice versa). */
export function whisperLanguageFor(sourceLanguage: AlignmentLanguage | undefined): string | undefined {
  if (sourceLanguage === 'mixed') return undefined
  if (sourceLanguage && sourceLanguage in WHISPER_LANGUAGE) {
    return WHISPER_LANGUAGE[sourceLanguage]
  }
  return 'japanese'
}

const JA_SCRIPT_RE = /[぀-ヿ㐀-鿿]/

/** Lines in each script counted the same way isMixedLanguageSheet always has:
 * any JA glyph makes a line Japanese; a Latin line must carry >=3 words so
 * one-off English hooks ("oh yeah") don't register. */
function countScriptLines(lineTexts: string[]): { ja: number; latin: number } {
  let ja = 0
  let latin = 0
  for (const t of lineTexts) {
    if (JA_SCRIPT_RE.test(t)) ja++
    else if ((t.match(/[A-Za-z']+/g) ?? []).length >= 3) latin++
  }
  return { ja, latin }
}

const MIXED_MIN_LINES_PER_SCRIPT = 3

/** A sheet is mixed-language when it has at least 3 substantial lines in each of
 * JA script and Latin (>=3 Latin words) — one-off English hooks ("oh yeah") don't
 * count. Forcing a single Whisper language on such songs garbles the other
 * language's sections. */
export function isMixedLanguageSheet(lineTexts: string[]): boolean {
  const { ja, latin } = countScriptLines(lineTexts)
  return ja >= MIXED_MIN_LINES_PER_SCRIPT && latin >= MIXED_MIN_LINES_PER_SCRIPT
}

/**
 * Language the alignment pipeline should run in, detected from the lyric sheet
 * itself. The stored song language defaults to 'ja' regardless of the pasted
 * lyrics, so trusting it forces Japanese transcription onto English songs; the
 * sheet's actual scripts are the ground truth.
 *
 *  - both scripts substantially present → 'mixed' (Whisper auto-detects per chunk)
 *  - one script present → that language
 *  - both present but one side is below the mixed threshold → the dominant
 *    script wins; a tie falls back to 'mixed'
 *  - no script detected at all → the stored language (instrumental/symbol sheets)
 */
export function detectSheetLanguage(
  lineTexts: string[],
  storedLanguage?: Language,
): AlignmentLanguage {
  const { ja, latin } = countScriptLines(lineTexts)
  if (ja >= MIXED_MIN_LINES_PER_SCRIPT && latin >= MIXED_MIN_LINES_PER_SCRIPT) return 'mixed'
  if (ja === 0 && latin === 0) return storedLanguage ?? 'ja'
  if (latin === 0) return 'ja'
  if (ja === 0) return 'en'
  if (ja === latin) return 'mixed'
  return ja > latin ? 'ja' : 'en'
}
