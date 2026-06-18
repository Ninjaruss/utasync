import type { Token } from '../core/types'
import { isParticleToken } from '../core/language'

export function splitTranslationWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/** Muted, fixed color for grammatical particles — distinct from the cycling match palette so it reads as "this is a particle," not "this is paired with something." */
export const PARTICLE_COLOR = '#9ca3af'

/** Cycling palette for matched word pairs, distinguishable on a dark background. */
export const PAIR_COLORS = ['#f97316', '#22d3ee', '#a3e635', '#e879f9', '#facc15', '#60a5fa']

/** Color for a source token at `index`: the fixed particle color, a cycling palette color if matched, or null if unmatched or `index` is out of bounds. */
export function colorForToken(tokens: Token[], index: number): string | null {
  if (!tokens[index]) return null
  const token = tokens[index]
  if (isParticleToken(token)) return PARTICLE_COLOR
  if (!token.alignmentIndices || token.alignmentIndices.length === 0) return null
  const matchOrder = tokens.slice(0, index + 1).filter((t) => !isParticleToken(t) && t.alignmentIndices?.length).length - 1
  return PAIR_COLORS[matchOrder % PAIR_COLORS.length]
}

/** Color for a translation word at `wordIndex`, found via whichever token's alignmentIndices points to it. */
export function colorForTranslationWord(tokens: Token[], wordIndex: number): string | null {
  const i = tokens.findIndex((t) => t.alignmentIndices?.includes(wordIndex))
  return i === -1 ? null : colorForToken(tokens, i)
}
