import type { Token } from '../core/types'
import { isParticleToken } from '../core/language'
import { dedupeTexts, expandVectors } from './embedTextUtils'

export { isParticleToken }

/** Embedding vectors from the embedder are pre-normalized, so dot product IS cosine similarity. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

export interface MatchPair { sourceIndex: number; targetIndex: number; score: number }

// Tuned for multilingual MiniLM-style embeddings: cross-language pairs often
// score lower than same-language pairs, so 0.55 left most lyric lines unmatched.
export const MATCH_THRESHOLD = 0.45
/** Second-pass floor for tokens still unmatched after greedy pairing. */
export const RELAXED_MATCH_THRESHOLD = 0.35

/** Text sent to the embedder for a source token (reading when it adds signal). */
export function tokenEmbedText(token: Token): string {
  const surface = token.surface.trim()
  if (!surface) return surface
  const reading = token.reading?.trim()
  if (reading && reading !== surface) return reading
  return surface
}

export interface GreedyMatchOptions {
  /** When true, multiple source tokens may map to the same target word. */
  allowManyToOne?: boolean
}

/** Greedy best-match: highest-similarity pairs win first; each source index used at most once. */
export function greedyMatch(
  sourceVecs: number[][],
  targetVecs: number[][],
  threshold = MATCH_THRESHOLD,
  options: GreedyMatchOptions = {},
): MatchPair[] {
  const { allowManyToOne = true } = options
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
    if (usedSource.has(c.sourceIndex)) continue
    if (!allowManyToOne && usedTarget.has(c.targetIndex)) continue
    usedSource.add(c.sourceIndex)
    if (!allowManyToOne) usedTarget.add(c.targetIndex)
    result.push(c)
  }
  return result.sort((a, b) => a.sourceIndex - b.sourceIndex)
}

/** Assigns still-unmatched sources to their best target above the relaxed floor. */
function relaxedMatchUnmatched(
  sourceVecs: number[][],
  targetVecs: number[][],
  existing: MatchPair[],
  threshold = RELAXED_MATCH_THRESHOLD,
): MatchPair[] {
  const matchedSources = new Set(existing.map((m) => m.sourceIndex))
  const extra: MatchPair[] = []
  for (let i = 0; i < sourceVecs.length; i++) {
    if (matchedSources.has(i)) continue
    let bestJ = -1
    let bestScore = threshold
    for (let j = 0; j < targetVecs.length; j++) {
      const score = cosineSimilarity(sourceVecs[i], targetVecs[j])
      if (score >= bestScore) {
        bestScore = score
        bestJ = j
      }
    }
    if (bestJ >= 0) extra.push({ sourceIndex: i, targetIndex: bestJ, score: bestScore })
  }
  return extra
}

export interface LineAlignJob {
  tokens: Token[]
  targetWords: string[]
}

interface EmbedSlice { lineIndex: number; alignableIndices: number[]; sourceCount: number; targetCount: number }

function planEmbedBatches(jobs: LineAlignJob[], maxTextsPerBatch: number): EmbedSlice[][] {
  const slices: EmbedSlice[] = []
  for (let lineIndex = 0; lineIndex < jobs.length; lineIndex++) {
    const { tokens, targetWords } = jobs[lineIndex]
    const alignableIndices = alignableTokenIndices(tokens)
    if (alignableIndices.length === 0 || targetWords.length === 0) continue
    slices.push({
      lineIndex,
      alignableIndices,
      sourceCount: alignableIndices.length,
      targetCount: targetWords.length,
    })
  }

  if (slices.length === 0) return []

  const batches: EmbedSlice[][] = []
  let current: EmbedSlice[] = []
  let currentTexts = 0
  for (const slice of slices) {
    const sliceTexts = slice.sourceCount + slice.targetCount
    if (currentTexts + sliceTexts > maxTextsPerBatch && current.length > 0) {
      batches.push(current)
      current = []
      currentTexts = 0
    }
    current.push(slice)
    currentTexts += sliceTexts
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/** Counts embed round-trips for a set of line jobs (1 when everything fits one batch). */
export function countEmbedBatches(jobs: LineAlignJob[], maxTextsPerBatch = Infinity): number {
  if (maxTextsPerBatch === Infinity) return jobs.length === 0 ? 0 : 1
  return planEmbedBatches(jobs, maxTextsPerBatch).length
}

function alignableTokenIndices(tokens: Token[]): number[] {
  return tokens
    .map((_, i) => i)
    .filter((i) => !isParticleToken(tokens[i]) && tokens[i].surface.trim().length > 0)
}

function applyTokenMatches(
  tokens: Token[],
  alignableIndices: number[],
  sourceVecs: number[][],
  targetVecs: number[][],
): Token[] {
  const primary = greedyMatch(sourceVecs, targetVecs)
  const relaxed = relaxedMatchUnmatched(sourceVecs, targetVecs, primary)
  const matches = [...primary, ...relaxed]
  const updated = tokens.map((t) => ({ ...t }))
  for (const m of matches) {
    const tokenIndex = alignableIndices[m.sourceIndex]
    updated[tokenIndex] = { ...updated[tokenIndex], alignmentIndices: [m.targetIndex] }
  }
  return updated
}

/**
 * Aligns multiple lines in as few embedding round-trips as possible. Each job
 * is independent; lines with no alignable tokens or no target words are copied
 * through unchanged. `maxTextsPerBatch` splits very large songs into smaller
 * embed calls (used on memory-constrained / lite-tier phones).
 */
export async function alignLinesTokens(
  jobs: LineAlignJob[],
  embed: (texts: string[]) => Promise<number[][]>,
  options?: { maxTextsPerBatch?: number; onBatchProgress?: (done: number, total: number) => void },
): Promise<Token[][]> {
  const maxTextsPerBatch = options?.maxTextsPerBatch ?? Infinity
  const results = jobs.map((j) => j.tokens.map((t) => ({ ...t })))

  const batches = planEmbedBatches(jobs, maxTextsPerBatch)
  if (batches.length === 0) return results

  let batchDone = 0
  for (const batch of batches) {
    const texts: string[] = []
    for (const slice of batch) {
      const { tokens, targetWords } = jobs[slice.lineIndex]
      texts.push(...slice.alignableIndices.map((i) => tokenEmbedText(tokens[i])), ...targetWords)
    }
    const { unique, indexMap } = dedupeTexts(texts)
    const vecs = expandVectors(await embed(unique), indexMap)
    let offset = 0
    for (const slice of batch) {
      const sourceVecs = vecs.slice(offset, offset + slice.sourceCount)
      offset += slice.sourceCount
      const targetVecs = vecs.slice(offset, offset + slice.targetCount)
      offset += slice.targetCount
      results[slice.lineIndex] = applyTokenMatches(
        jobs[slice.lineIndex].tokens,
        slice.alignableIndices,
        sourceVecs,
        targetVecs,
      )
    }
    batchDone++
    options?.onBatchProgress?.(batchDone, batches.length)
  }

  return results
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
  const [result] = await alignLinesTokens([{ tokens: sourceTokens, targetWords }], embed)
  return result
}
