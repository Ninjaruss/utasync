/**
 * Curated function-word glossary for the tap-to-look-up popover. Particles,
 * auxiliaries, and dependent (非自立) grammar words must NEVER take the romaji
 * homophone gloss chain — kana sound keys collide with content nouns and yield
 * garbage (は→"edge" 端, て→"hand" 手, た→"rice" 田). These tokens get a
 * grammar-function gloss instead, keyed by kuromoji POS + surface/baseForm.
 */

import type { Token } from '../../core/types'

/** kuromoji POS (first field) values that mark function words outright. */
const FUNCTION_POS = new Set(['助詞', '助動詞'])

/** True for tokens whose meaning is grammatical, not lexical: particles,
 * auxiliaries, and dependent verbs/nouns (てる, こと, はず…). */
export function isGrammarToken(token: Token): boolean {
  if (token.pos && FUNCTION_POS.has(token.pos)) return true
  return token.posDetail1 === '非自立'
}

interface GrammarEntry {
  gloss: string
  /** Restrict to a POS prefix (e.g. 助詞) when the same kana also appears in
   * another grammar category. */
  pos?: string
  /** Restrict to a kuromoji pos_detail_1 (終助詞, 格助詞…) for splits like の. */
  posDetail1?: string
}

/** Keyed by baseForm ?? surface. First matching entry wins, so subtype-
 * restricted entries must precede the general one for the same key. */
