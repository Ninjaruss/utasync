import type { TimedLine, Token } from '../core/types'
import { getDeviceTier } from '../ai-pipeline/capability'
import { splitTranslationWords } from '../language/wordColors'
import { isAlignableEnglishWord, normalizeEnglishAlignmentWord } from '../core/language'
import { JAPANESE_RE, stripNonLyricLines, extractSecondLanguageLines } from './bilingual'
import { applyLineTextPatch } from './lineOps'

export type PairingMethod = 'index' | 'slots' | 'semantic' | 'mismatch'

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

  const line0Words = splitTranslationWords(transLines[0])
  const line1Words = splitTranslationWords(transLines[1])
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

function applyTranslations(primary: TimedLine[], merged: string[]): TimedLine[] {
  return primary.map((line, i) => applyLineTextPatch(line, { translation: merged[i] ?? '' }))
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
    const allMixedOrSimple = originals.every((o) => !o.trim() || isMixedScriptLine(o) || !splitDualPhraseJapanese(o))
    if (allMixedOrSimple) {
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

  const vecs = await embedFn([...originals, ...translations])
  const origVecs = vecs.slice(0, n)
  const transVecs = vecs.slice(n)

  const score = (i: number, j: number): number => {
    let sim = 0
    for (let k = 0; k < origVecs[i].length; k++) sim += origVecs[i][k] * transVecs[j][k]
    const latin = latinHintScore(originals[i], translations[j])
    return sim * 0.7 + latin * 0.3
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  const back: string[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(''))

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = dp[i - 1][j - 1] + score(i - 1, j - 1)
      const up = dp[i - 1][j]
      const left = dp[i][j - 1]
      if (diag >= up && diag >= left) { dp[i][j] = diag; back[i][j] = 'D' }
      else if (up >= left) { dp[i][j] = up; back[i][j] = 'U' }
      else { dp[i][j] = left; back[i][j] = 'L' }
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
}

/**
 * Best-effort automatic pairing: structure-aware slots first, then on-device
 * semantic alignment (slot-level, then line-level) when counts still differ.
 */
export async function smartAttachSecondLanguage(
  primary: TimedLine[],
  secondary: string,
  embedFn?: (texts: string[]) => Promise<number[][]>,
): Promise<SmartAttachResult> {
  const trans = cleanTranslations(extractSecondLanguageLines(secondary))

  const structural = pairTranslationsToPrimary(primary, trans)
  if (structural.method !== 'mismatch') {
    return { lines: structural.lines, mismatchedBlocks: [], method: structural.method }
  }

  if (!embedFn) {
    try {
      if (getDeviceTier() === 'manual') {
        return { lines: structural.lines, mismatchedBlocks: [0], method: 'mismatch' }
      }
      const { embedTexts } = await import('../ai-pipeline/textEmbedder')
      embedFn = embedTexts
    } catch {
      return { lines: structural.lines, mismatchedBlocks: [0], method: 'mismatch' }
    }
  }

  try {
    const originals = primary.map((l) => l.original)
    const slots = expandSlotsAdaptive(originals, trans.length)

    if (slots.length === trans.length && slots.length > 0) {
      const { aligned, extras } = await autoAlignLines(
        slots.map((s) => s.hint),
        trans,
        embedFn,
      )
      if (extras.length === 0) {
        const merged = mergeSlotTranslations(primary.length, slots, aligned)
        return {
          lines: applyTranslations(primary, merged),
          mismatchedBlocks: [],
          method: 'semantic',
        }
      }
    }

    const { aligned, extras } = await autoAlignLines(originals, trans, embedFn)
    const lines = applyTranslations(primary, aligned)
    return {
      lines,
      mismatchedBlocks: extras.length > 0 ? [0] : [],
      method: 'semantic',
    }
  } catch {
    return { lines: structural.lines, mismatchedBlocks: [0], method: 'mismatch' }
  }
}
