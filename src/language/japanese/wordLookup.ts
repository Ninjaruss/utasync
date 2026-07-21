import { toRomaji as kanaToRomaji } from 'wanakana'
import { katakanaToHiragana } from './phonetics'
import { KANJI_ROMAJI, kanjiLemmaRomaji, lemmaGloss } from '../../ai-pipeline/lyricGloss'
import { normalizeLemmaGloss } from '../../ai-pipeline/glossNormalize'
import { getJmdictKanjiGloss, jmdictGlossLoaded, prepareJmdictStemIndex } from '../../ai-pipeline/jmdictGloss'
import { loadJmdictReadings, readingInventory } from './jmdictReadings'
import { grammarGloss, isGrammarToken } from './grammarGlosses'
import { shouldPromoteSungReading } from '../../lyrics/readingDisplay'
import { loadJaMonolingual, lookupJaDefinition, jaMonolingualLoaded } from './jaMonolingual'
import type { ReadingMode, Token } from '../../core/types'

export interface WordLookupResult {
  /** Dictionary form when known, else the surface. */
  headword: string
  /** Hiragana reading matching what the lyric ruby displays: a promoted sung
   * alternate when one owns the ruby, else the tokenizer reading (or the
   * surface itself when kana-only). */
  reading: string | null
  /** Dictionary reading when the primary `reading` is a sung alternate that
   * differs from it — shown as secondary context. Null otherwise. */
  dictionaryReading: string | null
  pos: string | null
  /** English POS label for display (particle, verb, noun…); null when unknown. */
  posLabel: string | null
  /** Empty when no dictionary entry was found — the popup still shows the reading. */
  glosses: string[]
  /** False when the JMdict gloss map failed to load (offline) — the popup says "definitions unavailable" instead of "no definition found". */
  dictionaryAvailable: boolean
  /** Language the `glosses` are written in: 'en' for the JMdict/curated English
   * gloss chain, 'ja' when immersion mode substitutes a Japanese monolingual
   * definition. */
  definitionLang: 'en' | 'ja'
}

const HAS_JA_CHAR = /[぀-ヿ一-鿿々]/

/** True when the text contains hiragana, katakana, or kanji. */
export function hasJapanese(text: string): boolean {
  return HAS_JA_CHAR.test(text)
}
/** Hiragana/katakana plus the long-vowel mark — surfaces safe to romanize directly. */
const KANA_ONLY = /^[ぁ-ゖァ-ヺー]+$/

export function jishoSearchUrl(headword: string): string {
  return `https://jisho.org/search/${encodeURIComponent(headword)}`
}

/** English labels for kuromoji IPADIC POS (first field) values. */
const POS_LABELS: Record<string, string> = {
  名詞: 'noun',
  動詞: 'verb',
  形容詞: 'i-adjective',
  副詞: 'adverb',
  助詞: 'particle',
  助動詞: 'auxiliary',
  連体詞: 'prenominal',
  接続詞: 'conjunction',
  感動詞: 'interjection',
  接頭詞: 'prefix',
  記号: 'symbol',
  フィラー: 'filler',
}

function posLabelFor(token: Token): string | null {
  if (!token.pos) return null
  const base = POS_LABELS[token.pos] ?? null
  if (token.pos === '名詞' && token.posDetail1 === '形容動詞語幹') return 'na-adjective'
  return base
}

/** Most representative JMdict reading for a surface: first common, else first. */
function jmdictFallbackReading(surface: string): string | undefined {
  const inv = readingInventory(surface)
  return inv ? inv.common[0] ?? inv.uncommon[0] : undefined
}

/** Content-word gloss: curated overlay → surface-specific kanji gloss → romaji lemma chain. */
function lexicalGloss(token: Token, headword: string, kana: string | undefined): string | undefined {
  // 1. Curated KANJI_ROMAJI overlay wins first — intentional poetic/song
  //    readings (愛→ai, 転がる→korogaru) that must override JMdict.
  const curatedRomaji = KANJI_ROMAJI[headword] ?? KANJI_ROMAJI[token.surface]
  if (curatedRomaji) {
    const curated = lemmaGloss(curatedRomaji, headword)
    if (curated) return curated
  }

  // 2. Surface-specific JMdict gloss — bypasses the romaji key so homophones
  //    don't collapse onto one definition (億 stays "hundred million", not
  //    置く's "put"). Sparse: only present for collision-corrected surfaces.
  const kanjiGloss = getJmdictKanjiGloss(headword) ?? getJmdictKanjiGloss(token.surface)
  if (kanjiGloss) return normalizeLemmaGloss(kanjiGloss)

  // 3. Fallback: romaji lemma chain (JMdict kanji→romaji, then the kana reading).
  //    On the kana branch, romanize the dictionary (base) form when kuromoji
  //    supplies a kana one: an inflected verb's surface reading misses
  //    (わから → "wakara"), but the base reading resolves (わかる → "wakaru" →
  //    "understand"). Katakana loanwords keep the reading path — they carry no
  //    distinct baseForm (スーパー), so the long-vowel handling below still applies:
  //    romanize the ORIGINAL kana, not the hiragana conversion, since wanakana
  //    turns the long-vowel mark ー into doubled vowels for katakana (スーパー →
  //    "suupaa", matching JMdict keys) but into literal hyphens for hiragana.
  const kanaHead = token.baseForm && KANA_ONLY.test(token.baseForm) ? token.baseForm : kana
  const romaji =
    kanjiLemmaRomaji(headword) ??
    kanjiLemmaRomaji(token.surface) ??
    (kanaHead ? kanaToRomaji(kanaHead).toLowerCase() : undefined)
  return romaji ? lemmaGloss(romaji, headword) : undefined
}

