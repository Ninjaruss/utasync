import type { LineAlignmentQuality, TimedLine } from '../core/types'
import {
  CONTENT_CONFIDENCE_THRESHOLD,
  sanitizeTranscript,
  type TranscriptWord,
} from './aligner'
import { normalizeForMatch } from './contentAligner'
import {
  capUnanchoredGapFillTails,
  enforceLineDisplayFloor,
  refineAlignmentWithPhrases,
  syncPhrasesFromValidatedLines,
  type RefinedAlignment,
} from '../lyrics/phraseAlignment'
import { applyLabelHonesty } from '../lyrics/labelHonesty'

const JA_SCRIPT_RE = /[぀-ヿ㐀-鿿]/

/** Which transcription pass a merged line's timing was taken from. */
export type MixedPassSource = 'ja' | 'en'

/** A line carrying any JA glyph is sung Japanese; otherwise it is Latin. */
export function linePassPreference(text: string): MixedPassSource {
  return JA_SCRIPT_RE.test(text) ? 'ja' : 'en'
}

/** Fraction of the sheet's normalized characters that sit on lines of each
 * script. A single-language pass over a mixed sheet can only ever match its
 * own script's share, so the content-vs-proportional confidence gate must be
 * scaled by that share (see alignByContent: confidence = matched / ALL chars). */
export function scriptCharFractions(lineTexts: string[]): { ja: number; en: number } {
  let ja = 0
  let en = 0
  for (const t of lineTexts) {
    const chars = normalizeForMatch(t).length
    if (linePassPreference(t) === 'ja') ja += chars
    else en += chars
  }
  const total = ja + en
  if (total === 0) return { ja: 0.5, en: 0.5 }
  return { ja: ja / total, en: en / total }
}

/** Never accept a pass on noise alone, however small its script share. */
const MIN_SCOPED_THRESHOLD = 0.08

export function scopedConfidenceThreshold(scriptFraction: number): number {
  return Math.max(MIN_SCOPED_THRESHOLD, CONTENT_CONFIDENCE_THRESHOLD * scriptFraction)
}

const QUALITY_RANK: Record<LineAlignmentQuality, number> = {
  good: 2,
  approximate: 1,
  needs_review: 0,
}

function lineRank(pass: RefinedAlignment, li: number): number {
  // A pass that fell back to proportional carries no per-line evidence — its
  // quality labels grade interpolated placements, so it must lose every
  // comparison against a content-mode pass.
  if (pass.mode === 'proportional') return -1
  return QUALITY_RANK[pass.lineAlignmentQuality?.[li] ?? 'needs_review']
}

export interface MixedMergeResult {
  refined: RefinedAlignment
  /** Per line: which pass the merged timing came from. */
  pickedFrom: MixedPassSource[]
}

/**
 * Merge two single-language alignments of the SAME mixed-language sheet into
 * one: each line takes its timing from whichever pass anchored it better; ties
 * go to the line's own script (a JA-glyph line trusts the JA-forced pass, a
 * Latin line the EN-forced pass). Monotonicity is repaired by falling back to
 * the other pass, then clamping.
 */
export function mergeMixedRefinedAlignments(
  ja: RefinedAlignment,
  en: RefinedAlignment,
  lineTexts: string[],
): MixedMergeResult {
  const n = lineTexts.length
  const pickedFrom: MixedPassSource[] = []
  const lines: TimedLine[] = []
  const quality: LineAlignmentQuality[] = []
  const anchorSources: NonNullable<RefinedAlignment['anchorSources']> = []

  const passOf = (src: MixedPassSource) => (src === 'ja' ? ja : en)

  for (let li = 0; li < n; li++) {
    const jaRank = lineRank(ja, li)
    const enRank = lineRank(en, li)
    let src: MixedPassSource
    if (jaRank !== enRank) src = jaRank > enRank ? 'ja' : 'en'
    else src = linePassPreference(lineTexts[li])

    // Monotonic repair: a cross-pass pick that jumps backward is a mis-anchor
    // (e.g. the EN pass matched a chorus reprise). Prefer the other pass when
    // it restores order; otherwise clamp to the previous start.
    const prevStart = lines[li - 1]?.startTime ?? 0
    let line = passOf(src).lines[li]
    if (line.startTime < prevStart) {
      const other: MixedPassSource = src === 'ja' ? 'en' : 'ja'
      const alt = passOf(other).lines[li]
      if (alt.startTime >= prevStart && lineRank(passOf(other), li) >= 0) {
        src = other
        line = alt
      } else {
        line = {
          ...line,
          startTime: prevStart,
          endTime: Math.max(line.endTime, prevStart),
        }
      }
    }

    pickedFrom.push(src)
    lines.push({ ...line })
    quality.push(passOf(src).lineAlignmentQuality?.[li] ?? 'needs_review')
    anchorSources.push(passOf(src).anchorSources?.[li] ?? 'interpolated')
  }

  // Same final stitch as refineAlignmentWithPhrases: ends never cross the next
  // line's start (rests during instrumental gaps stay visible).
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && lines[i].startTime < lines[i - 1].startTime) {
      lines[i].startTime = lines[i - 1].startTime
    }
    const ownEnd = Math.max(lines[i].endTime, lines[i].startTime)
    lines[i].endTime = Math.min(ownEnd, lines[i + 1]?.startTime ?? ownEnd)
  }

  // The stitch runs AFTER each pass's own display-floor expansion and can
  // re-create zero-width rows (cross-pass co-starts on a shared chunk) — the
  // merged sequence needs the floor re-applied.
  const floored = enforceLineDisplayFloor(lines)

  // Phrase layout follows the pass that supplied the majority of lines; phrase
  // windows re-sync to the merged line timings.
  const enPicked = pickedFrom.filter((s) => s === 'en').length
  const base = enPicked > n / 2 ? en : ja
  const phrases = syncPhrasesFromValidatedLines(base.phrases, floored)

  // The passes match near-disjoint char sets (each ~its script's share), so the
  // sheet-wide matched fraction is approximately the sum.
  const confidence = Math.min(1, ja.confidence + en.confidence)
  const mode = ja.mode === 'content' || en.mode === 'content' ? 'content' : 'proportional'

  return {
    refined: {
      lines: floored,
      phrases,
      report: base.report,
      mode,
      confidence,
      anchorSources,
      lineAlignmentQuality: quality,
      phraseLayout: 'sheet',
      sheetLinesSnapshot: undefined,
    },
    pickedFrom,
  }
}

