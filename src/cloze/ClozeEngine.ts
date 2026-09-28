import type { Token, ClozeDifficulty } from '../core/types'

export interface ClozeToken extends Token {
  blanked: boolean
}

const CONTENT_POS = new Set(['名詞', 'Noun', 'Verb', 'Adjective', '動詞', '形容詞', '形容動詞'])
const FUNCTION_POS = new Set(['助詞', 'Conjunction', '助動詞', 'Determiner', 'Preposition'])

/**
 * Deterministic 0..1 roll for one token position (FNV-1a over the surface, seeded
 * by the index so a repeated word can still fall on either side of the threshold).
 *
 * 'medium' used Math.random(), which re-rolled on every MOUNT — and the overlay
 * only mounts while its row is the active one, so a replayed A/B loop, an
 * enrichment pass or a phrasing regroup handed the learner a different set of
 * blanks for the same line, making the drill impossible to re-attempt.
 */
function blankRoll(surface: string, index: number): number {
  let h = 2166136261 ^ (index + 1)
  for (let i = 0; i < surface.length; i++) {
    h ^= surface.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000
}

export function selectClozeTokens(tokens: Token[], difficulty: ClozeDifficulty): ClozeToken[] {
  return tokens.map((token, index): ClozeToken => {
    const pos = token.pos ?? ''
    const isContent = CONTENT_POS.has(pos)
    const isFunction = FUNCTION_POS.has(pos)

    let blanked: boolean
    if (difficulty === 'easy') blanked = isContent
    else if (difficulty === 'medium') blanked = isContent || blankRoll(token.surface, index) < 0.3
    else blanked = !isFunction // hard: blank almost everything

    return { ...token, blanked }
  })
}

/**
 * Whether a drill on this line would hide anything at all. Callers use it to
 * decide if the row is drillable: 'easy' blanks only content words, so a
 * particle- or punctuation-only line has nothing to hide, and offering a
 * Reveal button there does nothing when tapped.
 */
export function hasClozeBlanks(tokens: Token[] | undefined, difficulty: ClozeDifficulty): boolean {
  if (!tokens?.length) return false
  return selectClozeTokens(tokens, difficulty).some((t) => t.blanked)
}
