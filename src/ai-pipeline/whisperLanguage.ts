import type { Language } from '../core/types'

const WHISPER_LANGUAGE: Record<Language, string> = {
  ja: 'japanese',
  en: 'english',
}

export function whisperLanguageFor(sourceLanguage: Language | undefined): string {
  if (sourceLanguage && sourceLanguage in WHISPER_LANGUAGE) {
    return WHISPER_LANGUAGE[sourceLanguage]
  }
  return 'japanese'
}

const JA_SCRIPT_RE = /[぀-ヿ㐀-鿿]/

/** A sheet is mixed-language when it has at least 3 substantial lines in each of
 * JA script and Latin (>=3 Latin words) — one-off English hooks ("oh yeah") don't
 * count. Forcing a single Whisper language on such songs garbles the other
 * language's sections, which the two-pass merge exists to fix. */
export function isMixedLanguageSheet(lineTexts: string[]): boolean {
  let ja = 0
  let latin = 0
  for (const t of lineTexts) {
    if (JA_SCRIPT_RE.test(t)) ja++
    else if ((t.match(/[A-Za-z']+/g) ?? []).length >= 3) latin++
  }
  return ja >= 3 && latin >= 3
}
