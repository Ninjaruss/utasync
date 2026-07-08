import type { Token } from '../../core/types'

/**
 * Curated fixes for kanji whose IPADIC (kuromoji) reading is commonly wrong in
 * lyrics because the same kanji has multiple readings and the analyzer picks the
 * less common one. Keyed by exact surface + the specific wrong reading, so other
 * readings and compound tokens (e.g. 角度=カクド) are untouched.
 */
interface ReadingCorrection {
  surface: string
  /** Katakana reading kuromoji produces that should be replaced. */
  from: string
  /** Corrected katakana reading. */
  to: string
  /** Only apply when the token's part-of-speech starts with this. */
  pos?: string
  /** Only apply when the NEXT token's surface is one of these (context rule). */
  nextSurfaceIn?: string[]
}

const CORRECTIONS: ReadingCorrection[] = [
  // 角 alone is almost always かど (corner) in lyrics, not かく (angle/horn).
  { surface: '角', from: 'カク', to: 'カド', pos: '名詞' },
  // 術 as a bare noun is the literary すべ (a way/means), not じゅつ (technique).
  { surface: '術', from: 'ジュツ', to: 'スベ', pos: '名詞' },
  // 粉雪 is こなゆき; IPADIC's こゆき is a rare alternate nobody sings.
  { surface: '粉雪', from: 'コユキ', to: 'コナユキ', pos: '名詞' },
  // IPADIC splits 彷徨う/彷徨った into 彷徨[ホウコウ]+う/っ; the verb reads さまよ(う).
  // Standalone 彷徨 (the noun) really is ほうこう, so require the verb ending.
  { surface: '彷徨', from: 'ホウコウ', to: 'サマヨ', pos: '名詞', nextSurfaceIn: ['う', 'っ', 'い', 'え', 'わ'] },
]

/** Sokuon (gemination) rules for numeral + counter pairs that IPADIC tokenizes
 * separately: 一[イチ]+歩[ホ] must read イッ+ポ, not イチ+ホ. Keyed by numeral
 * reading; the value lists the counter-initial rows that trigger gemination. */
// NB: character classes enumerate the voiceless kana — a range like カ-コ would
// also match the voiced ガギグゲゴ (they interleave in the katakana block).
const KSTH = /^[カキクケコサシスセソタチツテトハヒフヘホ]/
const KH = /^[カキクケコハヒフヘホ]/
const NUMERAL_GEMINATION: Record<string, { numeral: string; onsets: RegExp }> = {
  イチ: { numeral: 'イッ', onsets: KSTH },
  ハチ: { numeral: 'ハッ', onsets: KSTH },
  ロク: { numeral: 'ロッ', onsets: KH },
  ジュウ: { numeral: 'ジュッ', onsets: KSTH },
}

/** ハ行 counter onsets become semi-voiced after sokuon: いっほ→いっぽ. */
const HA_TO_PA: Record<string, string> = { ハ: 'パ', ヒ: 'ピ', フ: 'プ', ヘ: 'ペ', ホ: 'ポ' }

const BY_SURFACE = new Map<string, ReadingCorrection[]>()
for (const c of CORRECTIONS) {
  const list = BY_SURFACE.get(c.surface)
  if (list) list.push(c)
  else BY_SURFACE.set(c.surface, [c])
}

/** Apply curated reading corrections to tokenized lyrics (post-kuromoji). Returns
 * a new array, with corrected tokens replaced (others untouched by reference). */
export function applyReadingCorrections(tokens: Token[]): Token[] {
  const out = tokens.map((token, i) => {
    const rules = BY_SURFACE.get(token.surface)
    if (!rules || !token.reading) return token
    for (const rule of rules) {
      if (token.reading !== rule.from) continue
      if (rule.pos && !(token.pos?.startsWith(rule.pos) ?? false)) continue
      if (rule.nextSurfaceIn && !rule.nextSurfaceIn.includes(tokens[i + 1]?.surface ?? '')) continue
      return { ...token, reading: rule.to }
    }
    return token
  })

  // Numeral + counter gemination (一歩 → いっ+ぽ). IPADIC tags numerals 名詞,数
  // and counters 名詞,接尾, and reads them in isolation (イチ+ホ).
  for (let i = 0; i < out.length - 1; i++) {
    const num = out[i]
    const counter = out[i + 1]
    if (!num.reading || !counter.reading) continue
    if (num.posDetail1 !== '数' || counter.posDetail1 !== '接尾') continue
    const rule = NUMERAL_GEMINATION[num.reading]
    if (!rule || !rule.onsets.test(counter.reading)) continue
    out[i] = { ...num, reading: rule.numeral }
    const head = counter.reading[0]
    const voiced = HA_TO_PA[head]
    if (voiced) out[i + 1] = { ...counter, reading: voiced + counter.reading.slice(1) }
  }
  return out
}
