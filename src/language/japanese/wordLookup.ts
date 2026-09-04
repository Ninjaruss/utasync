import { toRomaji as kanaToRomaji } from 'wanakana'
import { katakanaToHiragana } from './phonetics'
import { KANJI_ROMAJI, kanjiLemmaRomaji, lemmaGloss } from '../../ai-pipeline/lyricGloss'
import { normalizeLemmaGloss } from '../../ai-pipeline/glossNormalize'
import { getJmdictKanjiGloss, jmdictGlossLoaded, prepareJmdictStemIndex } from '../../ai-pipeline/jmdictGloss'
import { getPopoverGloss, getPopoverGlossForPos, loadJmdictPopover } from '../../ai-pipeline/jmdictPopover'
import { loadJmdictReadings, readingInventory } from './jmdictReadings'
import { grammarGloss, isGrammarToken } from './grammarGlosses'
import { shouldPromoteSungReading } from '../../lyrics/readingDisplay'
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

/**
 * Kuromoji POS → the JMdict class the popover dictionary stores, so a tapped word
 * gets the sense matching how it is used rather than the entry's first sense.
 * Suffix nouns map to 'suf' (さ in 高さ is "-ness", not the particle).
 */
function popoverPosClass(token: Token): string | undefined {
  const pos = token.pos
  if (!pos) return undefined
  // Plain nouns deliberately express NO preference. JMdict already orders an
  // entry's senses by prominence, so the first one is the best default; forcing
  // the noun class only ever skips past it to a rarer sense, and measurably did:
  // 一 "first" → "beginning", 金輪際 "ever" → "deepest bottom of the earth",
  // 日々 "daily" → "days (e.g. of one's youth)", 方 "way" → "care of ...".
  // Na-adjective stems are the exception — kuromoji tags 上手 / 変 / 必死 as
  // 名詞-形容動詞語幹, and their adjectival sense is the one a reader wants
  // ("skillful", not "flattery"; "strange", not "change").
  if (pos === '名詞') return token.posDetail1 === '形容動詞語幹' ? 'adj' : undefined
  if (pos === '動詞') return token.posDetail1 === '接尾' ? 'aux' : 'v'
  if (pos === '形容詞') return 'adj'
  if (pos === '連体詞') return 'adj'
  if (pos === '副詞') return 'adv'
  if (pos === '感動詞') return 'int'
  if (pos === '接続詞') return 'conj'
  if (pos === '助動詞') return 'aux'
  if (pos === '助詞') return 'prt'
  if (pos === '接頭詞') return 'pref'
  return undefined
}

/** Most representative JMdict reading for a surface: first common, else first. */
function jmdictFallbackReading(surface: string): string | undefined {
  const inv = readingInventory(surface)
  return inv ? inv.common[0] ?? inv.uncommon[0] : undefined
}

/** え-row kana → the う-row kana of the same consonant, for undoing a potential form. */
const E_ROW_TO_U_ROW: Record<string, string> = {
  え: 'う', け: 'く', げ: 'ぐ', せ: 'す', ぜ: 'ず', て: 'つ', で: 'づ',
  ね: 'ぬ', へ: 'ふ', べ: 'ぶ', ぺ: 'ぷ', め: 'む', れ: 'る',
}

/**
 * Dictionary form of a potential verb, which JMdict does not list as an entry of
 * its own: 出せる → 出す, 廻れる → 廻る, 食べられる → 食べる.
 *
 * kuromoji reports the potential as the base form, so the lookup asked the
 * dictionary for a word it has never contained and the popover came back blank
 * on ordinary verbs. Deinflecting one step is the smallest thing that makes them
 * resolvable — the sense shown is the plain verb's, which is what a reader needs.
 *
 * Deliberately narrow: only the potential, and only when the result differs. A
 * general deinflection engine would need to know which forms are already dictionary
 * entries (見せる and 続ける ARE listed, and must not be rewritten to 見す / 続く).
 */
function potentialDictionaryForm(word: string): string | undefined {
  if (word.length < 3 || !word.endsWith('る')) return undefined
  if (word.endsWith('られる')) return `${word.slice(0, -3)}る`
  const stem = word[word.length - 2]!
  const uRow = E_ROW_TO_U_ROW[stem]
  return uRow ? word.slice(0, -2) + uRow : undefined
}

