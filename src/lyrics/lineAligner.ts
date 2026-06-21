import type { TimedLine, Token } from '../core/types'
import { getDeviceTier } from '../ai-pipeline/capability'
import { splitTranslationWords, splitTranslationLineWords, translationWordCount } from '../language/wordColors'
import { isAlignableEnglishWord, normalizeEnglishAlignmentWord, isParticleToken } from '../core/language'
import { JAPANESE_RE, stripNonLyricLines, normalizeTranslationLines, extractTranslationsForAttach, splitPrimaryIntoBlocks, extractSecondLanguageBlocks, primaryHasTiming, isSyncedSecondaryLRC, attachTimedSecondLanguage, shouldUseTimelineMerge, parseSecondaryLRC, mergeTimedTracks } from './bilingual'
import { applyLineTextPatch } from './lineOps'
import type { LineAlignJob } from '../ai-pipeline/wordAligner'

export type PairingMethod = 'index' | 'slots' | 'semantic' | 'timeline' | 'mismatch'

const LATIN_WORD = /[A-Za-z]/
/** Both halves of a split Japanese line must reach this length (excludes 「ねえ いつか」). */
const MIN_JA_PHRASE_CHARS = 4

/** True when a line contains both Latin letters and Japanese script. */
export function isMixedScriptLine(text: string): boolean {
  const t = text.trim()
  return LATIN_WORD.test(t) && JAPANESE_RE.test(t)
}

/** Split "English phrase 日本語フレーズ" at the first Japanese character. */
export function splitMixedScriptLine(text: string): { latin: string; japanese: string } {
  const trimmed = text.trim()
  const jaStart = trimmed.search(JAPANESE_RE)
  if (jaStart < 0) return { latin: trimmed, japanese: '' }
  if (jaStart === 0) return { latin: '', japanese: trimmed }
  return {
    latin: trimmed.slice(0, jaStart).trim(),
    japanese: trimmed.slice(jaStart).trim(),
  }
}

function partGlyphLength(s: string): number {
  return s.replace(/\s/g, '').length
}

/** Two substantial Japanese phrases on one line (e.g. 「滑り込むキミの横 隣り合わせのハート」). */
export function splitDualPhraseJapanese(text: string): [string, string] | null {
  if (isMixedScriptLine(text) || LATIN_WORD.test(text)) return null
  if (!JAPANESE_RE.test(text)) return null
  const parts = text.trim().split(/\s+/)
  if (parts.length !== 2) return null
  if (parts.some((p) => partGlyphLength(p) < MIN_JA_PHRASE_CHARS)) return null
  return [parts[0], parts[1]]
}

export interface AlignmentSlot {
  lineIndex: number
  hint: string
}

function buildSlots(originals: string[], splitJaLines: Set<number>): AlignmentSlot[] {
  const slots: AlignmentSlot[] = []
  for (let i = 0; i < originals.length; i++) {
    const t = originals[i].trim()
    if (!t) continue
    if (isMixedScriptLine(t)) {
      const { latin, japanese } = splitMixedScriptLine(t)
      if (latin) slots.push({ lineIndex: i, hint: latin })
      if (japanese) slots.push({ lineIndex: i, hint: japanese })
    } else if (splitJaLines.has(i)) {
      const pair = splitDualPhraseJapanese(t)
      if (pair) {
        slots.push({ lineIndex: i, hint: pair[0] }, { lineIndex: i, hint: pair[1] })
      } else {
        slots.push({ lineIndex: i, hint: t })
      }
    } else {
      slots.push({ lineIndex: i, hint: t })
    }
  }
  return slots
}

/**
 * Expand primaries into alignment slots. Mixed EN+JA → two slots; optionally
 * split dual-phrase Japanese lines until the slot count matches translations.
 */
export function expandSlotsAdaptive(originals: string[], targetCount: number): AlignmentSlot[] {
  const splittable = originals
    .map((t, i) => ({ i, ok: !!splitDualPhraseJapanese(t) }))
    .filter((x) => x.ok)
    .map((x) => x.i)

  let splitJa = new Set<number>()
  let slots = buildSlots(originals, splitJa)
  if (slots.length >= targetCount) return slots

  for (const i of splittable) {
    if (slots.length >= targetCount) break
    splitJa = new Set([...splitJa, i])
    slots = buildSlots(originals, splitJa)
  }
  return slots
}

