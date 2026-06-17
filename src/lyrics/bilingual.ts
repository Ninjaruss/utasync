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

const GAP_THRESHOLD_S = 4

// Common non-lyric annotation lines that show up in pasted/LRCLIB text but
// aren't actually sung — stripping them before counting avoids false
// line-count mismatches.
const HEADER_RE = /^(\[.*\]|\(.*\))$|^(verse\s*\d*|chorus|bridge|intro|outro|hook)[:.]?$/i

export function stripNonLyricLines(lines: string[]): string[] {
  return lines.filter((l) => !HEADER_RE.test(l.trim()))
}

/** Split raw second-language text into blank-line-delimited stanza blocks, header-stripped. */
export function extractSecondLanguageBlocks(secondary: string): string[][] {
  if (LRC_TIMESTAMP_RE.test(secondary)) {
    return [stripNonLyricLines(extractSecondLanguageLines(secondary))]
  }
  const blocks: string[][] = []
  let current: string[] = []
  for (const raw of secondary.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) {
      if (current.length) { blocks.push(stripNonLyricLines(current)); current = [] }
      continue
    }
    current.push(trimmed)
  }
  if (current.length) blocks.push(stripNonLyricLines(current))
  return blocks.filter((b) => b.length > 0)
}

/** Split already-timed primary lines into stanza blocks using gaps between line starts as a proxy for blank-line stanza breaks (which don't survive into TimedLine[]). Untimed primary stays a single block, so any mismatch always falls back to flat pairing — there's no timing signal to detect stanza boundaries on that side. */
function splitPrimaryIntoBlocks(primary: TimedLine[]): TimedLine[][] {
  if (!primary.some((l) => l.endTime > 0)) return [primary]
  const blocks: TimedLine[][] = []
  let current: TimedLine[] = []
  for (let i = 0; i < primary.length; i++) {
    current.push(primary[i])
    const next = primary[i + 1]
    if (next && next.startTime - primary[i].startTime > GAP_THRESHOLD_S) {
      blocks.push(current)
      current = []
    }
  }
  if (current.length) blocks.push(current)
  return blocks
}

export interface AttachResult {
  lines: TimedLine[]
  /** Indices into the detected stanza blocks whose line counts didn't match — these need manual review. Empty when everything paired cleanly. */
  mismatchedBlocks: number[]
}

/**
 * Attach a second-language block onto the primary timed lines' `translation`
 * field, preserving primary timing/text. Tries a flat whole-song index pairing
 * first (today's behavior, unaffected by header-stripping when counts already
 * matched). Only when flat counts mismatch does it attempt to localize the
 * mismatch to specific stanza blocks — and only when both sides produce the
 * same number of blocks and that count is more than 1, so a single stray
 * blank line never fragments an otherwise-clean pairing.
 */
export function attachSecondLanguage(primary: TimedLine[], secondary: string): AttachResult {
  const flatSecondary = stripNonLyricLines(extractSecondLanguageLines(secondary))

  if (flatSecondary.length === primary.length) {
    const lines = primary.map((line, i) => ({ ...line, translation: flatSecondary[i] ?? '' }))
    return { lines, mismatchedBlocks: [] }
  }

  const primaryBlocks = splitPrimaryIntoBlocks(primary)
  const secondaryBlocks = extractSecondLanguageBlocks(secondary)

  if (primaryBlocks.length !== secondaryBlocks.length || primaryBlocks.length <= 1) {
    // Degraded flat best-effort pairing, not block-scoped: there's no real
    // "block 0" here, so `mismatchedBlocks: [0]` is an overloaded signal
    // meaning "the whole song", not a detected stanza block.
    const lines = primary.map((line, i) => ({ ...line, translation: flatSecondary[i] ?? '' }))
    return { lines, mismatchedBlocks: [0] }
  }

  const mismatchedBlocks: number[] = []
  const lines: TimedLine[] = []
  for (let b = 0; b < primaryBlocks.length; b++) {
    const pBlock = primaryBlocks[b]
    const sBlock = secondaryBlocks[b] ?? []
    if (sBlock.length !== pBlock.length) mismatchedBlocks.push(b)
    for (let i = 0; i < pBlock.length; i++) {
      lines.push({ ...pBlock[i], translation: sBlock[i] ?? '' })
    }
  }
  return { lines, mismatchedBlocks }
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
