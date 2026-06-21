import { toRomaji as kanaToRomaji } from 'wanakana'
import type { Token } from '../core/types'
import { isAlignableToken, isParticleToken } from '../core/language'
import type { AlignmentSegment } from '../lyrics/lineAligner'
import { katakanaToHiragana } from '../language/japanese/phonetics'
import { glossMatchesTarget, KANJI_ROMAJI, romajiShareGloss } from './lyricGloss'
import { dedupeTexts, expandVectors } from './embedTextUtils'

export { isParticleToken, isAlignableToken }

/** Embedding vectors from the embedder are pre-normalized, so dot product IS cosine similarity. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

export interface MatchPair { sourceIndex: number; targetIndex: number; score: number }

// With native-script source embeddings, correct cross-lingual pairs score high
// (gloss=1.0, or ~0.6–1.0 from the model) while spurious matches to "magnet"
// English words (i/like/it) sit ~0.5–0.6. A 0.55 floor favors precision —
// a missing (uncolored) word is far less confusing than a wrong pairing.
export const MATCH_THRESHOLD = 0.55
/** Second-pass floor for tokens still unmatched after greedy pairing. */
export const RELAXED_MATCH_THRESHOLD = 0.45
/** Small boost when source/target positions within a line are proportionally close. */
export const POSITION_BONUS = 0.08
/** DP assignment is used when target word count is at or below this (2^m states). */
export const OPTIMAL_MATCH_MAX_TARGETS = 18

const KANA_RE = /^[\u3040-\u309f\u30a0-\u30ff]+$/u

/** Surfaces (including kanji+kana) → romaji when kuromoji reading is absent. */
const SURFACE_ROMAJI: Record<string, string> = {
  好き: 'suki',
  嫌い: 'kirai',
  綺麗: 'kirei',
  大丈夫: 'daijoubu',
}

/** Romanize kana for cross-lingual embedding (JA↔EN pairs score higher in Latin script). */
function readingToRomaji(reading: string): string {
  return kanaToRomaji(katakanaToHiragana(reading)).trim().toLowerCase()
}

/**
 * Text sent to the embedder for a source token. The multilingual model was
 * trained on native scripts — romanizing first is out-of-distribution and
 * collapses unrelated words onto the same target (e.g. sekai/boku/nurikae all
 * landing on one English word). Native surface scores far higher and more
 * discriminately (世界→world 0.97 vs sekai→world 0.71/possible 0.69).
 */
export function tokenEmbedText(token: Token): string {
  return token.surface.trim()
}

/**
 * Romaji key for the gloss / exact-match signal (combined with embedding
 * similarity in `pairScore`). Uses kuromoji reading, kana, or curated kanji
 * romaji maps so curated glosses like sekai→world keep firing.
 */
export function tokenGlossText(token: Token): string {
  const surface = token.surface.trim()
  if (!surface) return surface
  const compoundRomaji = KANJI_ROMAJI[surface]
  if (compoundRomaji) return compoundRomaji
  const surfaceRomaji = SURFACE_ROMAJI[surface]
  if (surfaceRomaji) return surfaceRomaji
  const reading = token.reading?.trim()
  if (reading) {
    const romaji = readingToRomaji(reading)
    if (romaji) return romaji
  }
  if (KANA_RE.test(surface)) {
    const romaji = readingToRomaji(surface)
    if (romaji) return romaji
  }
  return surface
}

