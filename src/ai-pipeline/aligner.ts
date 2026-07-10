import type { Language, TimedLine } from '../core/types'
import { alignByContent, normalizeForMatch } from './contentAligner'

export interface TranscriptWord {
  word: string
  startTime: number
  endTime: number
}

// Japanese scripts: hiragana, katakana, the prolonged-sound mark, and kanji.
const JA_CHARS = /[぀-ヿー㐀-鿿豈-﫿]/g
function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length
}

export const CONTENT_CONFIDENCE_THRESHOLD = 0.5

/** Below this content-match confidence the alignment is content-mode but shaky —
 * enough lines fail to anchor that timings are unreliable (dense/bilingual tracks
 * Whisper mis-transcribes). Warn the user rather than silently shipping it. */
export const LOW_CONFIDENCE_WARN_THRESHOLD = 0.7

// A sung word/melisma can run a few seconds, but anything longer is a Whisper
// artifact (it stamps absurd spans on silence). Used to discard garbage words.
const MAX_WORD_DURATION_S = 10
// Segment-mode Whisper emits whole lyric phrases (often 10–25s). Subdivide those
// into char slots for LCS instead of dropping them — dropping erased the red-car
// block on AKFG First Take (12s+ segments never reached the aligner).
const SUBDIVIDE_TRANSCRIPT_MAX_DURATION_S = 28
// Whisper loops the same token during instrumental/silent stretches (often
// dozens of times). Collapse each run of consecutive identical tokens down to
// one slot — a few real consecutive repeats ("la la la") lose a little weight,
// but a phantom loop no longer fills the gap and shoves later lines off.
const MAX_REPEATS_KEPT = 1
// Segment-mode Whisper tags a short sung tail across the following instrumental
// (e.g. AKFG First Take "明日を♪" stamped 228–262s). Clip to a glyph budget so
// the onset is kept without dropping the whole chunk (>28s) or smearing chars.
const MAX_SEC_PER_GLYPH = 0.65
const MIN_CLIPPED_SEGMENT_S = 1.2
// A slow ballad (e.g. AKFG First Take) can genuinely hold ~0.9 s per glyph. Above
// this rate a long segment is an overstamp, not singing. Used together with
// contiguity so a plausibly-paced phrase backed by an immediately-following chunk
// is kept in full (赤い…乗せて, 262–275 s) while a sparse overstamp still clips.
const SLOW_SING_MAX_SEC_PER_GLYPH = 1.2
const JA_SCRIPT_RE = /[぀-ヿ㐀-鿿]/

function normalizeToken(word: string): string {
  // Strip whitespace and punctuation so repetition detection isn't fooled by
  // trailing commas/spaces Whisper sprinkles between looped tokens.
  return word.toLowerCase().replace(/[\s\p{P}]+/gu, '')
}

/** Split an over-long segment phrase into char-level slots with real timestamps. */
export function subdivideTranscriptWord(w: TranscriptWord): TranscriptWord[] {
  const glyphs = [...normalizeForMatch(w.word)]
  if (glyphs.length <= 1) return [w]
  const duration = w.endTime - w.startTime
  return glyphs.map((ch, i) => {
    const start = w.startTime + duration * (i / glyphs.length)
    const end = i === glyphs.length - 1 ? w.endTime : w.startTime + duration * ((i + 1) / glyphs.length)
    return { word: ch, startTime: start, endTime: end }
  })
}

function pushSanitizedWord(kept: TranscriptWord[], w: TranscriptWord): void {
  const prev = kept[kept.length - 1]
  if (prev && w.startTime < prev.startTime) return
  kept.push(w)
}

/** Clip Japanese segment overstamps; leave Latin-only loops for the drop rule.
 * `nextStart` is the following raw chunk's onset (if any): a long segment that is
 * both plausibly paced AND immediately followed by the next chunk is slow singing,
 * not an overstamp into silence, so it is kept in full. */
function clipImplausibleSegmentEnd(w: TranscriptWord, nextStart?: number): TranscriptWord {
  const duration = w.endTime - w.startTime
  if (duration <= MAX_WORD_DURATION_S) return w
  const glyphs = [...normalizeForMatch(w.word)]
  if (glyphs.length === 0 || !glyphs.some((ch) => JA_SCRIPT_RE.test(ch))) return w
  const maxDur = Math.max(MIN_CLIPPED_SEGMENT_S, glyphs.length * MAX_SEC_PER_GLYPH)
  if (duration <= maxDur) return w
  const contiguousFollower = nextStart != null && nextStart <= w.endTime + 0.35
  if (duration / glyphs.length <= SLOW_SING_MAX_SEC_PER_GLYPH && contiguousFollower) return w
  return { ...w, endTime: w.startTime + maxDur }
}

