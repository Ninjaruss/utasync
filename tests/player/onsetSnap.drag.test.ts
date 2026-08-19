import { describe, it, expect } from 'vitest'
import { snapToOnset } from '../../src/player/onsetSnap'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'

/** activity 0 before onsetSec, 1 after; one strong onset frame at onsetSec. */
function signalWithOnset(onsetSec: number, durSec = 30): VocalActivitySignal {
  const hopSec = 0.02
  const frames = Math.ceil(durSec / hopSec)
  const activity = new Float32Array(frames)
  const onset = new Float32Array(frames)
  const oi = Math.floor(onsetSec / hopSec)
  for (let f = oi; f < frames; f++) activity[f] = 1
  onset[oi] = 1
  return { hopSec, activity, onset, source: 'stem' }
}

describe('snapToOnset', () => {
  // The claim the whole thread rests on: a correction landing late should be
  // pulled back to the real acoustic onset.
  it('recovers a real onset from a late tap', () => {
    const r = snapToOnset(signalWithOnset(10), 10.25)
    expect(r.snapped).toBe(true)
    expect(r.timeSec).toBeCloseTo(10, 1)
  })

  // The negative half. Without this, a snap that moved EVERYTHING would pass the
  // test above and look correct while being useless.
  it('leaves a time alone when no onset is near', () => {
    const r = snapToOnset(signalWithOnset(10), 25)
    expect(r.snapped).toBe(false)
    expect(r.timeSec).toBe(25)
  })

  it('leaves a time alone when the signal has no onsets at all', () => {
    const sig = signalWithOnset(10)
    sig.onset.fill(0)
    const r = snapToOnset(sig, 10.25)
    expect(r.snapped).toBe(false)
    expect(r.timeSec).toBe(10.25)
  })

  it('does not drag a time forward across a large gap', () => {
    const r = snapToOnset(signalWithOnset(10), 8)
    expect(r.timeSec).toBeLessThanOrEqual(8 + 0.2)
  })

  // No signal at all is the YouTube case: no PCM, so nothing to snap to. The
  // user's own choice must survive untouched rather than being silently zeroed.
  it('returns the chosen time unchanged when there is no signal', () => {
    for (const sig of [null, undefined]) {
      const r = snapToOnset(sig, 12.34)
      expect(r).toEqual({ timeSec: 12.34, snapped: false })
    }
  })

  it('refuses a nonsense time rather than inventing one', () => {
    const r = snapToOnset(signalWithOnset(10), Number.NaN)
    expect(r.snapped).toBe(false)
  })

  // A weak spectral bump is not a phrase onset. Snapping to one would replace
  // the user's deliberate judgement with noise, which is worse than not snapping.
  it('ignores an onset peak too weak to be a real entry', () => {
    const sig = signalWithOnset(10)
    sig.onset.fill(0)
    sig.onset[Math.floor(10 / 0.02)] = 0.1
    const r = snapToOnset(sig, 10.25)
    expect(r.snapped).toBe(false)
    expect(r.timeSec).toBe(10.25)
  })

  // The drag is pixel-limited (44ms/CSS-px on a 375px phone), so the residual it
  // leaves is tens of milliseconds. That is precisely what snapping is for.
  it('cleans up a residual the size of one slider pixel', () => {
    const r = snapToOnset(signalWithOnset(10), 10.044)
    expect(r.snapped).toBe(true)
    expect(r.timeSec).toBeCloseTo(10, 2)
  })
})