/** @deprecated Prefer expandSlotsAdaptive — minimal expansion without target count. */
export function expandToAlignmentSlots(originals: string[]): AlignmentSlot[] {
  return buildSlots(originals, new Set())
}

/**
 * English words used for JA↔EN pairing. When a mixed-script line's translation
 * starts with the Latin half already shown in `original`, only the remaining
 * translation lines are aligned against the Japanese portion.
 */
export function targetWordsForAlignment(original: string, translation: string): string[] {
  const lines = translation.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length <= 1) return splitTranslationWords(translation)
  if (isMixedScriptLine(original)) {
    const { latin } = splitMixedScriptLine(original)
    if (latin && latinHintScore(latin, lines[0]) >= 0.9) {
      return splitTranslationWords(lines.slice(1).join('\n'))
    }
  }
  return splitTranslationWords(translation)
}

/** Content-word pool for alignment; maps each entry back to a full-translation word index. */
export function alignableEnglishTargetPool(
  words: string[],
  baseOffset = 0,
): { words: string[]; indexMap: number[] } {
  const aligned: string[] = []
  const indexMap: number[] = []
  for (let i = 0; i < words.length; i++) {
    if (!isAlignableEnglishWord(words[i])) continue
    aligned.push(normalizeEnglishAlignmentWord(words[i]))
    indexMap.push(i + baseOffset)
  }
  return { words: aligned, indexMap }
}

export interface AlignmentSegment {
  alignTokenIndices: number[]
  targetWords: string[]
  /** Maps each alignable target index to `splitTranslationWords(translation)` coordinates. */
  targetIndexMap: number[]
}

function tokenIndicesInRange(tokens: Token[], start: number, end: number): number[] {
  const indices: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.startIndex >= start && t.endIndex <= end) indices.push(i)
  }
  return indices
}

/**
 * Dual-phrase Japanese lines with one translation line per phrase align each half
 * independently so monotonic matching does not cross phrase boundaries.
 */
export function buildAlignmentSegments(
  original: string,
  translation: string,
  tokens: Token[],
): AlignmentSegment[] | null {
  const dualPhrase = splitDualPhraseJapanese(original)
  const transLines = translation.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!dualPhrase || transLines.length < 2) return null

  const [phrase1, phrase2] = dualPhrase
  const p1Start = original.indexOf(phrase1)
  const p2Start = original.indexOf(phrase2)
  if (p1Start < 0 || p2Start < 0) return null

  const line0Words = splitTranslationLineWords(transLines[0])
  const line1Words = splitTranslationLineWords(transLines[1])
  const pool0 = alignableEnglishTargetPool(line0Words, 0)
  const pool1 = alignableEnglishTargetPool(line1Words, line0Words.length)

  return [
    {
      alignTokenIndices: tokenIndicesInRange(tokens, p1Start, p1Start + phrase1.length),
      targetWords: pool0.words,
      targetIndexMap: pool0.indexMap,
    },
    {
      alignTokenIndices: tokenIndicesInRange(tokens, p2Start, p2Start + phrase2.length),
      targetWords: pool1.words,
      targetIndexMap: pool1.indexMap,
    },
  ]
}

/**
 * Word index in `splitTranslationWords(translation)` where the alignment target
 * pool begins. Mixed-script lines that duplicate the Latin half on translation
 * line 1 align only against line 2+, so stored indices must be shifted for display.
 */
export function targetWordBaseOffset(original: string, translation: string): number {
  const full = splitTranslationWords(translation)
  const aligned = targetWordsForAlignment(original, translation)
  if (full.length === aligned.length) return 0
  const lines = translation.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length <= 1 || !isMixedScriptLine(original)) return 0
  const { latin } = splitMixedScriptLine(original)
  if (latin && latinHintScore(latin, lines[0]) >= 0.9) {
    return splitTranslationWords(lines[0]).length
  }
  return 0
}

/** Shifts alignment indices from the filtered target pool into full-translation coordinates. */
export function offsetTokenAlignmentIndices(tokens: Token[], offset: number): Token[] {
  if (offset === 0) return tokens
  return tokens.map((t) => {
    if (!t.alignmentIndices?.length) return t
    return { ...t, alignmentIndices: t.alignmentIndices.map((i) => i + offset) }
  })
}

