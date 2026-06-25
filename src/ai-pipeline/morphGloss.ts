/**
 * Pattern-based JA↔EN gloss hints for inflected / merged tokens.
 * Complements the static ROMAJI_GLOSS dictionary — covers morphology
 * (〜なくて, 〜たって, 〜てみせる) without hard-coding every lyric phrase.
 *
 * Design: suffix/particle rules here, token merging in wordAligner.ts,
 * high-frequency lemmas in lyricGloss.ts, semantics in the embedder.
 */

export interface GlossSource {
  romaji: string
  /** Merged or single token surface — used for kanji-stem hints, not phrase IDs. */
  surface?: string
}

/** Hiragana/katakana function words that carry contrast/concession meaning. */
export const FUNCTION_WORD_ROMAJI: Record<string, string> = {
  noni: 'although',
  temo: 'even',
  demo: 'even',
  keredomo: 'but',
  keredo: 'but',
  kara: 'from',
  made: 'until',
  yori: 'than',
  dake: 'only',
  shika: 'only',
  hodo: 'how',
  kurai: 'about',
  donnani: 'matter',
  dorehodo: 'matter',
  ikurani: 'matter',
  ikura: 'how',
  kana: 'wonder',
  darou: 'probably',
  deshou: 'probably',
  yubi: 'finger',
  warae: 'solemn',
}

/** Surface → romaji for multi-mora particles/adverbs kuromoji emits whole. */
export const FUNCTION_WORD_SURFACE: Record<string, string> = {
  のに: 'noni',
  ても: 'temo',
  でも: 'demo',
  けれど: 'keredo',
  けれども: 'keredomo',
  から: 'kara',
  まで: 'made',
  より: 'yori',
  だけ: 'dake',
  しか: 'shika',
  ほど: 'hodo',
  くらい: 'kurai',
  ぐらい: 'kurai',
  どんなに: 'donnani',
  どれほど: 'dorehodo',
  いくら: 'ikura',
  いくらに: 'ikurani',
  かな: 'kana',
  だろう: 'darou',
  でしょう: 'deshou',
}

interface MorphRule {
  /** Match merged romaji (lowercase). */
  pattern: RegExp
  /** English alignment targets this morphology may legitimately pair with. */
  targets: string[]
  /** When set, at least one kanji in the merged surface must match. */
  kanjiHint?: RegExp
}

/**
 * Ordered suffix rules — more specific patterns should appear first when they
 * share endings (e.g. kutatte before tatte).
 */
const MORPH_RULES: MorphRule[] = [
  // Negative potential / adj (触れない, 知らない, …)
  { pattern: /(?:re|e)n?ai$/, targets: ['untouchable', 'not', 'touch', 'without', "can't"] },

  // Negative desire (知りたくはない, 行きたくはない, …)
  { pattern: /takuha?nai$/, targets: ['want', 'know', 'not', "didn't"] },
  { pattern: /taku$/, targets: ['want', 'wanna', 'wish', 'know'] },

  // Negative te-form: 居なくて, 行かなくて, …
  { pattern: /nakute$/, targets: ['not', 'without', 'here', 'anymore', 'are'] },
  { pattern: /naide$/, targets: ['without', 'not', "don't", 'never'] },
  { pattern: /(ra|ri)nai$/, targets: ['not', "can't", 'cannot', 'never', 'without'] },
  { pattern: /nakatta$/, targets: ['not', "didn't", 'never', 'without'] },

  // Concessive / conditional
  {
    pattern: /kutatte$/,
    targets: ['even', 'if', 'when', 'gets', 'cold', 'hot', 'still'],
  },
  {
    pattern: /tatte$/,
    targets: ['even', 'if', 'when', 'gets', 'still', 'though', 'cold', 'hot'],
    kanjiHint: /[ぁ-んァ-ン一-龯]/,
  },
  { pattern: /(re|le)ba$/, targets: ['if', 'when', 'must', 'should'] },
  { pattern: /tara$/, targets: ['if', 'when', 'once'] },

  // Desire / intention
  { pattern: /itai$/, targets: ['want', 'wanna', 'wish', 'dream', 'dreaming', 'keep', 'like'] },
  { pattern: /tai$/, targets: ['want', 'wanna', 'wish', 'dream', 'keep'] },
  { pattern: /(yo|o)u$/, targets: ['let', 'shall', 'will', 'come', 'go'] },

  // Progressive / aspect (merged 〜ている / 〜ていた / 〜てく)
  {
    pattern: /(te|de)(i|o)ta$/,
    targets: ['was', 'were', 'had', 'been', 'still', 'ing', 'think', 'know', 'want'],
    kanjiHint: /[ぁ-んァ-ン一-龯]/,
  },
  {
    pattern: /(te|de)(i|o)ru$/,
    targets: ['am', 'are', 'is', 'ing', 'still'],
    kanjiHint: /[ぁ-んァ-ン一-龯]/,
  },
  {
    pattern: /(te|de)(i|o)ku$/,
    targets: ['ing', 'away', 'on', 'melt', 'dissolving'],
    kanjiHint: /[ぁ-んァ-ン一-龯]/,
  },

  // Volitional show / prove
  {
    pattern: /(shite|te)miseru$/,
    targets: ['show', 'love', 'prove', 'my'],
    kanjiHint: /[ぁ-んァ-ン一-龯]/,
  },
  { pattern: /miseru$/, targets: ['show', 'prove', 'love', 'my'] },

  // Conjecture / epistemic (だろう → surely / probably)
  { pattern: /darou$/, targets: ['surely', 'probably', 'must', 'would'] },

  // Noun + 寸前
  { pattern: /sunzen$/, targets: ['verge', 'brink', 'edge', 'exploding', 'about', 'fall', 'over'] },

  // Colloquial past / change of state
  { pattern: /(chatta|jatta|gatta)$/, targets: ['already', 'ended', 'up', 'now', 'became'] },

  // Passive / potential (common in lyrics)
  { pattern: /(ra|ri)reru$/, targets: ['can', 'be', 'get', 'been', 'by'] },
  { pattern: /(sa|se)reru$/, targets: ['be', 'get', 'make', 'let'] },

  // Motion / change past tense — kanji disambiguates 待った vs 舞った
  {
    pattern: /(matta|nda|ida|satta|itta|natta)$/,
    targets: ['dancing', 'dance', 'flew', 'floated', 'rose', 'fell', 'went', 'came', 'started'],
    kanjiHint: /[舞浮飛踊起落行来走始]/,
  },
]

/** Romaji for a function-word surface when present. */
export function functionWordRomaji(surface: string): string | undefined {
  return FUNCTION_WORD_SURFACE[surface.trim()]
}

/** True when romaji + optional surface match a morphological gloss pattern. */
export function morphGlossMatches(source: GlossSource, targetWord: string): boolean {
  const r = source.romaji.trim().toLowerCase()
  const t = targetWord.trim().toLowerCase()
  if (!r || !t) return false

  const fn = FUNCTION_WORD_ROMAJI[r]
  if (fn === t) return true

  const surface = source.surface ?? ''
  for (const rule of MORPH_RULES) {
    if (!rule.pattern.test(r)) continue
    if (!rule.targets.includes(t)) continue
    if (rule.kanjiHint && !rule.kanjiHint.test(surface)) continue
    return true
  }
  return false
}
