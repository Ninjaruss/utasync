import type { LineAlignmentQuality, TimedLine } from '../core/types'
import type { TranscriptWord } from '../ai-pipeline/aligner'
import {
  computeLineMatchedSpans,
  normalizeForMatch,
  type LineMatchedSpan,
} from '../ai-pipeline/contentAligner'
import { minLineDuration, COMPRESSION_FRACTION } from './lineDegeneracy'
import { voicedFraction } from '../ai-pipeline/vocalActivity'

/**
 * Label-honesty pass (2026-07 line-accuracy audit): demote 'good' per-line
 * quality labels whose timing the transcript evidence cannot actually vouch
 * for. The window-based scorer behind the labels answers "does matching audio
 * exist within ±6/8s of the line?" — it stays 'good' when a line sits on the
 * wrong occurrence of a repeated phrase, inherits a boundary interpolated
 * inside a multi-line segment chunk, or ends before its own sung tail. Ground
 * truth (LRC + caption onsets over the audit corpus) measured 41 'good' lines
 * that start >1.5s from the truth; the gates below catch 22 of them plus the
 * structurally unverifiable boundaries, at zero measured collateral on lines
 * whose starts are provably correct... except where the gate is *supposed* to
 * fire on a provably-correct start because the END is unverifiable (shared
 * chunks, clipped tails).
 *
 * Strictly label-only and strictly downward: timing is never changed, labels
 * only ever move 'good' → 'approximate'. needs_review is never produced here,
 * so gap-hole detection (enumerateGapHoles) and the gap-realign acceptance
 * counters are unaffected.
 */

export interface LabelHonestyInput {
  lines: readonly TimedLine[]
  /** Alignable text per line (original, or translation when no original). */
  lineTexts: readonly string[]
  quality: readonly LineAlignmentQuality[]
  /** SANITIZED transcript; the merged transcript on the mixed two-pass path. */
  words: readonly TranscriptWord[]
  /** Alignment mode of the content pass ('content' | 'proportional'). */
  mode: string
  /** Timing-independent attributed spans (computeLineMatchedSpans over
   * lineTexts × words); recomputed when omitted. Pass the caller's copy when
   * one is already at hand to avoid a second LCS. */
  spans?: ReadonlyArray<LineMatchedSpan | null>
  /** Audio-derived vocal-activity envelope (fresh-align only); enables the
   * acoustic gate. Absent → no acoustic demotion. */
  vocalActivity?: import('../ai-pipeline/vocalActivity').VocalActivitySignal
}

/** A transcript word longer than this is a segment-mode phrase chunk, not a
 * sung word (mirrors boundaryMetrics MID_WORD_MAX_DURATION_S). */
const CHUNK_MIN_DURATION_S = 2.5
/** A line "belongs to" a chunk when their overlap exceeds this (mirrors
 * findMergedLineGroups). */
const CHUNK_OVERLAP_S = 0.3
/** Attributed evidence past the line end farther than this is a clipped tail. */
const TAIL_OVERHANG_S = 0.75
/** ...unless the overhang reaches into the next line's own evidence (shared /
 * ambiguously attributed audio), with this much slack. */
const NEXT_EVIDENCE_SLACK_S = 0.3
/** Minimum attributed-span coverage before span-based gates apply to a line. */
const SPAN_MIN_COVERAGE = 0.35
/** A neighbour with less local evidence than this is part of an evidence
 * desert (see isDesertLine). */
const DESERT_LOCAL_COVERAGE = 0.15
/** Desert-context window: this many neighbours on a side, of which
 * DESERT_MIN_NEIGHBORS must be desert lines. */
const DESERT_WINDOW = 3
const DESERT_MIN_NEIGHBORS = 2
/** A 'good' line whose window is voiced below this fraction is acoustically
 * unsupported (intro / instrumental break / Whisper hallucination). Low +
 * conservative: only near-silent windows demote (see VOICED_THRESHOLD). */
