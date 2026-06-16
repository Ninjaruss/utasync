import type { TimedLine } from '../core/types'

export interface TranscriptWord {
  word: string
  startTime: number
  endTime: number
}

// Letters/CJK only (whitespace and punctuation removed). Used as a proxy for
// how much of the song a line occupies — longer text is sung for longer. Works
// for spaced and spaceless languages alike, unlike a whitespace word count.
function weightOf(text: string): number {
  // Non-whitespace character count (\s also matches the ideographic space).
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
  existingLines?: TimedLine[]
): TimedLine[] {
  const lineCount = lineTexts.length

  const buildLine = (li: number, startTime: number, endTime: number): TimedLine => ({
    startTime,
    endTime,
    original: existingLines?.[li]?.original ?? lineTexts[li],
    translation: existingLines?.[li]?.translation ?? lineTexts[li],
  })

  // No usable transcript: keep the lines but leave them untimed.
  if (words.length === 0 || lineCount === 0) {
    return lineTexts.map((_, li) => buildLine(li, 0, 0))
  }

  const weights = lineTexts.map((t) => Math.max(1, weightOf(t)))
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const lastWordEnd = words[words.length - 1].endTime

  const result: TimedLine[] = []
  let prevBoundary = 0
  let cumWeight = 0

  for (let li = 0; li < lineCount; li++) {
    cumWeight += weights[li]
    // Word-array boundary for the end of this line, proportional to weight.
    const boundary =
      li === lineCount - 1
        ? words.length
        : Math.round((cumWeight / totalWeight) * words.length)
    const startWord = prevBoundary
    const endWord = Math.min(Math.max(boundary, startWord), words.length)
    const span = words.slice(startWord, endWord)

    // Real timestamps where available; otherwise anchor to the previous line's
    // end (covers lines that fall past the end of a short transcript).
    const startTime =
      span[0]?.startTime ?? words[startWord]?.startTime ?? result[li - 1]?.endTime ?? lastWordEnd
    const endTime = span[span.length - 1]?.endTime ?? startTime

    result.push(buildLine(li, startTime, endTime))
    prevBoundary = endWord
  }

  // Stitch boundaries so start times are non-decreasing and each line ends
  // exactly where the next begins (no gaps/overlaps for the highlighter).
  for (let li = 0; li < result.length - 1; li++) {
    if (result[li + 1].startTime < result[li].startTime) {
      result[li + 1].startTime = result[li].startTime
    }
    result[li].endTime = result[li + 1].startTime
  }
  const last = result[result.length - 1]
  last.endTime = Math.max(last.endTime, last.startTime, lastWordEnd)

  return result
}