/** Overlap (seconds) between a word and a line window. */
function overlapS(w: TranscriptWord, l: TimedLine): number {
  return Math.min(w.endTime, l.endTime) - Math.max(w.startTime, l.startTime)
}

/**
 * Transcript to store on the song: JA-pass words everywhere except inside
 * lines the merge assigned to the EN pass (there the JA pass transcribed
 * English audio as katakana soup), which take the EN pass's words instead.
 * Reading reconciliation and word-level realign both consume this.
 */
export function mergeMixedTranscripts(
  jaWords: TranscriptWord[],
  enWords: TranscriptWord[],
  lines: TimedLine[],
  pickedFrom: MixedPassSource[],
): TranscriptWord[] {
  const enLines = lines.filter((_, i) => pickedFrom[i] === 'en')
  const mostlyInEnLine = (w: TranscriptWord): boolean => {
    const dur = Math.max(0.01, w.endTime - w.startTime)
    return enLines.some((l) => overlapS(w, l) > dur / 2)
  }
  const merged = [
    ...sanitizeTranscript(jaWords).filter((w) => !mostlyInEnLine(w)),
    ...sanitizeTranscript(enWords).filter((w) => mostlyInEnLine(w)),
  ]
  merged.sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)
  return merged
}

export interface MixedAlignmentResult {
  refined: RefinedAlignment
  transcriptWords: TranscriptWord[]
  pickedFrom: MixedPassSource[]
}

/**
 * Align a mixed-language (code-switching) sheet from two forced-language
 * transcription passes of the same audio. Replaces the old single-pass
 * auto-detect path, whose per-chunk language flapping collapsed content-match
 * confidence and dropped the whole song to proportional distribution.
 */
export function refineMixedLanguageAlignment(
  sheetRows: TimedLine[],
  jaWords: TranscriptWord[],
  enWords: TranscriptWord[],
  vocalActivity?: import('./vocalActivity').VocalActivitySignal,
): MixedAlignmentResult {
  const lineTexts = sheetRows.map((l) => l.original || l.translation)
  const frac = scriptCharFractions(lineTexts)
  // Each pass aligns the FULL sheet (row indices and monotonicity must line
  // up), with the confidence gate scaled to the share it can possibly match.
  // Inner passes skip the label-honesty demotion: the merge below picks lines
  // by quality rank, so demoting per pass would flip merge picks. Honesty runs
  // once on the merged result against the merged transcript instead.
  const jaPass = refineAlignmentWithPhrases(sheetRows, jaWords, 'mixed', undefined, {
    contentConfidenceThreshold: scopedConfidenceThreshold(frac.ja),
    skipLabelHonesty: true,
  })
  const enPass = refineAlignmentWithPhrases(sheetRows, enWords, 'mixed', undefined, {
    contentConfidenceThreshold: scopedConfidenceThreshold(frac.en),
    skipLabelHonesty: true,
  })
  const { refined, pickedFrom } = mergeMixedRefinedAlignments(jaPass, enPass, lineTexts)
  const transcriptWords = mergeMixedTranscripts(jaWords, enWords, refined.lines, pickedFrom)
  // Cap over-long unanchored gap-fill tails against the MERGED transcript, so a
  // JA line the EN pass hallucinated katakana/romaji over (and vice-versa) reads
  // its true coverage 0. Runs AFTER the merge's stitch + enforceLineDisplayFloor;
  // the cap only ever shortens a tail toward expectedLineDuration (>=
  // MIN_HIGHLIGHT_S), so it can never create a sub-floor row and the floor stays
  // satisfied. Ends only — starts (which the LRC audit measures) are untouched.
  const cappedLines = capUnanchoredGapFillTails(refined.lines, transcriptWords, lineTexts, 'mixed')
  refined.lines = cappedLines
  refined.phrases = syncPhrasesFromValidatedLines(refined.phrases, cappedLines)
  // Label-honesty demotion on the merged result (skipped per pass above): the
  // merged transcript reads true cross-language coverage, so chunk-sharing,
  // clipped-tail, and contested-occurrence 'good' labels demote here.
  refined.lineAlignmentQuality = applyLabelHonesty({
    lines: cappedLines,
    lineTexts,
    quality: refined.lineAlignmentQuality ?? [],
    words: sanitizeTranscript(transcriptWords),
    mode: refined.mode,
    vocalActivity,
  })
  return { refined, transcriptWords, pickedFrom }
}
