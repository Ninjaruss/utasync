import type { Token } from '../core/types'
import { isParticleToken } from '../core/language'

export { isParticleToken }

/** Embedding vectors from the embedder are pre-normalized, so dot product IS cosine similarity. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

export interface MatchPair { sourceIndex: number; targetIndex: number; score: number }

// Initial guess, not yet validated against real embeddings — revisit once
// textEmbedder (the actual on-device model) lands and can be tested against
// real lyric lines.
export const MATCH_THRESHOLD = 0.55

/** Greedy best-match: highest-similarity pairs win first, each index used at most once. */
export function greedyMatch(
  sourceVecs: number[][],
  targetVecs: number[][],
  threshold = MATCH_THRESHOLD,
): MatchPair[] {
  const candidates: MatchPair[] = []
  for (let i = 0; i < sourceVecs.length; i++) {
    for (let j = 0; j < targetVecs.length; j++) {
      const score = cosineSimilarity(sourceVecs[i], targetVecs[j])
      if (score >= threshold) candidates.push({ sourceIndex: i, targetIndex: j, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const usedSource = new Set<number>()
  const usedTarget = new Set<number>()
  const result: MatchPair[] = []
  for (const c of candidates) {
    if (usedSource.has(c.sourceIndex) || usedTarget.has(c.targetIndex)) continue
    usedSource.add(c.sourceIndex)
    usedTarget.add(c.targetIndex)
    result.push(c)
  }
  return result.sort((a, b) => a.sourceIndex - b.sourceIndex)
}

/**
 * Aligns one line's source tokens to translation words, writing matched
 * indices onto each token's `alignmentIndices`. Particles are excluded from
 * matching entirely (no English counterpart) and never receive an index.
 * `embed` is injected so this stays unit-testable without a real model.
 */
export async function alignLineTokens(
  sourceTokens: Token[],
  targetWords: string[],
  embed: (texts: string[]) => Promise<number[][]>,
): Promise<Token[]> {
  const alignableIndices = sourceTokens
    .map((_, i) => i)
    .filter((i) => !isParticleToken(sourceTokens[i]) && sourceTokens[i].surface.trim().length > 0)

  if (alignableIndices.length === 0 || targetWords.length === 0) return sourceTokens

  const sourceTexts = alignableIndices.map((i) => sourceTokens[i].surface)
  const vecs = await embed([...sourceTexts, ...targetWords])
  const sourceVecs = vecs.slice(0, sourceTexts.length)
  const targetVecs = vecs.slice(sourceTexts.length)

  const matches = greedyMatch(sourceVecs, targetVecs)
  const updated = sourceTokens.map((t) => ({ ...t }))
  for (const m of matches) {
    const tokenIndex = alignableIndices[m.sourceIndex]
    updated[tokenIndex] = { ...updated[tokenIndex], alignmentIndices: [m.targetIndex] }
  }
  return updated
}