const ENTRIES: Record<string, GrammarEntry[]> = {
  // ---- case/topic particles ----
  は: [{ gloss: 'topic marker', pos: '助詞' }],
  が: [
    { gloss: 'but; though', pos: '助詞', posDetail1: '接続助詞' },
    { gloss: 'subject marker', pos: '助詞' },
  ],
  を: [{ gloss: 'direct object marker', pos: '助詞' }],
  の: [
    { gloss: 'explanatory / soft emphasis (sentence-ending)', pos: '助詞', posDetail1: '終助詞' },
    { gloss: 'possessive; of; nominalizer', pos: '助詞' },
    { gloss: 'nominalizer (the one / the fact that)', pos: '名詞' },
  ],
  に: [{ gloss: 'to; at; in (target, place, time)', pos: '助詞' }],
  へ: [{ gloss: 'to; toward', pos: '助詞' }],
  で: [
    { gloss: 'at; in; by means of', pos: '助詞', posDetail1: '格助詞' },
    { gloss: 'and; -te form (connective)', pos: '助詞' },
  ],
  と: [
    { gloss: 'and; with; quotation marker', pos: '助詞', posDetail1: '格助詞' },
    { gloss: 'if; when(ever)', pos: '助詞', posDetail1: '接続助詞' },
    { gloss: 'and; with', pos: '助詞' },
  ],
  も: [{ gloss: 'also; too; even', pos: '助詞' }],
  や: [{ gloss: 'and (non-exhaustive list)', pos: '助詞' }],
  か: [{ gloss: 'question marker; or', pos: '助詞' }],
  から: [
    { gloss: 'because; since', pos: '助詞', posDetail1: '接続助詞' },
    { gloss: 'from; out of', pos: '助詞' },
  ],
  まで: [{ gloss: 'until; as far as; even', pos: '助詞' }],
  より: [{ gloss: 'than; from', pos: '助詞' }],
  て: [{ gloss: '-te form (connects actions)', pos: '助詞' }],
  ば: [{ gloss: 'if (conditional)', pos: '助詞' }],
  ながら: [{ gloss: 'while; although', pos: '助詞' }],
  たり: [{ gloss: 'doing things like; sometimes', pos: '助詞' }],
  し: [{ gloss: "and; what's more (listing reasons)", pos: '助詞' }],
  って: [{ gloss: 'quotation marker (casual と/という)', pos: '助詞' }],
  とか: [{ gloss: 'and the like; or something', pos: '助詞' }],
  など: [{ gloss: 'etc.; and so on', pos: '助詞' }],
  だけ: [{ gloss: 'only; just', pos: '助詞' }],
  しか: [{ gloss: 'only; nothing but (with negative)', pos: '助詞' }],
  ばかり: [{ gloss: 'only; just; nothing but', pos: '助詞' }],
  ほど: [{ gloss: 'to the extent of; about', pos: '助詞' }],
  くらい: [{ gloss: 'about; at least; to the extent', pos: '助詞' }],
  ぐらい: [{ gloss: 'about; at least; to the extent', pos: '助詞' }],
  ずつ: [{ gloss: 'each; at a time', pos: '助詞' }],
  こそ: [{ gloss: 'precisely; especially (emphasis)', pos: '助詞' }],
  でも: [{ gloss: 'but; even; or something', pos: '助詞' }],
  だって: [{ gloss: 'because; even; but', pos: '助詞' }],
  のに: [{ gloss: 'even though; despite', pos: '助詞' }],
  ので: [{ gloss: 'because; since', pos: '助詞' }],
  けど: [{ gloss: 'but; though', pos: '助詞' }],
  けれど: [{ gloss: 'but; though', pos: '助詞' }],
  けれども: [{ gloss: 'but; though', pos: '助詞' }],
  // ---- sentence-ending particles ----
  ね: [{ gloss: "right?; isn't it? (seeking agreement)", pos: '助詞' }],
  よ: [{ gloss: 'you know; I tell you (emphasis)', pos: '助詞' }],
  な: [
    { gloss: "don't (prohibition); emphasis (sentence-ending)", pos: '助詞', posDetail1: '終助詞' },
    { gloss: 'adjectival connector (na-adjective)', pos: '助動詞' },
  ],
  わ: [{ gloss: 'emphasis (sentence-ending)', pos: '助詞' }],
  ぞ: [{ gloss: 'strong emphasis (sentence-ending)', pos: '助詞' }],
  ぜ: [{ gloss: 'strong emphasis (sentence-ending, casual)', pos: '助詞' }],
  さ: [{ gloss: 'casual emphasis (sentence-ending)', pos: '助詞' }],
  かな: [{ gloss: 'I wonder (sentence-ending)', pos: '助詞' }],
  かしら: [{ gloss: 'I wonder (sentence-ending)', pos: '助詞' }],
  // ---- auxiliaries (keyed by baseForm) ----
  だ: [{ gloss: 'to be (copula)', pos: '助動詞' }],
  です: [{ gloss: 'to be (polite copula)', pos: '助動詞' }],
  た: [{ gloss: 'past tense', pos: '助動詞' }],
  ない: [{ gloss: 'not (negation)', pos: '助動詞' }],
  ぬ: [{ gloss: 'not (negation, literary)', pos: '助動詞' }],
  ん: [{ gloss: 'not (negation, contraction of ぬ)', pos: '助動詞' }],
  ます: [{ gloss: 'polite verb ending', pos: '助動詞' }],
  う: [{ gloss: "volitional (let's / shall)", pos: '助動詞' }],
  よう: [{ gloss: "volitional (let's / shall)", pos: '助動詞' }],
  たい: [{ gloss: 'want to', pos: '助動詞' }],
  れる: [{ gloss: 'passive / potential', pos: '助動詞' }],
  られる: [{ gloss: 'passive / potential', pos: '助動詞' }],
  せる: [{ gloss: 'causative (make/let someone)', pos: '助動詞' }],
  させる: [{ gloss: 'causative (make/let someone)', pos: '助動詞' }],
  らしい: [{ gloss: 'seems like; apparently', pos: '助動詞' }],
  そう: [{ gloss: 'looks like; I hear (そうだ)', pos: '助動詞' }],
  みたい: [{ gloss: 'like; similar to', pos: '助動詞' }],
  べき: [{ gloss: 'should; ought to', pos: '助動詞' }],
  まい: [{ gloss: 'probably not; will not (volitional negative)', pos: '助動詞' }],
  // ---- dependent grammar verbs (after て) ----
  いる: [{ gloss: 'progressive / resulting state (〜ている)', posDetail1: '非自立' }],
  てる: [{ gloss: 'progressive (-ing, casual 〜ている)', posDetail1: '非自立' }],
  でる: [{ gloss: 'progressive (-ing, casual 〜でいる)', posDetail1: '非自立' }],
  いく: [{ gloss: 'going on; continuing (〜ていく)', posDetail1: '非自立' }],
  てく: [{ gloss: 'going on; continuing (casual 〜ていく)', posDetail1: '非自立' }],
  くる: [{ gloss: 'coming to; beginning to (〜てくる)', posDetail1: '非自立' }],
  しまう: [{ gloss: 'completely; to my regret (〜てしまう)', posDetail1: '非自立' }],
  ちゃう: [{ gloss: 'completely; to my regret (casual 〜てしまう)', posDetail1: '非自立' }],
  じゃう: [{ gloss: 'completely; to my regret (casual 〜でしまう)', posDetail1: '非自立' }],
  おく: [{ gloss: 'in advance; leave as is (〜ておく)', posDetail1: '非自立' }],
  みる: [{ gloss: 'try doing (〜てみる)', posDetail1: '非自立' }],
  あげる: [{ gloss: 'do for someone (〜てあげる)', posDetail1: '非自立' }],
  くれる: [{ gloss: 'do for me (〜てくれる)', posDetail1: '非自立' }],
  もらう: [{ gloss: 'have someone do (〜てもらう)', posDetail1: '非自立' }],
  ある: [{ gloss: 'has been done (resulting state, 〜てある)', posDetail1: '非自立' }],
  // ---- formal (dependent) nouns ----
  こと: [{ gloss: 'thing; fact; nominalizer', posDetail1: '非自立' }],
  もの: [{ gloss: 'thing; because (explanatory)', posDetail1: '非自立' }],
  はず: [{ gloss: 'should be; expected to', posDetail1: '非自立' }],
  わけ: [{ gloss: 'reason; meaning; no way (〜わけがない)', posDetail1: '非自立' }],
  ため: [{ gloss: 'for; sake of; because of', posDetail1: '非自立' }],
  まま: [{ gloss: 'as is; remaining in the state', posDetail1: '非自立' }],
  ところ: [{ gloss: 'place; moment; about to', posDetail1: '非自立' }],
  よる: [{ gloss: 'depending on; by (〜によって)', posDetail1: '非自立' }],
  みたいな: [{ gloss: 'like; sort of', posDetail1: '非自立' }],
}

/** Grammar-function gloss for a particle/auxiliary/dependent token, or
 * undefined when the token is not a grammar token or has no curated entry. */
export function grammarGloss(token: Token): string | undefined {
  if (!isGrammarToken(token)) return undefined
  for (const key of [token.baseForm ?? token.surface, token.surface]) {
    for (const entry of ENTRIES[key] ?? []) {
      if (entry.pos && !(token.pos?.startsWith(entry.pos) ?? false)) continue
      if (entry.posDetail1 && token.posDetail1 !== entry.posDetail1) continue
      return entry.gloss
    }
  }
  return undefined
}
