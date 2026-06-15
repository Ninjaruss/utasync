import type { TimedLine } from '../core/types'

export interface TranscriptWord {
  word: string
  startTime: number
  endTime: number
}

function normalize(text: string): string {
  // Keep ASCII alphanumerics and the CJK range (U+3000–U+9FFF) so Japanese
  // text survives normalization; everything else collapses to spaces.
  return text.toLowerCase().replace(/[^a-z0-9\u3000-\u9fff]/g, ' ').trim()
}

export function alignTranscriptToLines(
  lineTexts: string[],
  words: TranscriptWord[],
  existingLines?: TimedLine[]
): TimedLine[] {
  const lineWordCounts = lineTexts.map((l) => normalize(l).split(/\s+/).filter(Boolean).length || 1)
  const result: TimedLine[] = []
  let wordIdx = 0

  for (let li = 0; li < lineTexts.length; li++) {
    const count = lineWordCounts[li]
    const span = words.slice(wordIdx, wordIdx + count)
    const startTime = span[0]?.startTime ?? words[wordIdx - 1]?.endTime ?? 0
    const endTime = words[wordIdx + count]?.startTime ?? (span[span.length - 1]?.endTime ?? startTime + 5)

    result.push({
      startTime,
      endTime,
      original: existingLines?.[li]?.original ?? lineTexts[li],
      translation: existingLines?.[li]?.translation ?? lineTexts[li],
    })
    wordIdx += count
  }
  return result
}