const STEM_MIN_VOICED_FRAC = 0.1
/** On a raw-mix signal the prior is weaker: require an even lower bar AND spare
 * lines with strong lexical coverage (quiet vocals under loud instruments). */
const MIX_MIN_VOICED_FRAC = 0.05

/**
 * Whether a line is part of an "evidence desert" — a stretch the aligner could
 * not verify against the transcript: needs_review, or approximate with (a)
 * almost no local matched evidence or (b) a span squashed below the
 * compression floor. That combination is the signature of lines interpolated
 * across a transcript hole. Shared by the label-honesty desert-context gate
 * and gap-hole detection (enumerateGapHoles), so "what counts as a hole"
 * cannot silently diverge between labeling and recovery.
 */
export function isEvidenceDesertLine(
  line: TimedLine,
  lineText: string,
  quality: LineAlignmentQuality | undefined,
  words: readonly TranscriptWord[],
): boolean {
  if (quality === 'needs_review') return true
  if (quality !== 'approximate') return false
  const compressed =
    line.endTime - line.startTime < minLineDuration(lineText) * COMPRESSION_FRACTION
  if (compressed) return true
  const windowWords = words.filter(
    (w) => w.endTime > line.startTime - 3 && w.startTime < line.endTime + 6,
  )
  const local = windowWords.length
    ? computeLineMatchedSpans([lineText], windowWords)[0]
    : null
  const localCov = local ? local.matchedChars / Math.max(1, local.totalChars) : 0
  return localCov < DESERT_LOCAL_COVERAGE
}

