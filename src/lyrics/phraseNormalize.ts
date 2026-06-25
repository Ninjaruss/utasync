import type { SungPhrase, TimedLine, TimedTranscriptWord, PhraseAnchorSource, LyricsData } from '../core/types'
import type { LineAnchorSource } from '../ai-pipeline/contentAligner'
import { adjacentTranslationsSwapped } from '../ai-pipeline/translationOrder'

export interface PhraseNormalizeReport {
  /** Rows that were broken into multiple phrases. */
  splits: number
  /** Phrases that absorbed more than one source row. */
  merges: number
  /** Phrases whose timing came from interpolation/interjection rather than an LCS anchor. */
  lowConfidence: number
}

function lineAnchor(anchorSources: LineAnchorSource[] | undefined, i: number): PhraseAnchorSource {
  return (anchorSources?.[i] as PhraseAnchorSource | undefined) ?? 'interpolated'
}

function makeId(sourceLineIndices: number[]): string {
  return `phrase-${sourceLineIndices.join('-')}`
}

/** A short row that lacks its own audio anchor is a continuation of the previous
 * sung breath rather than a phrase of its own. */
const MAX_MERGE_DURATION = 4

/** Minimum silent gap (seconds) between transcript clusters to treat a row as
 * covering two distinct sung phrases. */
const SPLIT_GAP = 1.5

/** Phrase-boundary markers a paste uses to separate two clauses on one row. */
const ORIGINAL_BOUNDARY = /[\u3000\t]|\s\/\s|\s\|\s/
const TRANSLATION_BOUNDARY = /\s\/\s|\s\|\s|\n/

interface Cluster {
  start: number
  end: number
}

/** Group transcript words falling inside [start, end] into clusters separated by
 * silent gaps of at least SPLIT_GAP seconds. */
function clusterWords(words: TimedTranscriptWord[], start: number, end: number): Cluster[] {
  const inWindow = words
    .filter((w) => {
      const mid = (w.startTime + w.endTime) / 2
      return mid >= start && mid <= end
    })
    .sort((a, b) => a.startTime - b.startTime)
  const clusters: Cluster[] = []
  for (const w of inWindow) {
    const last = clusters[clusters.length - 1]
    if (last && w.startTime - last.end < SPLIT_GAP) {
      last.end = Math.max(last.end, w.endTime)
    } else {
      clusters.push({ start: w.startTime, end: w.endTime })
    }
  }
  return clusters
}

/** Split one phrase into two at its text boundary when the transcript shows two
 * clusters separated by a silent gap. Returns null when the row is one sung unit. */
function splitPhrase(phrase: SungPhrase, words: TimedTranscriptWord[]): [SungPhrase, SungPhrase] | null {
  const boundary = phrase.original.match(ORIGINAL_BOUNDARY)
  if (!boundary || boundary.index === undefined) return null
  const clusters = clusterWords(words, phrase.startTime, phrase.endTime)
  if (clusters.length < 2) return null

  const before = phrase.original.slice(0, boundary.index).trim()
  const after = phrase.original.slice(boundary.index + boundary[0].length).trim()
  if (!before || !after) return null

  // Boundary time sits in the silent gap between the first two clusters.
  const split = (clusters[0].end + clusters[1].start) / 2
  const transParts = phrase.translation.split(TRANSLATION_BOUNDARY).map((t) => t.trim())
  const [transA, transB] = transParts.length === 2 ? transParts : [phrase.translation.trim(), '']
  const [src] = phrase.sourceLineIndices

  return [
    {
      id: `phrase-${src}a`,
      startTime: phrase.startTime,
      endTime: split,
      original: before,
      translation: transA,
      anchorSource: phrase.anchorSource,
      sourceLineIndices: [src],
    },
    {
      id: `phrase-${src}b`,
      startTime: split,
      endTime: phrase.endTime,
      original: after,
      translation: transB,
      anchorSource: phrase.anchorSource,
      sourceLineIndices: [src],
    },
  ]
}

function joinText(a: string, b: string): string {
  const left = a.trim()
  const right = b.trim()
  if (!left) return right
  if (!right) return left
  return `${left} ${right}`
}

/** True when row `i` is a continuation rather than a phrase of its own — an
 * EN-only/blank row, or a short row with no independent LCS anchor. */
function isContinuationRow(
  lines: TimedLine[],
  anchorSources: LineAnchorSource[] | undefined,
  i: number,
): boolean {
  const line = lines[i]
  // EN-only / blank original rows are always a continuation of the sung phrase.
  if (!line.original.trim()) return true
  const duration = Math.max(0, line.endTime - line.startTime)
  const anchor = lineAnchor(anchorSources, i)
  return anchor !== 'lcs' && duration < MAX_MERGE_DURATION
}

