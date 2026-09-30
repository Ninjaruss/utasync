import { describe, it, expect } from 'vitest'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'
import { estimateGlobalOffset } from '../../src/ai-pipeline/offsetEstimate'

/**
 * Contract tests for the global-offset estimator (plan W1.2 Layer 1), on constructed
 * signals. `tests/ai-pipeline/tierA.audio.test.ts` covers the same module end to end on
 * real audio samples; these pin the behaviour the callers depend on — above all, the
 * four cases where it must REFUSE rather than return a number.
 *
 * The refusal cases are the point of the module. Its historical justification for not
 * existing was that a densely-sung track has vocal energy nearly everywhere, so the
 * envelope cannot say WHICH words are where. That is true, and the answer is to decline,
 * not to guess: a wrong automatic shift moves correct lyrics.
 */

const HOP = 0.02

/** Build a signal with voicing stitched in around the given onset times. */
function signalWithOnsets(onsets: number[], durSec: number, opts?: { voicedEverywhere?: boolean }): VocalActivitySignal {
  const frames = Math.round(durSec / HOP)
  const activity = new Float32Array(frames)
  const onset = new Float32Array(frames)
  if (opts?.voicedEverywhere) {
    activity.fill(0.6)
    return { hopSec: HOP, activity, onset, source: 'mix' }
  }
  for (const t of onsets) {
    const start = Math.round(t / HOP)
    // A sung line: quiet just before, loud for ~0.8s with a sharp attack.
    for (let f = start - 8; f < start; f++) if (f >= 0 && f < frames) activity[f] = 0.05
    for (let f = start; f < start + Math.round(0.8 / HOP) && f < frames; f++) activity[f] = 0.9
    if (start >= 0 && start < frames) onset[start] = 1
  }
  return { hopSec: HOP, activity, onset, source: 'mix' }
}

/** Onsets ~1.4s apart, like a pop chorus — the spacing that creates the ambiguity. */
const SPACED = [2.0, 3.4, 4.8, 6.2, 7.6, 9.0, 10.4, 11.8, 13.2]
const DUR = 16

describe('estimateGlobalOffset — recovers a real shift', () => {
  it('recovers a constant lag from onset structure', () => {
    const sig = signalWithOnsets(SPACED, DUR)
    const SHIFT = 0.4 // claimed starts are 0.4s later than the true onsets
    const est = estimateGlobalOffset({
      claimedStarts: SPACED.map((t) => t + SHIFT),
      sig,
      durationSec: DUR,
    })
    expect(est).not.toBeNull()
    // A shift of -0.4 undoes the claimed lag. One-hop ambiguity is excluded by the
    // module's deliberately narrow search range, so the nearest answer is the right one.
    expect(Math.abs((est as { shiftSec: number }).shiftSec + SHIFT)).toBeLessThan(0.06)
  })

  it('recovers a shift in the other direction', () => {
    const sig = signalWithOnsets(SPACED, DUR)
    const est = estimateGlobalOffset({
      claimedStarts: SPACED.map((t) => t - 0.3),
      sig,
      durationSec: DUR,
    })
    expect(est).not.toBeNull()
    expect((est as { shiftSec: number }).shiftSec).toBeGreaterThan(0.2)
    expect((est as { shiftSec: number }).shiftSec).toBeLessThan(0.4)
  })
})

describe('estimateGlobalOffset — the four refusals', () => {
  it('REFUSES when the timings are already consistent (shifting would be damage)', () => {
    const sig = signalWithOnsets(SPACED, DUR)
    expect(estimateGlobalOffset({ claimedStarts: SPACED, sig, durationSec: DUR })).toBeNull()
  })

  it('REFUSES when energy is present but carries no onset structure', () => {
    // The documented blind spot, as a test: voiced nearly everywhere, no rises. This is
    // what a vocal buried under same-band instruments looks like to the envelope.
    const sig = signalWithOnsets(SPACED, DUR, { voicedEverywhere: true })
    expect(
      estimateGlobalOffset({ claimedStarts: SPACED.map((t) => t + 0.4), sig, durationSec: DUR }),
      'a flat, always-voiced envelope must not produce a shift',
    ).toBeNull()
  })

  it('REFUSES when the required shift is beyond the identifiable range', () => {
    // Onsets every ~1.4s mean a 1.4s shift scores as well as a 0 shift: the envelope
    // cannot tell which occurrence a line belongs to. That is a version mismatch for the
    // caller to escalate, never an offset to apply.
    const sig = signalWithOnsets(SPACED, DUR)
    expect(
      estimateGlobalOffset({ claimedStarts: SPACED.map((t) => t + 1.4), sig, durationSec: DUR }),
    ).toBeNull()
    expect(
      estimateGlobalOffset({ claimedStarts: SPACED.map((t) => t + 40), sig, durationSec: DUR }),
    ).toBeNull()
  })

  it('REFUSES when there are too few lines to judge', () => {
    const sig = signalWithOnsets(SPACED, DUR)
    expect(estimateGlobalOffset({ claimedStarts: [2.0, 3.4], sig, durationSec: DUR })).toBeNull()
    expect(estimateGlobalOffset({ claimedStarts: [], sig, durationSec: DUR })).toBeNull()
  })

  it('REFUSES on an empty envelope rather than dividing by nothing', () => {
    const empty: VocalActivitySignal = { hopSec: HOP, activity: new Float32Array(0), onset: new Float32Array(0), source: 'mix' }
    expect(estimateGlobalOffset({ claimedStarts: SPACED, sig: empty, durationSec: DUR })).toBeNull()
  })
})

describe('estimateGlobalOffset — reported evidence', () => {
  it('reports the structure it acted on, so a caller can judge it', () => {
    const sig = signalWithOnsets(SPACED, DUR)
    const est = estimateGlobalOffset({ claimedStarts: SPACED.map((t) => t + 0.4), sig, durationSec: DUR })
    expect(est).not.toBeNull()
    const e = est as { onsetShare: number; medianRise: number; nLines: number }
    expect(e.onsetShare).toBeGreaterThanOrEqual(0.6)
    expect(e.medianRise).toBeGreaterThanOrEqual(0.15)
    expect(e.nLines).toBe(SPACED.length)
  })

  it('never returns a shift outside the range it searches', () => {
    const sig = signalWithOnsets(SPACED, DUR)
    for (const claimed of [0.6, 0.75, 0.9, 1.1]) {
      const est = estimateGlobalOffset({ claimedStarts: SPACED.map((t) => t - claimed), sig, durationSec: DUR })
      if (est) expect(Math.abs(est.shiftSec)).toBeLessThanOrEqual(0.75)
    }
  })

  it('ignores claimed lines that fall outside the audio', () => {
    const sig = signalWithOnsets(SPACED, DUR)
    // Appending far-outside lines must not change the answer, because only windows that
    // fit inside the song contribute.
    const withOutside = [...SPACED.map((t) => t + 0.4), -5, 900, 901, 902]
    const est = estimateGlobalOffset({ claimedStarts: withOutside, sig, durationSec: DUR })
    expect(est).not.toBeNull()
    expect(Math.abs((est as { shiftSec: number }).shiftSec + 0.4)).toBeLessThan(0.06)
  })
})
