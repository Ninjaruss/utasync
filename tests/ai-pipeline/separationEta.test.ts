import { describe, it, expect } from 'vitest'
import {
  projectSeparationMs,
  separationCapMs,
  acceptedCapMs,
  formatEta,
  etaPromptThresholdMs,
  STALL_TIMEOUT_MS,
} from '../../src/ai-pipeline/separationEta'

describe('projectSeparationMs', () => {
  it('extrapolates total runtime from the first chunk', () => {
    // 1 of 155 chunks took 20s → ~3100s total.
    expect(projectSeparationMs(1, 155, 20_000)).toBe(3_100_000)
  })

  it('refines as more chunks complete', () => {
    expect(projectSeparationMs(10, 100, 5_000)).toBe(50_000)
  })

  it('returns null before any chunk has completed', () => {
    expect(projectSeparationMs(0, 155, 0)).toBeNull()
  })

  it('returns null for nonsense inputs rather than a bogus estimate', () => {
    expect(projectSeparationMs(1, 0, 1_000)).toBeNull()
    expect(projectSeparationMs(Number.NaN, 155, 1_000)).toBeNull()
    expect(projectSeparationMs(1, 155, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('separationCapMs', () => {
  // The whole point of the cap: Whisper's 20s-per-audio-second budget would
  // allow ~57 minutes on a 3:50 song, i.e. the exact stall being fixed.
  it('caps a 3:50 song well under an hour', () => {
    const cap = separationCapMs(230)
    expect(cap).toBeLessThan(30 * 60_000)
    expect(cap).toBeGreaterThanOrEqual(15 * 60_000)
  })

  // Measured healthy-GPU cost is ~2x audio length, so the cap must sit clear of
  // it — killing a slow-but-working run would be worse than the bug being fixed.
  it('leaves generous headroom over a measured healthy run', () => {
    const healthyMs = 230 * 2 * 1000
    expect(separationCapMs(230)).toBeGreaterThan(healthyMs * 2)
  })

  it('never drops below a 15 minute floor for short audio', () => {
    expect(separationCapMs(30)).toBe(15 * 60_000)
  })

  it('scales for long audio', () => {
    expect(separationCapMs(600)).toBe(60 * 60_000)
  })

  it('falls back to the floor when duration is unknown', () => {
    expect(separationCapMs(0)).toBe(15 * 60_000)
    expect(separationCapMs(Number.NaN)).toBe(15 * 60_000)
  })
})

describe('acceptedCapMs', () => {
  // Killing a user at the default cap after they explicitly accepted a longer
  // estimate would be a worse bug than the one being fixed.
  it('gives headroom beyond an accepted estimate', () => {
    expect(acceptedCapMs(40 * 60_000)).toBe(60 * 60_000)
  })
})

describe('formatEta', () => {
  it('does not pretend to sub-minute precision', () => {
    expect(formatEta(20_000)).toBe('less than a minute')
  })
  it('singularises one minute', () => {
    expect(formatEta(60_000)).toBe('about 1 minute')
  })
  it('rounds to whole minutes', () => {
    expect(formatEta(45 * 60_000)).toBe('about 45 minutes')
  })
  it('stops counting past an hour', () => {
    expect(formatEta(3 * 60 * 60_000)).toBe('over an hour')
  })
})

describe('etaPromptThresholdMs', () => {
  /**
   * Calibrated against a real measurement (2026-08-18, Apple-silicon WebGPU):
   * a 3:50 song runs ~1.4x audio length actual, and projects ~2.05x from chunk 1
   * (which carries warmup) — the number the threshold is actually compared
   * against. That is ~8 minutes on the HEALTHY path. The original fixed
   * 5-minute threshold would have fired the warning on nearly every full-length
   * song, which is how a warning becomes noise the user learns to dismiss.
   */
  it('stays quiet for a healthy GPU run on a full-length song', () => {
    const healthyProjectionMs = Math.round(230 * 2.05 * 1000) // measured
    expect(etaPromptThresholdMs(230)).toBeGreaterThan(healthyProjectionMs)
  })

  it('still fires for the WASM case it exists to catch', () => {
    // WASM is an order of magnitude worse than GPU — far past the threshold.
    const wasmProjectionMs = 230 * 20 * 1000
    expect(etaPromptThresholdMs(230)).toBeLessThan(wasmProjectionMs)
  })

  it('scales with song length', () => {
    expect(etaPromptThresholdMs(600)).toBe(30 * 60_000)
  })

  it('never drops below an 8 minute floor, including for unknown duration', () => {
    expect(etaPromptThresholdMs(30)).toBe(8 * 60_000)
    expect(etaPromptThresholdMs(0)).toBe(8 * 60_000)
    expect(etaPromptThresholdMs(Number.NaN)).toBe(8 * 60_000)
  })

  // The prompt must come before the cap, or the run is killed without the user
  // ever having been asked whether they wanted to wait.
  it('always fires before the hard cap would', () => {
    for (const d of [30, 120, 230, 600, 1200]) {
      expect(etaPromptThresholdMs(d)).toBeLessThan(separationCapMs(d))
    }
  })
})

describe('thresholds', () => {
  it('calls a run wedged after 90s of silence', () => {
    expect(STALL_TIMEOUT_MS).toBe(90_000)
  })
})
