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
}

const CORRECTIONS: ReadingCorrection[] = [
  // 角 alone is almost always かど (corner) in lyrics, not かく (angle/horn).
  { surface: '角', from: 'カク', to: 'カド', pos: '名詞' },
  // 術 as a bare noun is the literary すべ (a way/means), not じゅつ (technique).
  { surface: '術', from: 'ジュツ', to: 'スベ', pos: '名詞' },
]

const BY_SURFACE = new Map<string, ReadingCorrection[]>()
for (const c of CORRECTIONS) {
  const list = BY_SURFACE.get(c.surface)
  if (list) list.push(c)
  else BY_SURFACE.set(c.surface, [c])
}

/** Apply curated reading corrections to tokenized lyrics (post-kuromoji). Returns
 * the same array, with corrected tokens replaced (others untouched by reference). */
export function applyReadingCorrections(tokens: Token[]): Token[] {
  return tokens.map((token) => {
    const rules = BY_SURFACE.get(token.surface)
    if (!rules || !token.reading) return token
    for (const rule of rules) {
      if (token.reading !== rule.from) continue
      if (rule.pos && !(token.pos?.startsWith(rule.pos) ?? false)) continue
      return { ...token, reading: rule.to }
    }
    return token
  })
}