/**
 * True when stored `alignmentIndices` are in the same coordinate space as
 * `splitTranslationWords(translation)` / `ColoredTranslation` display indices.
 */
export function alignmentIndicesAreValid(line: TimedLine): boolean {
  if (!line.tokens?.length || !line.translation?.trim()) return true

  const wordCount = translationWordCount(line.translation)
  const alignableTokens = line.tokens.filter(
    (t) => !isParticleToken(t) && t.surface.trim().length > 0,
  )
  if (alignableTokens.length === 0) return true

  const alignedTokens = alignableTokens.filter((t) => t.alignmentIndices && t.alignmentIndices.length > 0)
  if (alignedTokens.length === 0) {
    return alignableTokens.every((t) => t.alignmentIndices !== undefined)
  }

  for (const token of alignedTokens) {
    for (const idx of token.alignmentIndices!) {
      if (idx < 0 || idx >= wordCount) return false
    }
  }

  const segments = buildAlignmentSegments(line.original, line.translation, line.tokens)
  if (segments) {
    for (const segment of segments) {
      const allowed = new Set(segment.targetIndexMap)
      for (const tokenIndex of segment.alignTokenIndices) {
        const indices = line.tokens[tokenIndex]?.alignmentIndices
        if (!indices?.length) continue
        for (const idx of indices) {
          if (!allowed.has(idx)) return false
        }
      }
    }
  }

  if (isMixedScriptLine(line.original)) {
    const baseOffset = targetWordBaseOffset(line.original, line.translation)
    if (baseOffset > 0) {
      const jaSet = new Set(japaneseTokenIndices(line.original, line.tokens))
      for (let i = 0; i < line.tokens.length; i++) {
        if (!jaSet.has(i)) continue
        const indices = line.tokens[i].alignmentIndices
        if (!indices?.length) continue
        for (const idx of indices) {
          if (idx < baseOffset) return false
        }
      }
    }
  }

  return true
}

/** Builds a word-alignment job for one lyric line (used by PlayerView enrichment). */
export function buildAlignJob(line: TimedLine): LineAlignJob {
  const tokens = line.tokens!
  const segments = buildAlignmentSegments(line.original, line.translation, tokens)
  if (segments) {
    return { tokens, targetWords: [], segments }
  }
  const fullTarget = targetWordsForAlignment(line.original, line.translation)
  const baseOffset = targetWordBaseOffset(line.original, line.translation)
  const pool = alignableEnglishTargetPool(fullTarget, baseOffset)
  const jaIndices = japaneseTokenIndices(line.original, tokens)
  return {
    tokens,
    targetWords: pool.words,
    targetIndexMap: pool.indexMap,
    alignTokenIndices: jaIndices.length < tokens.length ? jaIndices : undefined,
  }
}

/** Token indices that fall inside the Japanese portion of a mixed-script line. */
export function japaneseTokenIndices(original: string, tokens: Token[]): number[] {
  if (!isMixedScriptLine(original)) return tokens.map((_, i) => i)
  const { japanese } = splitMixedScriptLine(original)
  if (!japanese) return tokens.map((_, i) => i)
  const jaStart = original.indexOf(japanese)
  if (jaStart < 0) return tokens.map((_, i) => i)
  const jaEnd = jaStart + japanese.length
  const indices: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.startIndex >= jaStart && t.endIndex <= jaEnd) indices.push(i)
  }
  return indices
}

export function mergeSlotTranslations(
  lineCount: number,
  slots: AlignmentSlot[],
  slotTranslations: string[],
): string[] {
  const buckets: string[][] = Array.from({ length: lineCount }, () => [])
  for (let s = 0; s < slots.length; s++) {
    const trans = slotTranslations[s]?.trim()
    if (trans) buckets[slots[s].lineIndex].push(trans)
  }
  return buckets.map((parts) => parts.join('\n'))
}

function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function latinHintScore(hint: string, translation: string): number {
  const a = normalizeForMatch(hint)
  const b = normalizeForMatch(translation)
  if (!a || !b) return 0
  if (a === b) return 1
  if (b.startsWith(a) || a.startsWith(b)) return 0.92
  const aWords = new Set(a.split(' '))
  const bWords = b.split(' ')
  let overlap = 0
  for (const w of bWords) if (aWords.has(w)) overlap++
  return overlap / Math.max(aWords.size, bWords.length, 1)
}

