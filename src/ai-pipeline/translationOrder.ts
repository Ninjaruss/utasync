import type { TimedLine, Token } from '../core/types'
import { splitTranslationWords } from '../language/wordColors'
import { isAlignableToken, isAlignableEnglishWord, normalizeEnglishAlignmentWord } from '../core/language'
import { JAPANESE_RE } from '../lyrics/bilingual'
import { glossMatchesTarget } from './lyricGloss'
import { tokenGlossText } from './wordAligner'

const LATIN_WORD = /[A-Za-z]/

function isMixedScriptLine(text: string): boolean {
  const t = text.trim()
  return LATIN_WORD.test(t) && JAPANESE_RE.test(t)
}

function alignableEnWords(translation: string): string[] {
  return splitTranslationWords(translation)
    .filter((w) => isAlignableEnglishWord(w))
    .map((w) => normalizeEnglishAlignmentWord(w))
}

/** Gloss hit rate between JA tokens and an English translation line. */
export function lineGlossAffinity(tokens: Token[], translation: string): number {
  const trimmed = translation.trim()
  if (!trimmed) return 0
  const { words: enWords } = { words: alignableEnWords(trimmed) }
  if (enWords.length === 0) return 0

  let hits = 0
  for (const token of tokens) {
    if (!isAlignableToken(token)) continue
    const gloss = tokenGlossText(token)
    for (const w of enWords) {
      if (glossMatchesTarget(gloss, w)) {
        hits++
        break
      }
    }
  }
  return hits / enWords.length
}

/**
 * True when consecutive EN lines appear to swap clause order relative to JA.
 * Common when translators front-load the main clause on the prior English row.
 */
export function adjacentTranslationsSwapped(line0: TimedLine, line1: TimedLine): boolean {
  const tokens0 = line0.tokens
  const tokens1 = line1.tokens
  const en0 = line0.translation?.trim()
  const en1 = line1.translation?.trim()
  if (!tokens0?.length || !tokens1?.length || !en0 || !en1) return false
  if (isMixedScriptLine(line0.original) || isMixedScriptLine(line1.original)) return false
  if (!JAPANESE_RE.test(line0.original) || !JAPANESE_RE.test(line1.original)) return false

  const direct0 = lineGlossAffinity(tokens0, en0)
  const direct1 = lineGlossAffinity(tokens1, en1)
  const cross0 = lineGlossAffinity(tokens0, en1)
  const cross1 = lineGlossAffinity(tokens1, en0)
  const direct = direct0 + direct1
  const swapped = cross0 + cross1
  // A genuine clause inversion leaves evidence on BOTH rows: each row's tokens
  // prefer the other row's English. A one-sided margin is typically a single
  // spurious JMdict gloss hit on a short line (e.g. 状態→"want"), so require
  // every row to individually beat its direct affinity before swapping.
  return cross0 > direct0 && cross1 > direct1 && swapped > direct + 0.12 && swapped > direct * 1.2
}

/**
 * Swaps translation text on adjacent lines when fan translations front-load the
 * wrong English clause. Fixes both subtitle display and word-pair coloring.
 */
export function fixAdjacentTranslationOrder(lines: TimedLine[]): TimedLine[] {
  const out = lines.map((line) => ({ ...line }))
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]!
    const b = out[i + 1]!
    if (!adjacentTranslationsSwapped(a, b)) continue
    out[i] = { ...a, translation: b.translation }
    out[i + 1] = { ...b, translation: a.translation }
  }
  return out
}
