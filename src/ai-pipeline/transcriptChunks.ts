import type { TranscriptWord } from './aligner'

/** Loose view of a Whisper transcript chunk (text + [start,end] second stamps). */
export interface TranscriptChunkLike {
  text?: string
  timestamp?: [number, number]
}

/**
 * Convert a Whisper transcript's chunks into TranscriptWord[], dropping any chunk
 * with empty text or a non-finite timestamp. Shared so AutoAlignFlow's main passes
 * and the gap-slice re-transcriber (createSliceTranscriber) derive words from raw
 * chunks by exactly the same rule.
 */
export function chunksToWords(t: { chunks?: TranscriptChunkLike[] }): TranscriptWord[] {
  return (t.chunks ?? []).flatMap((c) => {
    const [start, end] = c.timestamp ?? []
    const word = c.text?.trim()
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return []
    return [{ word, startTime: start as number, endTime: end as number }]
  })
}
