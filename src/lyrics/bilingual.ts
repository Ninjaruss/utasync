import type { TimedLine, Language } from '../core/types'
import { parseLRC } from './lrc-parser'

// Hiragana, Katakana, or CJK ideographs anywhere => treat as Japanese.
const JAPANESE_RE = /[぀-ヿ㐀-鿿]/
// A bracketed [mm:ss.xx] timestamp marks an LRC (synced) block.
const LRC_TIMESTAMP_RE = /\[\d{2}:\d{2}[.:]\d{2,3}\]/

/**
 * Case- and whitespace-insensitive equality used to suppress redundant display
 * lines (e.g. romaji or a "translation" that just repeats the original). Empty
 * or undefined operands are never considered equal.
 */
export function isSameText(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  return norm(a) === norm(b)
}

/**
 * A line has a translation worth displaying only when it exists and isn't just
 * a duplicate of the original (the English-song case where a "translation" or
 * romaji repeats the source text). Display predicates should use this rather
 * than raw `line.translation` truthiness so toggles don't appear for nothing.
 */
export function hasVisibleTranslation(line: { original: string; translation?: string }): boolean {
  return !!line.translation && !isSameText(line.translation, line.original)
}

/**
 * Coarse language detection used to keep Japanese as the primary line
 * regardless of paste order, and to pick which language to fetch as the
 * opposite. Returns 'ja' when any kana/kanji is present, else 'other'.
 */
export function detectLanguage(text: string): Language | 'other' {
  return JAPANESE_RE.test(text) ? 'ja' : 'other'
}

/** Pull the plain text lines out of either an LRC block or raw pasted text. */
export function extractSecondLanguageLines(secondary: string): string[] {
  if (LRC_TIMESTAMP_RE.test(secondary)) {
    return parseLRC(secondary).map((l) => l.original).filter((t) => t.length > 0)
  }
  return secondary
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

export interface AttachResult {
  lines: TimedLine[]
  /** True when line counts differ and the user should confirm pairings. */
  needsAlignment: boolean
}

/**
 * Attach a second-language block (plain text or synced LRC) onto the primary
 * timed lines' `translation` field, preserving the primary timing and text.
 * When counts match, pairs by index; otherwise returns a best-effort pairing
 * and signals that the AlignmentEditor should be shown.
 */
export function attachSecondLanguage(primary: TimedLine[], secondary: string): AttachResult {
  const secondaryTexts = extractSecondLanguageLines(secondary)
  const needsAlignment = secondaryTexts.length !== primary.length
  const lines = primary.map((line, i) => ({
    ...line,
    translation: secondaryTexts[i] ?? '',
  }))
  return { lines, needsAlignment }
}

/**
 * Overlay confirmed { original, translation } pairs (from AlignmentEditor) onto
 * existing timed lines by index, preserving each line's timing and falling back
 * to existing text where a pair is absent.
 */
export function pairsToTimedLines(
  existing: TimedLine[],
  pairs: Array<{ original: string; translation: string }>,
): TimedLine[] {
  return existing.map((line, i) => ({
    ...line,
    original: pairs[i]?.original ?? line.original,
    translation: pairs[i]?.translation ?? line.translation,
  }))
}