/** Lowercase English target words so embeddings align consistently with romanized JA. */
export function targetEmbedText(word: string): string {
  const trimmed = word.trim()
  const isAscii = [...trimmed].every((ch) => ch.charCodeAt(0) <= 0x7f)
  if (isAscii) return trimmed.toLowerCase()
  return trimmed
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

/** Position hint: 1 when indices align proportionally, 0 when at opposite ends. */
export function positionHint(sourceIndex: number, targetIndex: number, sourceCount: number, targetCount: number): number {
  if (sourceCount <= 1 || targetCount <= 1) return 1
  const s = sourceIndex / (sourceCount - 1)
  const t = targetIndex / (targetCount - 1)
  return 1 - Math.abs(s - t)
}

/** Perfect score when romanized source text equals or gloss-matches the English target word. */
export function exactTextMatchScore(sourceText: string, targetText: string): number {
  const s = sourceText.trim().toLowerCase()
  const t = targetText.trim().toLowerCase()
  if (s.length === 0) return 0
  if (s === t) return 1
  if (glossMatchesTarget(s, t)) return 1
  return 0
}

/** Combined embedding similarity and exact romaji/gloss match (no position bonus). */
export function pairScore(
  sourceText: string,
  targetText: string,
  sourceVec: number[],
  targetVec: number[],
  sourceIndex: number,
  targetIndex: number,
  sourceCount: number,
  targetCount: number,
  options?: { usePositionBonus?: boolean },
): number {
  const sim = cosineSimilarity(sourceVec, targetVec)
  const exact = exactTextMatchScore(sourceText, targetText)
  const base = Math.max(sim, exact)
  if (options?.usePositionBonus === false) return base
  const pos = positionHint(sourceIndex, targetIndex, sourceCount, targetCount)
  return base + POSITION_BONUS * pos
}

/** Builds the full source×target score matrix for a line. */
export function buildScoreMatrix(
  sourceTexts: string[],
  targetTexts: string[],
  sourceVecs: number[][],
  targetVecs: number[][],
  options?: { usePositionBonus?: boolean },
): number[][] {
  const n = sourceVecs.length
  const m = targetVecs.length
  const scores: number[][] = []
  for (let i = 0; i < n; i++) {
    scores[i] = []
    for (let j = 0; j < m; j++) {
      scores[i][j] = pairScore(
        sourceTexts[i],
        targetTexts[j],
        sourceVecs[i],
        targetVecs[j],
        i,
        j,
        n,
        m,
        options,
      )
    }
  }
  return scores
}

/**
 * Globally optimal one-to-one assignment via DP (each source maps to at most one
 * distinct target). Falls back to exclusive greedy when target count is large.
 */
export function optimalOneToOneMatch(scores: number[][], threshold = MATCH_THRESHOLD): MatchPair[] {
  const n = scores.length
  const m = scores[0]?.length ?? 0
  if (n === 0 || m === 0) return []

  if (m > OPTIMAL_MATCH_MAX_TARGETS) {
    const candidates: MatchPair[] = []
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        if (scores[i][j] >= threshold) candidates.push({ sourceIndex: i, targetIndex: j, score: scores[i][j] })
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

  const size = 1 << m
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(size).fill(-Infinity))
  const pick: (number | null)[][] = Array.from({ length: n + 1 }, () => Array(size).fill(null))
  dp[0][0] = 0

  for (let i = 0; i < n; i++) {
    for (let mask = 0; mask < size; mask++) {
      const base = dp[i][mask]
      if (base === -Infinity) continue
      // Leave source i unmatched
      if (base > dp[i + 1][mask]) {
        dp[i + 1][mask] = base
        pick[i + 1][mask] = null
      }
      for (let j = 0; j < m; j++) {
        if (mask & (1 << j)) continue
        const s = scores[i][j]
        if (s < threshold) continue
        const nextMask = mask | (1 << j)
        const total = base + s
        if (total > dp[i + 1][nextMask]) {
          dp[i + 1][nextMask] = total
          pick[i + 1][nextMask] = j
        }
      }
    }
  }

  let bestMask = 0
  let bestScore = -Infinity
  for (let mask = 0; mask < size; mask++) {
    if (dp[n][mask] > bestScore) {
      bestScore = dp[n][mask]
      bestMask = mask
    }
  }

  const result: MatchPair[] = []
  let mask = bestMask
  for (let i = n; i > 0; i--) {
    const j = pick[i][mask]
    if (j !== null) {
      result.push({ sourceIndex: i - 1, targetIndex: j, score: scores[i - 1][j] })
      mask ^= 1 << j
    }
  }
  return result.sort((a, b) => a.sourceIndex - b.sourceIndex)
}

type MonotonicAction = 'skip_source' | 'skip_target' | 'match_one_to_one' | 'match_many_to_one'

/**
 * Monotonic sequence alignment: source/target indices never decrease, naturally
 * handling SOV↔SVO word-order differences better than a flat position bonus.
 */
export function monotonicSequenceMatch(scores: number[][], threshold = MATCH_THRESHOLD): MatchPair[] {
  const n = scores.length
  const m = scores[0]?.length ?? 0
  if (n === 0 || m === 0) return []

  const NEG = -Infinity
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(NEG))
  const action: MonotonicAction[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill('skip_source'))
  const matchTarget: (number | null)[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null))
  dp[0][0] = 0

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const base = dp[i][j]
      if (base === NEG) continue

      if (i < n && base > dp[i + 1][j]) {
        dp[i + 1][j] = base
        action[i + 1][j] = 'skip_source'
        matchTarget[i + 1][j] = null
      }

      if (j < m && base > dp[i][j + 1]) {
        dp[i][j + 1] = base
        action[i][j + 1] = 'skip_target'
        matchTarget[i][j + 1] = null
      }

      if (i < n && j < m) {
        const s = scores[i][j]
        if (s >= threshold) {
          const oneToOne = base + s
          if (oneToOne > dp[i + 1][j + 1]) {
            dp[i + 1][j + 1] = oneToOne
            action[i + 1][j + 1] = 'match_one_to_one'
            matchTarget[i + 1][j + 1] = j
          }
          const manyToOne = dp[i][j + 1] !== NEG ? dp[i][j + 1] + s : NEG
          if (manyToOne > dp[i + 1][j + 1]) {
            dp[i + 1][j + 1] = manyToOne
            action[i + 1][j + 1] = 'match_many_to_one'
            matchTarget[i + 1][j + 1] = j
          }
        }
      }
    }
  }

  let bestJ = 0
  let bestScore = dp[n][0]
  for (let j = 1; j <= m; j++) {
    if (dp[n][j] > bestScore) {
      bestScore = dp[n][j]
      bestJ = j
    }
  }

  const result: MatchPair[] = []
  let i = n
  let j = bestJ
  while (i > 0 || j > 0) {
    const act = action[i][j]
    if (act === 'skip_source') {
      i--
      continue
    }
    if (act === 'skip_target') {
      j--
      continue
    }
    const tgt = matchTarget[i][j]
    if (tgt !== null) {
      result.push({ sourceIndex: i - 1, targetIndex: tgt, score: scores[i - 1][tgt] })
    }
    if (act === 'match_one_to_one') {
      i--
      j--
    } else {
      i--
    }
  }

  return result.sort((a, b) => a.sourceIndex - b.sourceIndex)
}

