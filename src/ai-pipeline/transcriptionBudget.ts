/** Bounded inference budgets, excluding model download/initialization.
 * These are initial recovery limits, not measured accuracy optima. */
export function transcriptionBudgetMs(
  durationSec: number,
  timestampMode: 'word' | 'segment',
  highAccuracy = false,
): number {
  const seconds = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0
  const word = timestampMode === 'word'
  const base = Math.min(word ? 240_000 : 360_000,
    Math.max(word ? 90_000 : 60_000, seconds * (word ? 1_500 : 2_000)))
  return highAccuracy ? base * 1.5 : base
}

/** One deadline shared by merging and finalizing; repeated status events do not
 * buy extra time. A new decoding chunk may resume the ordinary pass budget. */
export const TRANSCRIPT_FINALIZATION_TIMEOUT_MS = 90_000

export class TranscriptionTimeoutError extends Error {
  readonly phase: 'load' | 'pass' | 'finalization'
  constructor(phase: 'load' | 'pass' | 'finalization') {
    super(phase === 'finalization'
      ? 'Transcript finalization timed out — try segment timestamps or a shorter clip.'
      : phase === 'load'
        ? 'Speech model setup timed out — try again or use a lighter model.'
      : 'Transcription timed out — try segment timestamps, a shorter clip, or tap-sync.')
    this.name = 'TranscriptionTimeoutError'
    this.phase = phase
  }
}
