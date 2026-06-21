import type { TimedLine, Language } from '../core/types'
import { parseLRC } from './lrc-parser'
import { lineWeight } from '../ai-pipeline/aligner'
import { pairTranslationsToPrimary } from './lineAligner'
import { applyLineTextPatch } from './lineOps'

// Hiragana, Katakana, or CJK ideographs anywhere => treat as Japanese.
export const JAPANESE_RE = /[぀-ヿ㐀-鿿]/
// A bracketed [mm:ss.xx] timestamp marks an LRC (synced) block.
export const LRC_TIMESTAMP_RE = /\[\d{2}:\d{2}[.:]\d{2,3}\]/

export function isSyncedSecondaryLRC(secondary: string): boolean {
  return LRC_TIMESTAMP_RE.test(secondary)
}

/** True when the primary track carries real song timestamps (not all zeros). */
export function primaryHasTiming(primary: TimedLine[]): boolean {
  return primary.some((l) => l.startTime > 0 || l.endTime > 0)
}

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

/**
 * Flatten embedded newlines and, when the paste is one long block but the primary
 * has many lines, split on sentence boundaries so we do not attach the whole song
 * to a single primary row.
 */
export function normalizeTranslationLines(lines: string[], primaryLineCount: number): string[] {
  let flat = lines.flatMap((l) => l.split('\n').map((e) => e.trim()).filter(Boolean))
  if (flat.length !== 1 || primaryLineCount <= 1) return flat

  const sentences = flat[0]
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (sentences.length >= 2 && sentences.length <= primaryLineCount * 1.5) {
    return sentences
  }
  return flat
}

/** Pull translation lines from a paste, preserving blank-line stanza blocks when present. */
export function extractTranslationsForAttach(secondary: string, primaryLineCount: number): string[] {
  const blocks = extractSecondLanguageBlocks(secondary)
  if (blocks.length > 1) {
    return blocks.flatMap((block) => normalizeTranslationLines(block, primaryLineCount))
  }
  return normalizeTranslationLines(extractSecondLanguageLines(secondary), primaryLineCount)
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
export function splitPrimaryIntoBlocks(primary: TimedLine[]): TimedLine[][] {
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

/** Index of the last line whose startTime is <= `time` (lines must be sorted). */
function lastActiveLine(lines: TimedLine[], time: number): number {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startTime <= time) idx = i
    else break
  }
  return idx
}

/**
 * Merge two independently timed lyric tracks into one list aligned to the song.
 * Breakpoints come from the union of both tracks' start times — neither language
 * dictates the other's line structure. Primary text fills `original`, secondary
 * fills `translation`.
 */
export function mergeTimedTracks(primary: TimedLine[], secondary: TimedLine[]): TimedLine[] {
  if (secondary.length === 0) return primary.map((l) => ({ ...l }))
  if (primary.length === 0) {
    return secondary.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      original: '',
      translation: s.translation || s.original,
    }))
  }

  const sec = secondary.map((s) => ({
    ...s,
    translation: s.translation || s.original,
  }))

  const starts = [...new Set([
    ...primary.map((l) => l.startTime),
    ...sec.map((l) => l.startTime),
  ])].sort((a, b) => a - b)

  const lastEnd = Math.max(
    primary[primary.length - 1]?.endTime ?? 0,
    sec[sec.length - 1]?.endTime ?? 0,
  )

  const result: TimedLine[] = []
  let lastTranslationSecIndex = -1
  for (let i = 0; i < starts.length; i++) {
    const t = starts[i]
    const nextT = i < starts.length - 1 ? starts[i + 1] : lastEnd

    const pi = lastActiveLine(primary, t)
    const si = lastActiveLine(sec, t)

    const original = pi >= 0 ? primary[pi].original : ''
    const secStartsHere = si >= 0 && sec[si].startTime === t
    const priStartsHere = pi >= 0 && primary[pi].startTime === t
    let translation = ''
    if (si >= 0) {
      if (priStartsHere && si !== lastTranslationSecIndex) {
        translation = sec[si].translation
        lastTranslationSecIndex = si
      } else if (secStartsHere && !priStartsHere) {
        translation = sec[si].translation
      }
    }

    if (!original && !translation) continue

    const prev = result[result.length - 1]
    if (prev && prev.original === original && prev.translation === translation) {
      prev.endTime = nextT
      continue
    }

    const merged: TimedLine = { startTime: t, endTime: nextT, original, translation }
    if (pi >= 0) {
      if (primary[pi].tokens) merged.tokens = primary[pi].tokens
      if (primary[pi].reading) merged.reading = primary[pi].reading
      if (primary[pi].furigana) merged.furigana = primary[pi].furigana
      if (primary[pi].grammarAnnotations) merged.grammarAnnotations = primary[pi].grammarAnnotations
    }
    result.push(merged)
  }

  return result
}

