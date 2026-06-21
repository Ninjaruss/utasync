import type { Token } from '../core/types'
import { isParticleToken } from '../core/language'

/** Splits one translation line into display/alignment word tokens (no newlines). */
export function splitTranslationLineWords(line: string): string[] {
  return line
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
}

/** Splits translation text into words; newline-separated lines are flattened in order. */
export function splitTranslationWords(text: string): string[] {
  return text
    .split(/\n/)
    .flatMap((line) => splitTranslationLineWords(line))
}

/** Per-line word groups; flattened order matches `splitTranslationWords(text)`. */
export function splitTranslationLines(text: string): string[][] {
  return text.split('\n').map((line) => splitTranslationLineWords(line))
}

/** Word count in the coordinate space used by `alignmentIndices`. */
export function translationWordCount(translation: string): number {
  return splitTranslationWords(translation).length
}

/** Muted, fixed color for grammatical particles — distinct from the cycling match palette so it reads as "this is a particle," not "this is paired with something." */
export const PARTICLE_COLOR = '#9ca3af'

/** Cycling palette for matched word pairs, distinguishable on a dark background. */
export const PAIR_COLORS = ['#f97316', '#22d3ee', '#a3e635', '#e879f9', '#facc15', '#60a5fa']

/** A matched token's primary translation word index (lowest, for determinism), or null when unmatched. */
function primaryTargetIndex(token: Token): number | null {
  if (!token.alignmentIndices || token.alignmentIndices.length === 0) return null
  return Math.min(...token.alignmentIndices)
}

/**
 * Distinct translation-word indices in order of first appearance across matched,
 * non-particle tokens. A pair's palette color is its target index's rank here,
 * so every source token mapped to the same word — and that word — share one
 * color (correct many-to-one rendering, not just the first source token).
 */
function targetColorOrder(tokens: Token[]): number[] {
  const order: number[] = []
  for (const t of tokens) {
    if (isParticleToken(t) || !t.alignmentIndices) continue
    for (const idx of t.alignmentIndices) {
      if (!order.includes(idx)) order.push(idx)
    }
  }
  return order
}

/** Color for a source token at `index`: the fixed particle color, a cycling palette color if matched, or null if unmatched or `index` is out of bounds. */
export function colorForToken(tokens: Token[], index: number): string | null {
  if (!tokens[index]) return null
  const token = tokens[index]
  if (isParticleToken(token)) return PARTICLE_COLOR
  const target = primaryTargetIndex(token)
  if (target === null) return null
  const rank = targetColorOrder(tokens).indexOf(target)
  if (rank === -1) return null
  return PAIR_COLORS[rank % PAIR_COLORS.length]
}

/**
 * Color for a translation word at `wordIndex`, keyed by the same target-index
 * palette so it always matches its paired source token(s). A word paired only
 * with a lexical particle (e.g. だけ↔only) takes the fixed particle color, just
 * like the particle token itself.
 */
export function colorForTranslationWord(tokens: Token[], wordIndex: number): string | null {
  const matching = tokens.filter((t) => t.alignmentIndices?.includes(wordIndex))
  if (matching.length === 0) return null
  if (!matching.some((t) => !isParticleToken(t))) return PARTICLE_COLOR
  const rank = targetColorOrder(tokens).indexOf(wordIndex)
  if (rank === -1) return PARTICLE_COLOR
  return PAIR_COLORS[rank % PAIR_COLORS.length]
}