function cleanTranslations(translations: string[]): string[] {
  return stripNonLyricLines(translations).filter((l) => l.trim().length > 0)
}

/** True when a lyric line repeats the same phrase (e.g. ローリング ローリング). */
export function isRepetitionOnlyLine(text: string): boolean {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return false
  const norm = parts.map((p) => p.toLowerCase())
  return norm.every((p) => p === norm[0])
}

/**
 * When the primary line is chorus repetition only, keep the matching repeated
 * English tail instead of a longer line that includes the prior clause.
 */
export function trimTranslationForRepetitionLine(original: string, translation: string): string {
  if (!isRepetitionOnlyLine(original) || !translation.trim()) return translation
  const t = translation.trim()

  const commaParts = t.split(',').map((s) => s.trim()).filter(Boolean)
  if (commaParts.length >= 2) {
    const last = commaParts[commaParts.length - 1].toLowerCase()
    let run = 1
    for (let k = commaParts.length - 2; k >= 0; k--) {
      if (commaParts[k].toLowerCase() === last) run++
      else break
    }
    if (run >= 2) return commaParts.slice(-run).join(', ')
  }

  const words = splitTranslationWords(t)
  if (words.length >= 2) {
    const last = words[words.length - 1].toLowerCase()
    let run = 1
    for (let k = words.length - 2; k >= 0; k--) {
      if (words[k].toLowerCase() === last) run++
      else break
    }
    if (run >= 2) return words.slice(-run).join(' ')
  }

  return translation
}

/** Minimum non-space glyphs on a primary line before two EN rows may merge onto it. */
const MIN_ORIGINAL_GLYPHS_FOR_EN_MERGE = 16

function applyTranslations(primary: TimedLine[], merged: string[]): TimedLine[] {
  return primary.map((line, i) => {
    const raw = merged[i] ?? ''
    const translation = trimTranslationForRepetitionLine(line.original, raw)
    return applyLineTextPatch(line, { translation })
  })
}

/**
 * True when 1:1 index pairing is lexically plausible. Pure JA↔EN rows cannot be
 * validated without embeddings, so those always return false and fall through to
 * semantic alignment (avoids title-line offsets and other count-equal mismatches).
 */
export function indexPairingLooksValid(originals: string[], translations: string[]): boolean {
  let scored = 0
  let total = 0
  for (let i = 0; i < originals.length; i++) {
    const o = originals[i].trim()
    const t = translations[i]?.trim() ?? ''
    if (!o || !t) continue

    if (isMixedScriptLine(o)) {
      scored++
      total += latinHintScore(splitMixedScriptLine(o).latin, t)
      continue
    }
    if (JAPANESE_RE.test(o) && !LATIN_WORD.test(o)) return false
    if (LATIN_WORD.test(o) && !JAPANESE_RE.test(o)) {
      scored++
      total += latinHintScore(o, t)
    }
  }
  if (scored === 0) return false
  return total / scored >= 0.35
}

/**
 * True when slots carry structural signal — at least one primary line expanded
 * into multiple slots (mixed EN+JA or dual-phrase Japanese). Without it, slot
 * pairing degenerates into blind position-based assignment, which is no more
 * trustworthy than index pairing and must be validated the same way.
 */
export function slotsHaveStructure(slots: AlignmentSlot[]): boolean {
  const perLine = new Map<number, number>()
  for (const slot of slots) {
    perLine.set(slot.lineIndex, (perLine.get(slot.lineIndex) ?? 0) + 1)
  }
  for (const count of perLine.values()) {
    if (count > 1) return true
  }
  return false
}

/**
 * Structure-aware pairing: index, adaptive slots (mixed + dual-phrase JA), or mismatch.
 */
export function pairTranslationsToPrimary(
  primary: TimedLine[],
  translations: string[],
): { lines: TimedLine[]; method: PairingMethod } {
  const trans = cleanTranslations(translations)
  const originals = primary.map((l) => l.original)

  if (trans.length === primary.length && trans.length > 0) {
    const hasBlankPrimary = originals.some((o) => !o.trim())
    const allMixedOrSimple = originals.every((o) => !o.trim() || isMixedScriptLine(o) || !splitDualPhraseJapanese(o))
    if (!hasBlankPrimary && allMixedOrSimple && indexPairingLooksValid(originals, trans)) {
      return { lines: applyTranslations(primary, trans), method: 'index' }
    }
  }

  const slots = expandSlotsAdaptive(originals, trans.length)
  if (slots.length === trans.length && trans.length > 0) {
    const merged = mergeSlotTranslations(primary.length, slots, trans)
    return { lines: applyTranslations(primary, merged), method: 'slots' }
  }

  return { lines: applyTranslations(primary, trans), method: 'mismatch' }
}

