/**
 * Timing policy for on-device vocal separation.
 *
 * Deliberately pure — no DOM, no worker, no onnxruntime — so every threshold
 * here is unit-testable on CI, where no WebGPU device exists.
 */

/** Above this projection, stop and ask the user instead of silently grinding. */
export const ETA_PROMPT_THRESHOLD_MS = 5 * 60_000

/** No progress message for this long means the run is wedged (typically a lost
 * WebGPU device), not merely slow. Distinct from the cap: a wedge should be
 * caught in seconds, not waited out. */
export const STALL_TIMEOUT_MS = 90_000

/** Budget per second of audio for the un-negotiated hard cap. Whisper uses 20x
 * (whisperTranscriber.ts), which on a 3:50 song permits ~77 minutes — precisely
 * the stall this module exists to prevent. Separation gets 4x. */
const CAP_MULTIPLIER = 4_000

const CAP_FLOOR_MS = 10 * 60_000

/** Headroom over an accepted estimate. A user who agreed to wait ~45 minutes
 * must not be killed at exactly 45 — projections drift. */
const ACCEPTED_CAP_HEADROOM = 1.5

/** Projected total runtime from chunks completed so far, or null when there is
 * not yet enough information to make an honest estimate. */
export function projectSeparationMs(
  chunksDone: number,
  nChunks: number,
  elapsedMs: number,
): number | null {
  if (!Number.isFinite(chunksDone) || !Number.isFinite(nChunks) || !Number.isFinite(elapsedMs)) {
    return null
  }
  if (chunksDone <= 0 || nChunks <= 0 || elapsedMs < 0) return null
  return Math.round((elapsedMs / chunksDone) * nChunks)
}

/** Hard cap for a run the user has not explicitly accepted. */
export function separationCapMs(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return CAP_FLOOR_MS
  return Math.max(CAP_FLOOR_MS, Math.round(durationSec * CAP_MULTIPLIER))
}

/** Cap for a run the user accepted after seeing an estimate. */
export function acceptedCapMs(projectedMs: number): number {
  if (!Number.isFinite(projectedMs) || projectedMs <= 0) return CAP_FLOOR_MS
  return Math.round(projectedMs * ACCEPTED_CAP_HEADROOM)
}

/** Human-readable ETA. Never claims precision the projection does not have. */
export function formatEta(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return 'less than a minute'
  const minutes = Math.round(ms / 60_000)
  if (minutes >= 60) return 'over an hour'
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`
}
