import type { AlignmentLanguage } from '../core/types'
import { sanitizeTranscript, type TranscriptWord } from './aligner'
import { chunksToWords } from './transcriptChunks'
import { transcribeAudio, type LoadProgress, type TranscribeProgress } from './whisperTranscriber'
import { isRecoverableTranscriptionError } from './workerError'

export interface SliceTranscriberDeps {
  /** The full (post-vocal-separation) song buffer the slices are cut from. */
  audioData: Float32Array
  sampleRate: number
  /** Checked before each retry so a user cancellation aborts instead of downgrading. */
  isCancelled: () => boolean
  /** Effective high-accuracy setting inherited from the caller's main pass (i.e.
   * AFTER any main-pass downgrade). Seeds this transcriber's own ladder state. */
  highAccuracy: boolean
  /** Effective timestamp mode inherited from the caller's main pass (post-downgrade). */
  timestampMode: 'word' | 'segment'
  onLoadProgress?: (p: LoadProgress) => void
  onTranscribeProgress?: (p: TranscribeProgress) => void
}

export interface SliceTranscriber {
  /** Re-transcribe the [t0,t1] second window and return words offset to ABSOLUTE
   * song time (slice-relative Whisper stamps + t0), sanitized.
   *
   * `promptText` (round 9, R9-3) is the KNOWN sheet lyrics for the window, biasing
   * Whisper toward the expected words. Supplying it FORCES segment timestamps for
   * that call (word-mode prompt-prefix trimming is missing in transformers.js
   * 3.8.1 → phantom prompt words), regardless of this transcriber's inherited mode. */
  transcribe: (
    t0: number,
    t1: number,
    lang: AlignmentLanguage,
    promptText?: string,
  ) => Promise<TranscriptWord[]>
}

/**
 * Headless per-slice re-transcriber shared by the fresh-Auto-align gap pass and
 * (round 9) stored-song gap recovery. No React/UI imports — progress flows through
 * the optional callbacks.
 *
 * It holds its OWN crash-downgrade ladder state (effectiveTimestampMode /
 * effectiveHighAccuracy), seeded from the main pass's effective modes, so a
 * downgrade triggered by a gap slice can never leak back into the caller's
 * already-finished main passes. The ladder mirrors AutoAlignFlow's
 * transcribeWithFallback: a recoverable failure (WASM crash / OOM abort / merge
 * timeout) first downgrades word→segment timestamps, then whisper-medium→small,
 * retrying once; a user cancellation or a non-recoverable error is re-thrown. A
 * downgrade sticks for the remaining slices of this transcriber's lifetime.
 */
export function createSliceTranscriber(deps: SliceTranscriberDeps): SliceTranscriber {
  const { audioData, sampleRate, isCancelled, onLoadProgress, onTranscribeProgress } = deps
  let effectiveTimestampMode = deps.timestampMode
  let effectiveHighAccuracy = deps.highAccuracy

  const transcribe = async (
    t0: number,
    t1: number,
    lang: AlignmentLanguage,
    promptText?: string,
  ): Promise<TranscriptWord[]> => {
    const slice = audioData.subarray(
      Math.floor(t0 * sampleRate),
      Math.floor(t1 * sampleRate),
    )
    // A supplied prompt forces segment mode for this call (see the interface note).
    const prompt = promptText?.trim() ? promptText : undefined
    const callTimestampMode = () => (prompt ? 'segment' : effectiveTimestampMode)
    const run = () =>
      transcribeAudio(slice, sampleRate, {
        language: lang,
        highAccuracy: effectiveHighAccuracy,
        timestampMode: callTimestampMode(),
        promptText: prompt,
        onLoadProgress,
        onTranscribeProgress,
      })

    let transcript
    try {
      transcript = await run()
    } catch (e) {
      if (isCancelled() || !isRecoverableTranscriptionError(e)) throw e
      // Advance the crash ladder. A prompted call is already forced to segment, so
      // the word→segment rung tells us nothing about word mode — skip straight to
      // the accuracy downgrade (and leave the persistent word state untouched).
      if (!prompt && effectiveTimestampMode === 'word') {
        effectiveTimestampMode = 'segment'
      } else if (effectiveHighAccuracy) {
        effectiveHighAccuracy = false
      } else {
        throw e
      }
      transcript = await run()
    }

    // Slice-relative Whisper stamps → absolute song time, then sanitize.
    const offset = chunksToWords(transcript).map((word) => ({
      ...word,
      startTime: word.startTime + t0,
      endTime: word.endTime + t0,
    }))
    return sanitizeTranscript(offset)
  }

  return { transcribe }
}