/**
 * Clean a raw Whisper transcript before alignment. Whisper hallucinates during
 * the instrumental/silent parts of a song — phantom looping words carrying real
 * timestamps that sit inside the gap. Left in, they inflate word counts and drag
 * lyric-line timings off. This drops the three classes of garbage we see:
 *   1. words with non-finite, zero/negative, or implausibly long durations,
 *   2. words whose timestamps run backwards (out-of-order artifacts),
 *   3. long runs of the same repeated token (silence loops).
 */
export function sanitizeTranscript(words: TranscriptWord[]): TranscriptWord[] {
  const kept: TranscriptWord[] = []
  let runToken = ''
  let runCount = 0

  for (let wi = 0; wi < words.length; wi++) {
    const raw = words[wi]
    if (!Number.isFinite(raw.startTime) || !Number.isFinite(raw.endTime)) continue
    const nextRawStart = words[wi + 1]?.startTime
    const w = clipImplausibleSegmentEnd(raw, nextRawStart)
    const duration = w.endTime - w.startTime
    if (duration <= 0) continue

    // Drop music symbols and other non-lyric noise Whisper emits during bridges.
    if (!normalizeForMatch(w.word)) continue

    if (duration > SUBDIVIDE_TRANSCRIPT_MAX_DURATION_S) continue
    if (duration > MAX_WORD_DURATION_S) {
      for (const part of subdivideTranscriptWord(w)) pushSanitizedWord(kept, part)
      runToken = ''
      runCount = 0
      continue
    }

    // Timestamps must not go backwards relative to the last word we kept.
    const prev = kept[kept.length - 1]
    if (prev && w.startTime < prev.startTime) continue

    const token = normalizeToken(w.word)
    if (token && token === runToken) {
      runCount++
      if (runCount > MAX_REPEATS_KEPT) continue // drop the 3rd+ identical in a row
    } else {
      runToken = token
      runCount = 1
    }

    pushSanitizedWord(kept, w)
  }

  return kept
}

function latinWordCount(text: string): number {
  return (text.match(/[A-Za-z]+/g) ?? []).length
}

// A line's weight estimates how many Whisper word-tokens it produces, which is
// what the proportional distribution actually slices on. Whisper tokenizes the
// scripts at very different granularities: roughly ONE token per mora/character
// for Japanese (青/空/に/溶/けて), but one token per WORD for English
// (You/always/make/me/so/happy). So Japanese is weighted by character count and
// English by *word* count — counting English letters instead over-weights every
// English line ~4x, stealing word-slots from the lines after it.
//
// A line that MIXES scripts (Japanese + an inline Latin translation, e.g.
// "You always make me so happy 青空に溶けて") is weighted by its Japanese only:
// the Latin there is a translation that isn't in the audio. A PURELY Latin line
// is treated as sung English and weighted by its word count.
export function lineWeight(text: string, sourceLanguage: Language): number {
  if (sourceLanguage === 'ja') {
    const ja = countMatches(text, JA_CHARS)
    if (ja > 0) return ja
    return latinWordCount(text)
  }
  const words = latinWordCount(text)
  if (words > 0) return words
  const ja = countMatches(text, JA_CHARS)
  if (ja > 0) return ja
  // Fallback for any other script: non-whitespace character count.
  return text.replace(/\s+/g, '').length
}

/**
 * Distribute a word-level audio transcript across lyric lines.
 *
 * The transcript carries real per-word timestamps, but its word segmentation
 * does not correspond to the lyric lines (and for spaceless languages like
 * Japanese a line has no word boundaries at all). So instead of matching by
 * content, we hand each line a contiguous slice of the transcript whose size is
 * proportional to the line's length, and read that slice's real timestamps.
 * This spreads lines monotonically across the whole song regardless of language.
 */
