import type { Language, TimedLine } from '../core/types'

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

// A sung word/melisma can run a few seconds, but anything longer is a Whisper
// artifact (it stamps absurd spans on silence). Used to discard garbage words.
const MAX_WORD_DURATION_S = 10
// Whisper loops the same token during instrumental/silent stretches (often
// dozens of times). Collapse each run of consecutive identical tokens down to
// one slot — a few real consecutive repeats ("la la la") lose a little weight,
// but a phantom loop no longer fills the gap and shoves later lines off.
const MAX_REPEATS_KEPT = 1

function normalizeToken(word: string): string {
  // Strip whitespace and punctuation so repetition detection isn't fooled by
  // trailing commas/spaces Whisper sprinkles between looped tokens.
  return word.toLowerCase().replace(/[\s\p{P}]+/gu, '')
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

  for (const w of words) {
    if (!Number.isFinite(w.startTime) || !Number.isFinite(w.endTime)) continue
    const duration = w.endTime - w.startTime
    if (duration <= 0 || duration > MAX_WORD_DURATION_S) continue

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

    kept.push(w)
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
function weightOf(text: string, sourceLanguage: Language): number {
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

  const weights = lineTexts.map((t) => Math.max(1, weightOf(t, sourceLanguage)))
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