export async function autoAlignLines(
  originals: string[],
  translations: string[],
  embedFn: (texts: string[]) => Promise<number[][]>,
): Promise<{ aligned: string[]; extras: string[] }> {
  const n = originals.length
  const m = translations.length
  if (n === 0) return { aligned: [], extras: translations }
  if (m === 0) return { aligned: new Array(n).fill(''), extras: [] }

  const mergedTexts =
    m >= 2 ? translations.slice(0, -1).map((t, j) => `${t}\n${translations[j + 1]}`) : []
  const vecs = await embedFn([...originals, ...translations, ...mergedTexts])
  const origVecs = vecs.slice(0, n)
  const transVecs = vecs.slice(n, n + m)
  const mergedVecs = vecs.slice(n + m)

  const vecSim = (a: number[], b: number[]): number => {
    let sim = 0
    for (let k = 0; k < a.length; k++) sim += a[k] * b[k]
    return sim
  }

  const pairScore = (i: number, transText: string, transVec: number[]): number => {
    const latin = latinHintScore(originals[i], transText)
    return vecSim(origVecs[i], transVec) * 0.7 + latin * 0.3
  }

  const canMergeOnto = (i: number): boolean =>
    partGlyphLength(originals[i]) >= MIN_ORIGINAL_GLYPHS_FOR_EN_MERGE

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  const back: string[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(''))

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = dp[i - 1][j]
      let move = 'U'
      const single = dp[i - 1][j - 1] + pairScore(i - 1, translations[j - 1], transVecs[j - 1])
      if (single >= best) {
        best = single
        move = 'D'
      }
      if (j >= 2 && canMergeOnto(i - 1)) {
        const merged = `${translations[j - 2]}\n${translations[j - 1]}`
        let dual = dp[i - 1][j - 2] + pairScore(i - 1, merged, mergedVecs[j - 2])
        if (translations[j - 2].length < 55 && translations[j - 1].length < 55) dual += 0.12
        if (dual > best) {
          best = dual
          move = 'M'
        }
      }
      const skipTrans = dp[i][j - 1]
      if (skipTrans > best) {
        best = skipTrans
        move = 'L'
      }
      dp[i][j] = best
      back[i][j] = move
    }
  }

  const buckets: string[][] = Array.from({ length: n }, () => [])
  const usedTrans = new Set<number>()
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i === 0) { j--; continue }
    if (j === 0) { i--; continue }
    const b = back[i][j]
    if (b === 'D') {
      buckets[i - 1].unshift(translations[j - 1])
      usedTrans.add(j - 1)
      i--
      j--
    } else if (b === 'M') {
      buckets[i - 1].unshift(translations[j - 1])
      buckets[i - 1].unshift(translations[j - 2])
      usedTrans.add(j - 1)
      usedTrans.add(j - 2)
      i--
      j -= 2
    } else if (b === 'U') {
      i--
    } else {
      j--
    }
  }

  const aligned = buckets.map((parts) => parts.join('\n'))
  const extras = translations.filter((_, idx) => !usedTrans.has(idx))
  return { aligned, extras }
}

export interface SmartAttachResult {
  lines: TimedLine[]
  mismatchedBlocks: number[]
  method: PairingMethod
  /** Translation lines not mapped to any primary row (timed union merge spreads these on the song tail). */
  extras?: string[]
}

export interface SmartAttachOptions {
  /** Import/save hot path: skip embedding; use index pairing when counts match. */
  preferFast?: boolean
  /** Skip semantic DP when originals + translations exceed this (default 48). */
  maxSemanticLines?: number
  /** Abort semantic alignment after this many ms (default 12s). */
  semanticTimeoutMs?: number
}