/**
 * Spread plain-text translation lines across the primary track's song time span
 * proportionally by line length — independent of primary line boundaries.
 */
function timePlainSecondaryToSong(
  texts: string[],
  primary: TimedLine[],
  lang: Language | 'other',
): TimedLine[] {
  if (texts.length === 0) return []
  const timedPrimary = primary.filter((l) => l.startTime > 0 || l.endTime > 0)
  if (timedPrimary.length === 0) {
    return texts.map((t) => ({ startTime: 0, endTime: 0, original: '', translation: t }))
  }

  // Same line count: give each translation the primary line's song timestamps
  // (text is independent; timing comes from the already-aligned primary track).
  if (texts.length === timedPrimary.length) {
    return texts.map((t, i) => ({
      startTime: timedPrimary[i].startTime,
      endTime: timedPrimary[i].endTime,
      original: '',
      translation: t,
    }))
  }

  const songStart = timedPrimary[0].startTime
  const songEnd = Math.max(...timedPrimary.map((l) => l.endTime))
  const duration = Math.max(songEnd - songStart, 0.1)
  const sourceLang: Language = lang === 'ja' ? 'ja' : 'en'
  const weights = texts.map((t) => Math.max(1, lineWeight(t, sourceLang)))
  const total = weights.reduce((a, b) => a + b, 0)

  const result: TimedLine[] = []
  let cum = 0
  for (let i = 0; i < texts.length; i++) {
    cum += weights[i]
    const startFrac = (cum - weights[i]) / total
    const endFrac = cum / total
    result.push({
      startTime: songStart + startFrac * duration,
      endTime: songStart + endFrac * duration,
      original: '',
      translation: texts[i],
    })
  }
  return result
}

/** Parse a synced LRC block into independently timed secondary lines. */
export function parseSecondaryLRC(lrc: string): TimedLine[] {
  return parseLRC(lrc).map((l) => ({
    ...l,
    original: '',
    translation: l.original,
  }))
}

/**
 * Build an independently timed translation track from row-level content pairing.
 * Each non-empty translation (including newline-split slots) inherits its primary
 * row's timestamps; unmapped extras are spread across the song tail.
 */
export function buildSecondaryTimedFromPairing(
  primary: TimedLine[],
  paired: TimedLine[],
  extras: string[] = [],
): TimedLine[] {
  const timed: TimedLine[] = []
  for (let i = 0; i < primary.length; i++) {
    const trans = paired[i]?.translation?.trim()
    if (!trans) continue
    const { startTime, endTime } = primary[i]
    timed.push({ startTime, endTime, original: '', translation: trans })
  }
  if (extras.length > 0) {
    const timedPrimary = primary.filter((l) => l.startTime > 0 || l.endTime > 0)
    if (timedPrimary.length > 0) {
      const songStart = timedPrimary[0].startTime
      const songEnd = Math.max(...timedPrimary.map((l) => l.endTime), songStart + 0.1)
      timed.push(
        ...timePlainSecondaryToSong(extras, [{
          startTime: songStart,
          endTime: songEnd,
          original: '',
          translation: '',
        }], 'other'),
      )
    } else {
      for (const t of extras) {
        timed.push({ startTime: 0, endTime: 0, original: '', translation: t })
      }
    }
  }
  return timed
}