/** True when row `i` should be folded into the phrase before it. */
function shouldMergeIntoPrev(
  lines: TimedLine[],
  anchorSources: LineAnchorSource[] | undefined,
  i: number,
): boolean {
  return i > 0 && isContinuationRow(lines, anchorSources, i)
}

/** True when a leading row should attach forward onto the next sung phrase.
 * The next row must itself be an independent phrase, not another continuation. */
function shouldMergeForward(
  lines: TimedLine[],
  anchorSources: LineAnchorSource[] | undefined,
  i: number,
): boolean {
  return (
    isContinuationRow(lines, anchorSources, i) &&
    !isContinuationRow(lines, anchorSources, i + 1)
  )
}

/** Re-pair translations across the canonical phrase list, swapping adjacent EN
 * clauses when a fan translation front-loaded the wrong one. Reuses the line-level
 * detector (gated on tokens), so it is a safe no-op until phrases are tokenized in
 * Phase 2 — phrase identity fields (id, sourceLineIndices, anchorSource) are kept. */
export function repairPhraseTranslationOrder(phrases: SungPhrase[]): SungPhrase[] {
  const out = phrases.map((p) => ({ ...p }))
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]
    const b = out[i + 1]
    if (!adjacentTranslationsSwapped(a, b)) continue
    const swap = a.translation
    out[i] = { ...a, translation: b.translation }
    out[i + 1] = { ...b, translation: swap }
  }
  return out
}

/** Whether a stored song should derive its phrase layer on open (Phase 5 migration):
 * an auto-aligned song that has a transcript but no phrases yet. Manual-only songs
 * (no transcript) and songs that already carry phrases are skipped. */
export function shouldDerivePhrasesForStoredSong(lyrics: LyricsData): boolean {
  if (lyrics.phrases?.length) return false
  if (!lyrics.lines.length) return false
  return !!lyrics.transcriptWords?.length
}

/** Derive canonical sung phrases from already-aligned rows + the audio transcript.
 * The pasted sheet (`lines`) is never mutated; this only produces an additive layer. */
export function derivePhrases(
  lines: TimedLine[],
  transcriptWords: TimedTranscriptWord[],
  anchorSources?: LineAnchorSource[],
): { phrases: SungPhrase[]; report: PhraseNormalizeReport } {
  const merged: SungPhrase[] = []
  let merges = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const prev = merged[merged.length - 1]
    // A mergeable row with no phrase before it (leading EN-only / interpolated)
    // attaches forward onto the next sung phrase instead.
    if (!prev && i + 1 < lines.length && shouldMergeForward(lines, anchorSources, i)) {
      const next = lines[i + 1]
      merged.push({
        id: makeId([i, i + 1]),
        startTime: l.startTime,
        endTime: Math.max(l.endTime, next.endTime),
        original: joinText(l.original, next.original),
        translation: joinText(l.translation, next.translation),
        anchorSource: lineAnchor(anchorSources, i + 1),
        sourceLineIndices: [i, i + 1],
      })
      merges++
      i++ // consumed the next row as well
      continue
    }
    if (prev && shouldMergeIntoPrev(lines, anchorSources, i)) {
      prev.original = joinText(prev.original, l.original)
      prev.translation = joinText(prev.translation, l.translation)
      prev.endTime = Math.max(prev.endTime, l.endTime)
      prev.sourceLineIndices.push(i)
      prev.id = makeId(prev.sourceLineIndices)
      merges++
      continue
    }
    merged.push({
      id: makeId([i]),
      startTime: l.startTime,
      endTime: l.endTime,
      original: l.original,
      translation: l.translation,
      anchorSource: lineAnchor(anchorSources, i),
      sourceLineIndices: [i],
    })
  }

  // Split single-row phrases that the transcript shows span two sung clusters.
  const split: SungPhrase[] = []
  let splits = 0
  for (const phrase of merged) {
    const parts = phrase.sourceLineIndices.length === 1 ? splitPhrase(phrase, transcriptWords) : null
    if (parts) {
      split.push(...parts)
      splits++
    } else {
      split.push(phrase)
    }
  }

  const phrases = repairPhraseTranslationOrder(split)
  const lowConfidence = phrases.filter((p) => p.anchorSource !== 'lcs').length
  return { phrases, report: { splits, merges, lowConfidence } }
}