// High enough to cover a full song on both sides (originals + translations);
// the timeout below is the real guard against a slow on-device model, not this.
export const DEFAULT_MAX_SEMANTIC_LINES = 240
export const DEFAULT_SEMANTIC_TIMEOUT_MS = 20_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/** Blind 1:1 index pairing when counts match — used as a fast import fallback. */
function indexPairingFallback(primary: TimedLine[], translations: string[]): SmartAttachResult | null {
  const trans = cleanTranslations(translations)
  if (trans.length !== primary.length || trans.length === 0) return null
  if (primary.some((l) => !l.original.trim())) return null
  return {
    lines: applyTranslations(primary, trans),
    mismatchedBlocks: [],
    method: 'index',
  }
}

function semanticLineBudget(originals: string[], translations: string[]): number {
  return originals.length + translations.length
}

function nonemptyOriginalTexts(primary: TimedLine[]): { indices: number[]; texts: string[] } {
  const indices: number[] = []
  const texts: string[] = []
  for (let i = 0; i < primary.length; i++) {
    if (!primary[i].original.trim()) continue
    indices.push(i)
    texts.push(primary[i].original)
  }
  return { indices, texts }
}

/** Semantic DP on sung lines only — blank primary rows never consume translations. */
async function semanticAlignToPrimaryLines(
  primary: TimedLine[],
  translations: string[],
  embedFn: (texts: string[]) => Promise<number[][]>,
): Promise<{ aligned: string[]; extras: string[] }> {
  const { indices, texts } = nonemptyOriginalTexts(primary)
  if (texts.length === 0) {
    return { aligned: primary.map(() => ''), extras: translations }
  }
  const { aligned: partial, extras } = await autoAlignLines(texts, translations, embedFn)
  const aligned = primary.map(() => '')
  for (let k = 0; k < indices.length; k++) {
    aligned[indices[k]] = partial[k] ?? ''
  }
  return { aligned, extras }
}

function worstPairingMethod(a: PairingMethod, b: PairingMethod): PairingMethod {
  const rank: Record<PairingMethod, number> = { index: 0, slots: 1, semantic: 2, timeline: 2, mismatch: 3 }
  return rank[a] >= rank[b] ? a : b
}

function finalizeTimedAttach(
  primary: TimedLine[],
  secondary: string,
  content: SmartAttachResult,
  flatTranslations: string[],
): SmartAttachResult {
  const lines = attachTimedSecondLanguage(
    primary,
    secondary,
    content.lines,
    flatTranslations,
    content.method,
    content.extras ?? [],
  )
  const usedTimeline = shouldUseTimelineMerge(
    primary,
    flatTranslations,
    content.method,
    content.extras ?? [],
  ) || isSyncedSecondaryLRC(secondary)
  return {
    lines,
    mismatchedBlocks: [],
    method: usedTimeline && content.method === 'mismatch' ? 'timeline' : content.method,
    extras: [],
  }
}

/**
 * Best-effort automatic pairing: structure-aware slots first, then on-device
 * semantic alignment (slot-level, then line-level) when counts still differ.
 */