/**
 * Second pass: unmatched sources may share a target with a matched source when
 * similarity is strong — adjacent neighbors, gloss-cluster peers, or any
 * target already claimed by a source with the same gloss cluster.
 */
export function extendManyToOne(
  scores: number[][],
  sourceTexts: string[],
  targetTexts: string[],
  primary: MatchPair[],
  threshold = MATCH_THRESHOLD,
  relaxedThreshold = RELAXED_MATCH_THRESHOLD,
): MatchPair[] {
  const matchedSources = new Set(primary.map((m) => m.sourceIndex))
  const targetBySource = new Map(primary.map((m) => [m.sourceIndex, m.targetIndex]))
  const targetOwners = new Map<number, number[]>()
  for (const m of primary) {
    const owners = targetOwners.get(m.targetIndex) ?? []
    owners.push(m.sourceIndex)
    targetOwners.set(m.targetIndex, owners)
  }
  const extra: MatchPair[] = []

  const tryAssign = (sourceIndex: number, targetIndex: number, score: number): boolean => {
    if (matchedSources.has(sourceIndex)) return false
    extra.push({ sourceIndex, targetIndex, score })
    matchedSources.add(sourceIndex)
    const owners = targetOwners.get(targetIndex) ?? []
    owners.push(sourceIndex)
    targetOwners.set(targetIndex, owners)
    return true
  }

  for (let i = 0; i < scores.length; i++) {
    if (matchedSources.has(i)) continue

    // Gloss cluster: unmatched source shares EN gloss with a matched source
    for (const [ownerSource, targetIndex] of targetBySource) {
      if (romajiShareGloss(sourceTexts[i], sourceTexts[ownerSource])) {
        const score = scores[i][targetIndex]
        if (tryAssign(i, targetIndex, Math.max(score, 1))) break
      }
    }
    if (matchedSources.has(i)) continue

    // Direct gloss / poetic alias match to an already-used target word
    for (const [targetIndex] of targetOwners) {
      if (glossMatchesTarget(sourceTexts[i], targetTexts[targetIndex])) {
        const score = scores[i][targetIndex]
        if (tryAssign(i, targetIndex, Math.max(score, 1))) break
      }
    }
    if (matchedSources.has(i)) continue

    // Adjacent neighbor extension (original behavior)
    for (const neighbor of [i - 1, i + 1]) {
      if (neighbor < 0 || neighbor >= scores.length) continue
      const neighborTarget = targetBySource.get(neighbor)
      if (neighborTarget === undefined) continue
      const score = scores[i][neighborTarget]
      if (score >= threshold && tryAssign(i, neighborTarget, score)) break
    }
    if (matchedSources.has(i)) continue

    // Cluster: share target when this source's best above-threshold target is already used
    let bestJ = -1
    let bestScore = relaxedThreshold
    for (let j = 0; j < (scores[i]?.length ?? 0); j++) {
      if (scores[i][j] > bestScore) {
        bestScore = scores[i][j]
        bestJ = j
      }
    }
    if (bestJ >= 0 && targetOwners.has(bestJ)) {
      tryAssign(i, bestJ, bestScore)
    }
  }
  return extra
}

