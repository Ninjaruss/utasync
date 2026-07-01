import { getAudioFile } from '../core/opfs/audio'
import { decodeAudioFileToMono } from '../core/audio/decodeToMono'
import { transcribeAudio } from './whisperTranscriber'
import { sanitizeTranscript, type TranscriptWord } from './aligner'
import type { Language } from '../core/types'

/** Seconds of audio to include before the line's current start time. */
const PAD_BEFORE_S = 10
/** Seconds of audio to include after the line's current end time. */
const PAD_AFTER_S = 14

/**
 * Transcribe a focused audio window around a single lyric line using word-level
 * timestamps.  Much faster than re-transcribing the whole song (~10-15 s for a
 * 24-second window) and gives per-word precision that segment-mode transcripts lack.
 *
 * Timestamps in the returned words are offset to song-global seconds, so they
 * can be dropped straight into realignSection alongside the existing line array.
 *
 * Throws if the song has no stored audio file.
 */
export async function transcribeLineWindow(
  songId: string,
  lineStartSec: number,
  lineEndSec: number,
  language: Language,
  onProgress?: (pct: number) => void,
): Promise<TranscriptWord[]> {
  const file = await getAudioFile(songId)
  const { data, sampleRate } = await decodeAudioFileToMono(file)

  const windowStartSec = Math.max(0, lineStartSec - PAD_BEFORE_S)
  const windowEndSec = Math.min(data.length / sampleRate, lineEndSec + PAD_AFTER_S)

  const startSample = Math.floor(windowStartSec * sampleRate)
  const endSample = Math.ceil(windowEndSec * sampleRate)
  const slice = data.slice(startSample, endSample)

  const result = await transcribeAudio(slice, sampleRate, {
    language,
    timestampMode: 'word',
    onTranscribeProgress: onProgress ? ({ progress }) => onProgress(progress) : undefined,
  })

  const chunks = result.chunks ?? []
  return sanitizeTranscript(
    chunks.flatMap((c) => {
      const [start, end] = c.timestamp ?? []
      const word = c.text?.trim()
      if (!word || !Number.isFinite(start)) return []
      return [{ word, startTime: start + windowStartSec, endTime: (end ?? start + 1) + windowStartSec }]
    }),
  )
}
