/**
 * Timing policy for on-device vocal separation.
 *
 * Deliberately pure — no DOM, no worker, no onnxruntime — so every threshold
 * here is unit-testable on CI, where no WebGPU device exists.
 */

/**
 * Above this projection, stop and ask the user instead of silently grinding.
 *
 * Scaled by song length rather than fixed, because "long" only means anything
 * relative to the audio.
 *
 * MEASURED on an Apple-silicon WebGPU device (2026-08-18, 10s clip): ~2.15s per
 * chunk steady-state, ~3.1s for chunk 1 which carries warmup. Extrapolated to a
 * 3:50 song (152 chunks) that is ~1.4x audio length actual, and ~2.05x as
 * projected from chunk 1 — which is the number this threshold is compared
 * against. So a healthy full-length song projects ~8 minutes.
 *
 * The original threshold was a flat 5 minutes, guessed before any of the above
 * was measured. It would have fired this prompt on nearly every full-length
 * song on the GOOD path — which is how a warning becomes noise users dismiss.
 *
 * 3x leaves ~1.5x margin over a healthy projection while still catching the
 * WASM case this module exists for, which is an order of magnitude worse.
 */
export function etaPromptThresholdMs(durationSec: number): number {
  const floor = 8 * 60_000
  if (!Number.isFinite(durationSec) || durationSec <= 0) return floor
  return Math.max(floor, Math.round(durationSec * 3_000))
}

/** No progress message for this long means the run is wedged (typically a lost
 * WebGPU device), not merely slow. Distinct from the cap: a wedge should be
 * caught in seconds, not waited out. */
export const STALL_TIMEOUT_MS = 90_000

/** Budget per second of audio for the un-negotiated hard cap. Whisper uses 20x
 * (whisperTranscriber.ts), which on a 3:50 song permits ~77 minutes — precisely
 * the stall this module exists to prevent.
 *
 * Separation gets 6x. Measured healthy GPU cost is ~2x audio length, so 6x is
 * three times the observed good case: generous enough that a merely slow device
 * finishes rather than being killed mid-run, tight enough that a 3:50 song can
 * never approach the ~50 minutes originally reported. This was 4x before the
 * measurement, which sat uncomfortably close to a slow-but-healthy run. */
const CAP_MULTIPLIER = 6_000

const CAP_FLOOR_MS = 15 * 60_000

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
