import { describe, it, expect } from 'vitest'
import { nearestOnset, hasPreOnsetDip, type VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'

/** activity 0 on [0,onsetSec), then 1 after; onset = the rise at onsetSec. */
function dipThenVoiced(onsetSec: number, durSec = 20): VocalActivitySignal {
  const hopSec = 0.02
  const frames = Math.ceil(durSec / hopSec)
  const activity = new Float32Array(frames)
  const onset = new Float32Array(frames)
  const oi = Math.floor(onsetSec / hopSec)
  for (let f = oi; f < frames; f++) activity[f] = 1
  if (oi < frames) onset[oi] = 1 // a single strong rise frame at the onset
  return { hopSec, activity, onset, source: 'stem' }
}

describe('nearestOnset', () => {
  it('finds a strong onset before the target within maxBefore', () => {
    const sig = dipThenVoiced(6)
    const t = nearestOnset(sig, 8, { maxBefore: 3, slackAfter: 0.15, minStrength: 0.3 })
    expect(t).not.toBeNull()
    expect(t!).toBeGreaterThanOrEqual(5.9)
    expect(t!).toBeLessThanOrEqual(6.1)
  })
  it('returns null when no onset clears minStrength in the window', () => {
    const sig = dipThenVoiced(6)
    expect(nearestOnset(sig, 20, { maxBefore: 1, slackAfter: 0.15, minStrength: 0.3 })).toBeNull()
  })
})

describe('hasPreOnsetDip', () => {
  it('is true when a silence lull precedes the onset', () => {
    expect(hasPreOnsetDip(dipThenVoiced(6), 6, { dipWindow: 0.5, dipMaxActivity: 0.1 })).toBe(true)
  })
  it('is false when it is loud right before the onset (mid-phrase bump)', () => {
    const hopSec = 0.02, frames = 1000
    const activity = new Float32Array(frames).fill(1)
    const sig = { hopSec, activity, onset: new Float32Array(frames), source: 'stem' as const }
    expect(hasPreOnsetDip(sig, 6, { dipWindow: 0.5, dipMaxActivity: 0.1 })).toBe(false)
  })
})