/** Content-word gloss: curated overlay → surface-specific kanji gloss → romaji lemma chain. */
function lexicalGloss(token: Token, headword: string, kana: string | undefined): string | undefined {
  const posClass = popoverPosClass(token)
  // 1. Curated KANJI_ROMAJI overlay wins first — intentional poetic/song
  //    readings (愛→ai, 転がる→korogaru) that must override JMdict.
  const curatedRomaji = KANJI_ROMAJI[headword] ?? KANJI_ROMAJI[token.surface]
  if (curatedRomaji) {
    const curated = lemmaGloss(curatedRomaji, headword)
    if (curated) return curated
  }

  // 2. Dedicated popover dictionary: the full, reading-disambiguated first-sense
  //    definition. Strictly better than the single-word fallbacks below (which
  //    truncate "past" → "the" and collapse homographs), and scoped to the popover
  //    so the word-pairer's romaji map stays untouched. Keyed by dictionary form
  //    (headword) so inflected verbs resolve, then the raw surface.
  const readingHira = kana ? katakanaToHiragana(kana) : undefined
  const popover = getPopoverGloss(headword, readingHira, posClass)
    ?? getPopoverGloss(token.surface, readingHira, posClass)
  if (popover) return popover

  // 3. Surface-specific JMdict gloss — bypasses the romaji key so homophones
  //    don't collapse onto one definition (億 stays "hundred million", not
  //    置く's "put"). Sparse: only present for collision-corrected surfaces.
  const kanjiGloss = getJmdictKanjiGloss(headword) ?? getJmdictKanjiGloss(token.surface)
  if (kanjiGloss) return normalizeLemmaGloss(kanjiGloss)

  // 4. Fallback: romaji lemma chain (JMdict kanji→romaji, then the kana reading).
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
  const direct = romaji ? lemmaGloss(romaji, headword) : undefined
  if (direct) return direct

  // 5. Last resort: undo a potential form and look the plain verb up instead.
  //    JMdict has no 出せる entry, only 出す, so without this an ordinary verb
  //    shows nothing at all.
  const plain = potentialDictionaryForm(headword)
  if (plain && plain !== headword) {
    const plainGloss = getPopoverGloss(plain, undefined, posClass)
      ?? (kanjiLemmaRomaji(plain) ? lemmaGloss(kanjiLemmaRomaji(plain)!, plain) : undefined)
    if (plainGloss) return plainGloss
  }
  return undefined
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

const HAS_KANJI = /[一-鿿々]/

/**
 * Recover a grammar-tagged word that is really a content word (度 in 〜度に,
 * 欲しい in 〜て欲しい, 事 as a nominalizer, and the kana いい "good", みたい
 * "-like", 続ける "to continue") from the reading-disambiguated popover, which
 * kuromoji tags 非自立 and the grammar path would otherwise leave blank.
 *
 * The old guard was "kanji only", because a kana surface risked inheriting a
 * lexical gloss (は → 端 "edge"). Word class is the precise version of that
 * guard: on a kana surface only an exact class match is accepted, so a 助詞 は
 * can reach a particle sense and nothing else.
 */
function grammarPopoverGloss(token: Token, headword: string, readingHira: string | undefined): string | undefined {
  const posClass = popoverPosClass(token)
  // Kanji surfaces may take the entry's leading sense — 中 / 度 / 気 are plain
  // nouns, which express no class preference, and blanking them for want of one
  // would lose definitions this path exists to recover.
  if (HAS_KANJI.test(token.surface)) {
    return getPopoverGloss(headword, readingHira, posClass)
      ?? getPopoverGloss(token.surface, readingHira, posClass)
  }
  // Kana surfaces must match the word class exactly, so a particle can never
  // inherit a noun's meaning. Plain nouns carry no preference elsewhere, but
  // here a class is what makes the lookup safe, so require the noun one.
  const kanaClass = posClass ?? (token.pos === '名詞' ? 'n' : undefined)
  if (!kanaClass) return undefined
  return getPopoverGlossForPos(headword, readingHira, kanaClass)
    ?? getPopoverGlossForPos(token.surface, readingHira, kanaClass)
}

/**
 * Compact lookup for the tap-to-look-up popover. Resolves a romaji lemma key
 * (curated kanji map → JMdict kanji map → kana reading) and reuses the
 * curated-first lemmaGloss chain. Null only for tokens with no Japanese
 * characters (punctuation, latin interjections).
 */
export async function lookupWord(token: Token, readingMode: ReadingMode = 'dictionary'): Promise<WordLookupResult | null> {
  if (!hasJapanese(token.surface)) return null

  // Loads the JMdict maps + stem index once; resolves (with curated-only
  // coverage) even when the fetches fail. The popover dictionary is the primary
  // definition source; the romaji stem index stays a fallback.
  await Promise.all([prepareJmdictStemIndex(), loadJmdictReadings(), loadJmdictPopover()])

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

  // Function words (particles, auxiliaries, 非自立) carry grammatical meaning,
  // not lexical: the kana homophone chain would gloss は as 端 "edge" or た as
  // 田 "rice". They only ever take the curated grammar glossary — an uncurated
  // one shows no gloss rather than a wrong one.
  const readingHira = kana ? katakanaToHiragana(kana) : undefined
  const gloss = isGrammarToken(token)
    ? grammarGloss(token) ?? subsidiaryVerbLexicalGloss(token, headword, kana) ?? grammarPopoverGloss(token, headword, readingHira)
    : lexicalGloss(token, headword, kana)

  return {
    headword,
    reading,
    dictionaryReading: sung && dictReading && dictReading !== sung ? dictReading : null,
    pos: token.pos ?? null,
    posLabel: posLabelFor(token),
    glosses: gloss ? gloss.split(/\s*;\s*/).filter(Boolean) : [],
    dictionaryAvailable: jmdictGlossLoaded(),
  }
}