/** Monotonic alignment with gloss/cluster many-to-one extension. */
export function matchTokens(
  sourceTexts: string[],
  targetTexts: string[],
  sourceVecs: number[][],
  targetVecs: number[][],
  threshold = MATCH_THRESHOLD,
): MatchPair[] {
  const scores = buildScoreMatrix(sourceTexts, targetTexts, sourceVecs, targetVecs, { usePositionBonus: false })
  const monotonic = monotonicSequenceMatch(scores, threshold)
  const optimal = optimalOneToOneMatch(scores, threshold)
  const monoTotal = monotonic.reduce((sum, m) => sum + m.score, 0)
  const optTotal = optimal.reduce((sum, m) => sum + m.score, 0)
  // Monotonic alignment skips filler English words well, but global one-to-one
  // handles inverted JA/EN word order (SOV vs SVO); pick the stronger assignment.
  const primary = optTotal >= monoTotal ? optimal : monotonic
  const extended = extendManyToOne(scores, sourceTexts, targetTexts, primary, threshold)
  return [...primary, ...extended]
}

export interface AlignmentUnit {
  tokenIndices: number[]
  /** Native-script text fed to the embedding model. */
  embedText: string
  /** Romaji key for gloss / exact-match scoring. */
  glossText: string
}

function isNounToken(token: Token): boolean {
  return token.pos?.startsWith('名詞') ?? false
}

function shouldMergeCompound(left: Token, right: Token): boolean {
  if (!isAlignableToken(left) || !isAlignableToken(right)) return false
  if (!isNounToken(left) || !isNounToken(right)) return false
  return KANJI_ROMAJI[mergeSurface(left.surface, right.surface)] !== undefined
}

function mergeSurface(a: string, b: string): string {
  return a + b
}

function mergeReading(a?: string, b?: string): string | undefined {
  const left = a?.trim()
  const right = b?.trim()
  if (left && right) return left + right
  return left ?? right
}

/** Merges adjacent nominal tokens (e.g. 恋+愛) into one alignment unit. */
export function buildAlignmentUnits(tokens: Token[], alignTokenIndices?: ReadonlySet<number>): AlignmentUnit[] {
  const units: AlignmentUnit[] = []
  let i = 0
  while (i < tokens.length) {
    if (alignTokenIndices && !alignTokenIndices.has(i)) {
      i++
      continue
    }
    if (!isAlignableToken(tokens[i])) {
      i++
      continue
    }
    const start = i
    let merged = tokens[i]
    while (i + 1 < tokens.length && shouldMergeCompound(tokens[i], tokens[i + 1])) {
      i++
      merged = {
        ...merged,
        surface: mergeSurface(merged.surface, tokens[i].surface),
        reading: mergeReading(merged.reading, tokens[i].reading),
        endIndex: tokens[i].endIndex,
      }
    }
    const indices: number[] = []
    for (let k = start; k <= i; k++) {
      if (isAlignableToken(tokens[k])) indices.push(k)
    }
    units.push({
      tokenIndices: indices,
      embedText: tokenEmbedText(merged),
      glossText: tokenGlossText(merged),
    })
    i++
  }
  return units
}