export function applyLabelHonesty(input: LabelHonestyInput): LineAlignmentQuality[] {
  const { lines, lineTexts, mode } = input
  const quality = [...input.quality]
  const demote = (i: number) => {
    if (quality[i] === 'good') quality[i] = 'approximate'
  }

  // Gate 1 — proportional cap. In proportional mode the content match fell
  // through globally and every line is interpolated; a window score of 'good'
  // there is a char-bigram coincidence (measured: autolang configs emitted 5
  // 'good' labels with 12–94s true start errors).
  if (mode === 'proportional') {
    for (let i = 0; i < quality.length; i++) demote(i)
    return quality
  }

  const words = input.words
  const spans = input.spans ?? computeLineMatchedSpans([...lineTexts], [...words])
  const coverage = (i: number): number => {
    const s = spans[i]
    return s ? s.matchedChars / Math.max(1, s.totalChars) : 0
  }

  // Gate 2 — shared-chunk members. A >2.5s transcript "word" is a segment-mode
  // phrase chunk; when one chunk overlaps two or more lines, the boundaries
  // between those lines were interpolated inside it and are not per-line
  // verified (this is the tail-clipping mode of >180s tracks). Measured: 51
  // flags across the corpus, 16 of them lines that truth places >1.5s away.
  for (const w of words) {
    if (w.endTime - w.startTime <= CHUNK_MIN_DURATION_S) continue
    const hits: number[] = []
    for (let i = 0; i < lines.length; i++) {
      const overlap = Math.min(lines[i].endTime, w.endTime) - Math.max(lines[i].startTime, w.startTime)
      if (overlap > CHUNK_OVERLAP_S) hits.push(i)
    }
    if (hits.length >= 2) for (const i of hits) demote(i)
  }

  // Gate 3 — clipped tail vs the line's own attributed evidence. The line's
  // matched chars keep sounding past its end (melisma / held tail) while the
  // next line's evidence starts later, so the highlight provably ends early.
  for (let i = 0; i < lines.length; i++) {
    if (quality[i] !== 'good') continue
    const s = spans[i]
    if (!s || coverage(i) < SPAN_MIN_COVERAGE) continue
    if (s.firstTime >= lines[i].endTime || s.lastEndTime <= lines[i].startTime) continue
    if (s.lastEndTime <= lines[i].endTime + TAIL_OVERHANG_S) continue
    const next = spans[i + 1]
    if (next && s.lastEndTime > next.firstTime + NEXT_EVIDENCE_SLACK_S) continue
    demote(i)
  }

  // Gate 4 — contested occurrence of a repeated line next to an evidence
  // desert. When a phrase repeats in the sheet but the transcript carries
  // evidence for fewer occurrences (Whisper hole over a chorus), the LCS can
  // hand a sung occurrence to the WRONG sibling — the stolen anchor reads
  // 'good' while sitting tens of seconds from its true position (measured:
  // stranger-than-heaven #51, 38s off). Only order-consistent endpoint claims
  // (first sheet occurrence on the earliest evidence, last on the latest) are
  // trustworthy; other claims flanked by an evidence desert demote.
  const norm = lineTexts.map((t) => normalizeForMatch(t))
  const byText = new Map<string, number[]>()
  norm.forEach((n, i) => {
    if (!n) return
    const arr = byText.get(n)
    if (arr) arr.push(i)
    else byText.set(n, [i])
  })
  // Lazy per-line desert check (see isEvidenceDesertLine).
  const desertCache = new Map<number, boolean>()
  const isDesertLine = (i: number): boolean => {
    const cached = desertCache.get(i)
    if (cached !== undefined) return cached
    const desert = isEvidenceDesertLine(lines[i], lineTexts[i], input.quality[i], words)
    desertCache.set(i, desert)
    return desert
  }
  const inDesertContext = (i: number): boolean => {
    let before = 0
    for (let k = Math.max(0, i - DESERT_WINDOW); k < i; k++) if (isDesertLine(k)) before++
    if (before >= DESERT_MIN_NEIGHBORS) return true
    let after = 0
    for (let k = i + 1; k <= Math.min(lines.length - 1, i + DESERT_WINDOW); k++) {
      if (isDesertLine(k)) after++
    }
    return after >= DESERT_MIN_NEIGHBORS
  }

  for (const members of byText.values()) {
    if (members.length < 2) continue
    const strong = members.filter((i) => coverage(i) >= SPAN_MIN_COVERAGE)
    const deficit = strong.length < members.length
    let inverted = false
    for (let a = 0; a + 1 < strong.length; a++) {
      if (spans[strong[a]]!.firstTime > spans[strong[a + 1]]!.firstTime) inverted = true
    }
    if (!deficit && !inverted) continue
    const times = strong.map((i) => spans[i]!.firstTime)
    const minT = Math.min(...times)
    const maxT = Math.max(...times)
    for (const i of strong) {
      if (quality[i] !== 'good') continue
      const endpointClaim =
        (i === members[0] && spans[i]!.firstTime === minT) ||
        (i === members[members.length - 1] && spans[i]!.firstTime === maxT)
      if (endpointClaim) continue
      if (inDesertContext(i)) demote(i)
    }
  }

  // Gate 5 — acoustic vocal-activity. When an audio-derived envelope is present,
  // demote a 'good' line whose window carries almost no vocal energy (placed on
  // an intro / instrumental break / Whisper break-hallucination). This is an
  // INDEPENDENT signal from the lexical gates above. Corroborate-don't-override:
  // on a raw-mix envelope, spare a line with strong lexical coverage (quiet
  // vocals under loud instruments read as low band energy); a Demucs-stem
  // envelope is decisive.
  const va = input.vocalActivity
  if (va) {
    const strict = va.source === 'stem'
    const minVoiced = strict ? STEM_MIN_VOICED_FRAC : MIX_MIN_VOICED_FRAC
    for (let i = 0; i < lines.length; i++) {
      if (quality[i] !== 'good') continue
      if (voicedFraction(va, lines[i].startTime, lines[i].endTime) >= minVoiced) continue
      if (!strict && coverage(i) >= SPAN_MIN_COVERAGE) continue
      demote(i)
    }
  }

  return quality
}