/**
 * Union-timeline merge is for count/structure mismatch. When content pairing
 * already maps one translation row per primary row, keep the row layout.
 */
export function shouldUseTimelineMerge(
  primary: TimedLine[],
  flatTranslations: string[],
  contentMethod: 'index' | 'slots' | 'semantic' | 'timeline' | 'mismatch',
  extras: string[] = [],
): boolean {
  if (contentMethod === 'mismatch') return true
  if (extras.length > 0) return true
  if (flatTranslations.length !== primary.length) return true
  return false
}

/**
 * Merge primary and secondary on a union song timeline. Synced LRC uses its own
 * timestamps; plain text uses content pairing when available, otherwise spreads
 * lines proportionally across the primary song span.
 */
export function mergeSecondLanguageTimeline(
  primary: TimedLine[],
  secondary: string,
  paired: TimedLine[],
  flatTranslations: string[],
  extras: string[] = [],
  contentPairingTrusted = true,
): TimedLine[] {
  if (isSyncedSecondaryLRC(secondary)) {
    return mergeTimedTracks(primary, parseSecondaryLRC(secondary))
  }

  const lang = detectLanguage(secondary)
  const hasPairedContent = contentPairingTrusted && paired.some((l) => l.translation?.trim())
  const secondaryTimed = hasPairedContent
    ? buildSecondaryTimedFromPairing(primary, paired, extras)
    : timePlainSecondaryToSong(flatTranslations, primary, lang)

  if (secondaryTimed.length === 0 && flatTranslations.length > 0) {
    return mergeTimedTracks(primary, timePlainSecondaryToSong(flatTranslations, primary, lang))
  }
  return mergeTimedTracks(primary, secondaryTimed)
}

/**
 * Attach paired translations to a timed primary — row layout when counts match,
 * union timeline when they do not.
 */
export function attachTimedSecondLanguage(
  primary: TimedLine[],
  secondary: string,
  paired: TimedLine[],
  flatTranslations: string[],
  method: 'index' | 'slots' | 'semantic' | 'timeline' | 'mismatch',
  extras: string[] = [],
): TimedLine[] {
  if (isSyncedSecondaryLRC(secondary)) {
    return mergeTimedTracks(primary, parseSecondaryLRC(secondary))
  }
  const trusted = method !== 'mismatch'
  if (!shouldUseTimelineMerge(primary, flatTranslations, method, extras)) {
    return paired
  }
  return mergeSecondLanguageTimeline(
    primary,
    secondary,
    paired,
    flatTranslations,
    extras,
    trusted,
  )
}

/**
 * Attach a second-language block by normalizing both sides to the song timeline.
 *
 * When the primary is already timed, the secondary is given its own independent
 * timing (from synced LRC timestamps, or spread across the song span for plain
 * text) and the two tracks are merged on a union timeline — the translation
 * no longer inherits the primary's line structure.
 *
 * When the primary is untimed, falls back to flat index pairing and stanza-block
 * pairing so the user can fix mismatches manually.
 */
export function attachSecondLanguage(primary: TimedLine[], secondary: string): AttachResult {
  const flatSecondary = stripNonLyricLines(extractSecondLanguageLines(secondary))

  if (primaryHasTiming(primary)) {
    const slotPair = pairTranslationsToPrimary(primary, flatSecondary)
    const lines = attachTimedSecondLanguage(
      primary,
      secondary,
      slotPair.lines,
      flatSecondary,
      slotPair.method,
    )
    return { lines, mismatchedBlocks: [] }
  }

  const slotPair = pairTranslationsToPrimary(primary, flatSecondary)
  if (slotPair.method !== 'mismatch') {
    return { lines: slotPair.lines, mismatchedBlocks: [] }
  }

  const primaryBlocks = splitPrimaryIntoBlocks(primary)
  const secondaryBlocks = extractSecondLanguageBlocks(secondary)

  if (primaryBlocks.length !== secondaryBlocks.length || primaryBlocks.length <= 1) {
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
  return existing.map((line, i) => applyLineTextPatch(line, {
    original: pairs[i]?.original ?? line.original,
    translation: pairs[i]?.translation ?? line.translation,
  }))
}
