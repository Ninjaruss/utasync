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