export interface LineAlignJob {
  tokens: Token[]
  targetWords: string[]
  /** When set, only these token indices participate in alignment. */
  alignTokenIndices?: number[]
  /** Maps each alignable target index to full-translation word coordinates. */
  targetIndexMap?: number[]
  /** Per-phrase alignment for dual-phrase Japanese lines. */
  segments?: AlignmentSegment[]
}

interface EmbedSlice {
  lineIndex: number
  units: AlignmentUnit[]
  targetWords: string[]
  alignTokenIndices?: ReadonlySet<number>
  targetIndexMap?: number[]
}

function planEmbedBatches(jobs: LineAlignJob[], maxTextsPerBatch: number): EmbedSlice[][] {
  const slices: EmbedSlice[] = []
  for (let lineIndex = 0; lineIndex < jobs.length; lineIndex++) {
    const { tokens, targetWords, alignTokenIndices, targetIndexMap, segments } = jobs[lineIndex]
    if (segments && segments.length > 0) {
      for (const segment of segments) {
        const alignSet = new Set(segment.alignTokenIndices)
        const units = buildAlignmentUnits(tokens, alignSet)
        if (units.length === 0 || segment.targetWords.length === 0) continue
        slices.push({
          lineIndex,
          units,
          targetWords: segment.targetWords,
          alignTokenIndices: alignSet,
          targetIndexMap: segment.targetIndexMap,
        })
      }
      continue
    }
    const alignSet = alignTokenIndices ? new Set(alignTokenIndices) : undefined
    const units = buildAlignmentUnits(tokens, alignSet)
    if (units.length === 0 || targetWords.length === 0) continue
    slices.push({ lineIndex, units, targetWords, alignTokenIndices: alignSet, targetIndexMap })
  }

  if (slices.length === 0) return []

  const batches: EmbedSlice[][] = []
  let current: EmbedSlice[] = []
  let currentTexts = 0
  for (const slice of slices) {
    const sliceTexts = slice.units.length + slice.targetWords.length
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

function applyUnitMatches(
  tokens: Token[],
  units: AlignmentUnit[],
  sourceTexts: string[],
  targetTexts: string[],
  sourceVecs: number[][],
  targetVecs: number[][],
  targetIndexMap?: number[],
): Token[] {
  const matches = matchTokens(sourceTexts, targetTexts, sourceVecs, targetVecs)
  const updated = tokens.map((t) => ({ ...t }))
  for (const m of matches) {
    const unit = units[m.sourceIndex]
    const fullTargetIndex = targetIndexMap?.[m.targetIndex] ?? m.targetIndex
    for (const tokenIndex of unit.tokenIndices) {
      updated[tokenIndex] = { ...updated[tokenIndex], alignmentIndices: [fullTargetIndex] }
    }
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
      texts.push(
        ...slice.units.map((u) => u.embedText),
        ...slice.targetWords.map(targetEmbedText),
      )
    }
    const { unique, indexMap } = dedupeTexts(texts)
    const vecs = expandVectors(await embed(unique), indexMap)
    let offset = 0
    for (const slice of batch) {
      // Embedding ran on native-script `embedText`; gloss/exact scoring uses romaji `glossText`.
      const sourceTexts = slice.units.map((u) => u.glossText)
      const targetTexts = slice.targetWords.map(targetEmbedText)
      const sourceVecs = vecs.slice(offset, offset + slice.units.length)
      offset += slice.units.length
      const targetVecs = vecs.slice(offset, offset + slice.targetWords.length)
      offset += slice.targetWords.length
      results[slice.lineIndex] = applyUnitMatches(
        results[slice.lineIndex],
        slice.units,
        sourceTexts,
        targetTexts,
        sourceVecs,
        targetVecs,
        slice.targetIndexMap,
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
