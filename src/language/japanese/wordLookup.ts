import { toRomaji as kanaToRomaji } from 'wanakana'
import { katakanaToHiragana } from './phonetics'
import { kanjiLemmaRomaji, lemmaGloss } from '../../ai-pipeline/lyricGloss'
import { jmdictGlossLoaded, prepareJmdictStemIndex } from '../../ai-pipeline/jmdictGloss'
import type { Token } from '../../core/types'

export interface WordLookupResult {
  /** Dictionary form when known, else the surface. */
  headword: string
  /** Hiragana reading — from the tokenizer, or the surface itself when kana-only. */
  reading: string | null
  pos: string | null
  /** Empty when no dictionary entry was found — the popup still shows the reading. */
  glosses: string[]
  /** False when the JMdict gloss map failed to load (offline) — the popup says "definitions unavailable" instead of "no definition found". */
  dictionaryAvailable: boolean
}

const HAS_JA_CHAR = /[぀-ヿ一-鿿々]/
/** Hiragana/katakana plus the long-vowel mark — surfaces safe to romanize directly. */
const KANA_ONLY = /^[ぁ-ゖァ-ヺー]+$/

export function jishoSearchUrl(headword: string): string {
  return `https://jisho.org/search/${encodeURIComponent(headword)}`
}

/**
 * Compact lookup for the tap-to-look-up popover. Resolves a romaji lemma key
 * (curated kanji map → JMdict kanji map → kana reading) and reuses the
 * curated-first lemmaGloss chain. Null only for tokens with no Japanese
 * characters (punctuation, latin interjections).
 */
export async function lookupWord(token: Token): Promise<WordLookupResult | null> {
  if (!HAS_JA_CHAR.test(token.surface)) return null

  // Loads the JMdict map + stem index once; resolves (with curated-only
  // coverage) even when the fetch fails.
  await prepareJmdictStemIndex()

  const headword = token.baseForm ?? token.surface
  // Kuromoji supplies no reading for unknown words (slang); when the surface is
  // pure kana it IS the reading (same fallback as readingDisplay).
  const kana = token.reading ?? (KANA_ONLY.test(token.surface) ? token.surface : undefined)
  const reading = kana ? katakanaToHiragana(kana) : null
  // Romanize the ORIGINAL kana, not the hiragana conversion: wanakana resolves
  // the long-vowel mark ー into doubled vowels for katakana (スーパー → "suupaa",
  // matching JMdict keys) but emits literal hyphens for hiragana ("su-pa-").
  const romaji =
    kanjiLemmaRomaji(headword) ??
    kanjiLemmaRomaji(token.surface) ??
    (kana ? kanaToRomaji(kana).toLowerCase() : undefined)
  const gloss = romaji ? lemmaGloss(romaji, headword) : undefined

  return {
    headword,
    reading,
    pos: token.pos ?? null,
    glosses: gloss ? gloss.split(/\s*;\s*/).filter(Boolean) : [],
    dictionaryAvailable: jmdictGlossLoaded(),
  }
}