export function alignTranscriptToLines(
  lineTexts: string[],
  words: TranscriptWord[],
  existingLines?: TimedLine[],
  sourceLanguage: Language = 'ja'
): TimedLine[] {
  const lineCount = lineTexts.length

  const buildLine = (li: number, startTime: number, endTime: number): TimedLine => ({
    startTime,
    endTime,
    original: existingLines?.[li]?.original ?? lineTexts[li],
    translation: existingLines?.[li]?.translation ?? lineTexts[li],
  })

  // Strip hallucinations/garbage so phantom words in instrumental gaps don't
  // skew the proportional mapping (see sanitizeTranscript).
  const clean = sanitizeTranscript(words)

  // No usable transcript: keep the lines but leave them untimed.
  if (clean.length === 0 || lineCount === 0) {
    return lineTexts.map((_, li) => buildLine(li, 0, 0))
  }

  const weights = lineTexts.map((t) => Math.max(1, lineWeight(t, sourceLanguage)))
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const lastWordEnd = clean[clean.length - 1].endTime

  const result: TimedLine[] = []
  let prevBoundary = 0
  let cumWeight = 0

  for (let li = 0; li < lineCount; li++) {
    cumWeight += weights[li]
    // Word-array boundary for the end of this line, proportional to weight.
    const boundary =
      li === lineCount - 1
        ? clean.length
        : Math.round((cumWeight / totalWeight) * clean.length)
    const startWord = prevBoundary
    const endWord = Math.min(Math.max(boundary, startWord), clean.length)
    const span = clean.slice(startWord, endWord)

    // Real timestamps where available; an empty span anchors to the next real
    // word onset (so the line lands at the resumption of singing, not inside a
    // gap), then to the previous line's end past the transcript's end.
    const startTime =
      span[0]?.startTime ?? clean[startWord]?.startTime ?? result[li - 1]?.endTime ?? lastWordEnd
    const endTime = span[span.length - 1]?.endTime ?? startTime

    result.push(buildLine(li, startTime, endTime))
    prevBoundary = endWord
  }

  // Stitch boundaries: keep start times non-decreasing, and clamp each line's
  // end to its own last sung word — but never past the next line's start. This
  // leaves a "rest" during instrumental gaps (a line no longer claims the
  // silent stretch up to the next line) while preventing overlaps. The active-
  // line highlighter keys off startTime, so rests are invisible there but make
  // endTime correct for AB-loop and lyric export.
  for (let li = 0; li < result.length - 1; li++) {
    if (result[li + 1].startTime < result[li].startTime) {
      result[li + 1].startTime = result[li].startTime
    }
    const ownEnd = Math.max(result[li].endTime, result[li].startTime)
    result[li].endTime = Math.min(ownEnd, result[li + 1].startTime)
  }
  const last = result[result.length - 1]
  last.endTime = Math.max(last.endTime, last.startTime, lastWordEnd)

  return result
}

export type AlignResult = {
  lines: TimedLine[]
  mode: 'content' | 'proportional'
  confidence: number
  /** Per-line start anchor: LCS transcript match vs weight interpolation (content mode only). */
  anchorSources?: import('./contentAligner').LineAnchorSource[]
}

/** Below this a line's start is treated as coinciding with the next line's — a
 * degenerate (effectively zero-duration) row that needs a carved window. */
const DEGENERATE_GAP_S = 0.1
/** Window carved for such a row so it can briefly become the active line. */
const CARVED_WINDOW_S = 0.3

/** Guarantee every line a visible highlight window. A line whose start coincides
 * with the next line's start — e.g. a row Whisper dropped from the transcript, left
 * interpolated with no room between two anchored neighbours — would have zero
 * duration and never become the active line. Carve a small window by nudging its
 * start earlier into the slack before it. Only degenerate (near-zero) gaps are
 * touched, so normally-spaced lines are untouched; iterating backward lets a run of
 * collisions cascade so starts stay strictly increasing. */
export function ensureVisibleLineWindows(lines: TimedLine[], window = CARVED_WINDOW_S): TimedLine[] {
  const out = lines.map((l) => ({ ...l }))
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i + 1].startTime - out[i].startTime >= DEGENERATE_GAP_S) continue
    out[i].startTime = Math.max(0, out[i + 1].startTime - window)
    if (out[i].endTime < out[i].startTime) out[i].endTime = out[i].startTime
  }
  return out
}

export function alignLyrics(
  lineTexts: string[],
  words: TranscriptWord[],
  existingLines?: TimedLine[],
  sourceLanguage: Language = 'ja',
): AlignResult {
  const clean = sanitizeTranscript(words)
  const content = alignByContent(lineTexts, clean, existingLines, sourceLanguage)
  if (content.confidence >= CONTENT_CONFIDENCE_THRESHOLD) {
    return {
      lines: ensureVisibleLineWindows(content.lines),
      mode: 'content',
      confidence: content.confidence,
      anchorSources: content.anchorSources,
    }
  }
  const lines = alignTranscriptToLines(lineTexts, clean, existingLines, sourceLanguage)
  return {
    lines: ensureVisibleLineWindows(lines),
    mode: 'proportional',
    confidence: content.confidence,
    anchorSources: lineTexts.map(() => 'interpolated' as const),
  }
}