async function smartAttachSecondLanguageFromLines(
  primary: TimedLine[],
  trans: string[],
  embedFn?: (texts: string[]) => Promise<number[][]>,
  options?: SmartAttachOptions,
): Promise<SmartAttachResult> {
  const structural = pairTranslationsToPrimary(primary, trans)
  const originals = primary.map((l) => l.original)
  // Trust 'slots' only when slots carry real structure (mixed EN+JA or
  // dual-phrase Japanese). Plain 1:1 slots over pure JA↔EN are blind position
  // pairing — defer to semantic alignment, which handles title/verse offsets.
  if (structural.method === 'slots') {
    const slots = expandSlotsAdaptive(originals, trans.length)
    if (slotsHaveStructure(slots) || indexPairingLooksValid(originals, trans)) {
      return { lines: structural.lines, mismatchedBlocks: [], method: 'slots' }
    }
  }
  if (structural.method === 'index') {
    return { lines: structural.lines, mismatchedBlocks: [], method: 'index' }
  }

  if (options?.preferFast) {
    const fallback = indexPairingFallback(primary, trans)
    if (fallback) return fallback
    return { lines: structural.lines, mismatchedBlocks: [0], method: 'mismatch' }
  }

  const maxLines = options?.maxSemanticLines ?? DEFAULT_MAX_SEMANTIC_LINES
  const slots = expandSlotsAdaptive(originals, trans.length)
  const { texts: sungOriginals } = nonemptyOriginalTexts(primary)
  const semanticBudget = Math.max(
    semanticLineBudget(sungOriginals, trans),
    semanticLineBudget(slots.map((s) => s.hint), trans),
  )
  if (semanticBudget > maxLines) {
    const fallback = indexPairingFallback(primary, trans)
    if (fallback) return fallback
    return { lines: structural.lines, mismatchedBlocks: [0], method: 'mismatch' }
  }

  if (!embedFn) {
    try {
      if (getDeviceTier() === 'manual') {
        const fallback = indexPairingFallback(primary, trans)
        if (fallback) return fallback
        return { lines: structural.lines, mismatchedBlocks: [0], method: 'mismatch' }
      }
      const { embedTexts } = await import('../ai-pipeline/textEmbedder')
      embedFn = embedTexts
    } catch {
      const fallback = indexPairingFallback(primary, trans)
      if (fallback) return fallback
      return { lines: structural.lines, mismatchedBlocks: [0], method: 'mismatch' }
    }
  }

  const timeoutMs = options?.semanticTimeoutMs ?? DEFAULT_SEMANTIC_TIMEOUT_MS

  try {
    const runSemantic = async (): Promise<SmartAttachResult> => {
      if (slots.length === trans.length && slots.length > 0) {
        const { aligned, extras } = await autoAlignLines(
          slots.map((s) => s.hint),
          trans,
          embedFn!,
        )
        if (extras.length === 0) {
          const merged = mergeSlotTranslations(primary.length, slots, aligned)
          return {
            lines: applyTranslations(primary, merged),
            mismatchedBlocks: [],
            method: 'semantic',
            extras: [],
          }
        }
      }

      const { aligned, extras } = await semanticAlignToPrimaryLines(primary, trans, embedFn!)
      return {
        lines: applyTranslations(primary, aligned),
        mismatchedBlocks: extras.length > 0 ? [0] : [],
        method: 'semantic',
        extras,
      }
    }

    return await withTimeout(runSemantic(), timeoutMs, 'Semantic line alignment')
  } catch {
    const fallback = indexPairingFallback(primary, trans)
    if (fallback) return fallback
    return { lines: structural.lines, mismatchedBlocks: [0], method: 'mismatch' }
  }
}

export async function smartAttachSecondLanguage(
  primary: TimedLine[],
  secondary: string,
  embedFn?: (texts: string[]) => Promise<number[][]>,
  options?: SmartAttachOptions,
): Promise<SmartAttachResult> {
  const timed = primaryHasTiming(primary)

  if (timed && isSyncedSecondaryLRC(secondary)) {
    return {
      lines: mergeTimedTracks(primary, parseSecondaryLRC(secondary)),
      mismatchedBlocks: [],
      method: 'timeline',
    }
  }

  const primaryBlocks = splitPrimaryIntoBlocks(primary)
  const secondaryBlocks = extractSecondLanguageBlocks(secondary)

  if (primaryBlocks.length > 1 && primaryBlocks.length === secondaryBlocks.length) {
    const merged: TimedLine[] = []
    const mismatchedBlocks: number[] = []
    let method: PairingMethod = 'index'
    for (let b = 0; b < primaryBlocks.length; b++) {
      const blockTrans = cleanTranslations(
        normalizeTranslationLines(secondaryBlocks[b], primaryBlocks[b].length),
      )
      const blockSecondary = secondaryBlocks[b].join('\n')
      const content = await smartAttachSecondLanguageFromLines(
        primaryBlocks[b],
        blockTrans,
        embedFn,
        options,
      )
      if (timed) {
        const finalized = finalizeTimedAttach(primaryBlocks[b], blockSecondary, content, blockTrans)
        merged.push(...finalized.lines)
        method = worstPairingMethod(method, finalized.method)
      } else {
        merged.push(...content.lines)
        if (content.mismatchedBlocks.length > 0) mismatchedBlocks.push(b)
        method = worstPairingMethod(method, content.method)
      }
    }
    return { lines: merged, mismatchedBlocks, method }
  }

  const trans = cleanTranslations(extractTranslationsForAttach(secondary, primary.length))
  const content = await smartAttachSecondLanguageFromLines(primary, trans, embedFn, options)
  if (timed) {
    return finalizeTimedAttach(primary, secondary, content, trans)
  }
  return content
}