/**
 * Kanji subsidiary verbs (行く in 〜て行く) are tagged 動詞/非自立 but miss the
 * kana-keyed grammar map, which only lists their kana spellings (いく); grammar
 * suppression then blocks the lexical chain, leaving the popover blank. Recover
 * them through the surface-gated lexical gloss (行く → "go"). Deliberately scoped
 * to kanji verbs: kana subsidiary verbs already resolve via the grammar map, and
 * routing every 非自立 token to the lexical chain re-opens the kana homophone
 * collisions the grammar suppression exists to prevent.
 */
function subsidiaryVerbLexicalGloss(token: Token, headword: string, kana: string | undefined): string | undefined {
  if (token.pos !== '動詞' || token.posDetail1 !== '非自立') return undefined
  if (KANA_ONLY.test(token.surface)) return undefined
  return lexicalGloss(token, headword, kana)
}

/**
 * Compact lookup for the tap-to-look-up popover. Resolves a romaji lemma key
 * (curated kanji map → JMdict kanji map → kana reading) and reuses the
 * curated-first lemmaGloss chain. Null only for tokens with no Japanese
 * characters (punctuation, latin interjections).
 */
export async function lookupWord(
  token: Token,
  readingMode: ReadingMode = 'dictionary',
  opts: { immersion?: boolean } = {},
): Promise<WordLookupResult | null> {
  if (!hasJapanese(token.surface)) return null

  // Loads the JMdict maps + stem index once; resolves (with curated-only
  // coverage) even when the fetches fail.
  await Promise.all([prepareJmdictStemIndex(), loadJmdictReadings()])

  const headword = token.baseForm ?? token.surface
  // Kuromoji supplies no reading for unknown words (slang); when the surface is
  // pure kana it IS the reading (same fallback as readingDisplay); for unknown
  // kanji words, fall back to the JMdict inventory (common reading first).
  const kana = token.reading ?? (KANA_ONLY.test(token.surface) ? token.surface : undefined)
  const jmdictReading = kana ? undefined : jmdictFallbackReading(headword) ?? jmdictFallbackReading(token.surface)
  const dictReading = kana ? katakanaToHiragana(kana) : jmdictReading ?? null
  // Mirror the ruby: when a sung alternate owns the ruby (same promotion rule
  // as readingDisplay), the popover leads with it — a 術 ruby showing すべ must
  // not pop up じゅつ. The dictionary reading stays as secondary context.
  const sung = shouldPromoteSungReading(token, readingMode) && token.audioReading
    ? katakanaToHiragana(token.audioReading)
    : null
  const reading = sung ?? dictReading

  if (opts.immersion) {
    await loadJaMonolingual()
    const defs = lookupJaDefinition(token)
    return {
      headword,
      reading,
      dictionaryReading: sung && dictReading && dictReading !== sung ? dictReading : null,
      pos: token.pos ?? null,
      posLabel: posLabelFor(token),
      glosses: defs ?? [],
      dictionaryAvailable: jaMonolingualLoaded(),
      definitionLang: 'ja',
    }
  }

  // Function words (particles, auxiliaries, 非自立) carry grammatical meaning,
  // not lexical: the kana homophone chain would gloss は as 端 "edge" or た as
  // 田 "rice". They only ever take the curated grammar glossary — an uncurated
  // one shows no gloss rather than a wrong one.
  const gloss = isGrammarToken(token)
    ? grammarGloss(token) ?? subsidiaryVerbLexicalGloss(token, headword, kana)
    : lexicalGloss(token, headword, kana)

  return {
    headword,
    reading,
    dictionaryReading: sung && dictReading && dictReading !== sung ? dictReading : null,
    pos: token.pos ?? null,
    posLabel: posLabelFor(token),
    glosses: gloss ? gloss.split(/\s*;\s*/).filter(Boolean) : [],
    dictionaryAvailable: jmdictGlossLoaded(),
    definitionLang: 'en',
  }
}
