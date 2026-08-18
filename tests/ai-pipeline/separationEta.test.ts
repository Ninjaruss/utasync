import { describe, it, expect } from 'vitest'
import {
  projectSeparationMs,
  separationCapMs,
  acceptedCapMs,
  formatEta,
  ETA_PROMPT_THRESHOLD_MS,
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
    expect(cap).toBeLessThan(20 * 60_000)
    expect(cap).toBeGreaterThanOrEqual(10 * 60_000)
  })

  it('never drops below a 10 minute floor for short audio', () => {
    expect(separationCapMs(30)).toBe(10 * 60_000)
  })

  it('scales for long audio', () => {
    expect(separationCapMs(600)).toBe(40 * 60_000)
  })

  it('falls back to the floor when duration is unknown', () => {
    expect(separationCapMs(0)).toBe(10 * 60_000)
    expect(separationCapMs(Number.NaN)).toBe(10 * 60_000)
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

describe('thresholds', () => {
  it('prompts at 5 minutes and calls a run wedged after 90s of silence', () => {
    expect(ETA_PROMPT_THRESHOLD_MS).toBe(5 * 60_000)
    expect(STALL_TIMEOUT_MS).toBe(90_000)
  })
})
