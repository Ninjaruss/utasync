import { describe, it, expect } from 'vitest'
import { firstVocalOnset, type VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'

function makeSignal(
  activity: Float32Array,
  source: 'stem' | 'mix',
  hopSec = 0.1,
): VocalActivitySignal {
  return { hopSec, activity, onset: new Float32Array(activity.length), source }
}

function filled(n: number, v: number): Float32Array {
  const a = new Float32Array(n)
  a.fill(v)
  return a
}

describe('firstVocalOnset', () => {
  it('returns the onset after an instrumental intro', () => {
    // 0–15s silent (150 frames of 0.0), 15–25s voiced (100 frames of 0.6).
    const activity = new Float32Array(250)
    for (let f = 150; f < 250; f++) activity[f] = 0.6
    const sig = makeSignal(activity, 'stem')
    const onset = firstVocalOnset(sig)
    expect(onset).not.toBeNull()
    expect(onset as number).toBeGreaterThanOrEqual(14.5)
    expect(onset as number).toBeLessThanOrEqual(15.6)
  })

  it('returns null when voicing starts from t=0 (no intro)', () => {
    const sig = makeSignal(filled(250, 0.6), 'stem')
    expect(firstVocalOnset(sig)).toBeNull()
  })

  it('returns null on a mix source', () => {
    const activity = new Float32Array(250)
    for (let f = 150; f < 250; f++) activity[f] = 0.6
    const sig = makeSignal(activity, 'mix')
    expect(firstVocalOnset(sig)).toBeNull()
  })

  it('returns null on an empty signal', () => {
    const sig = makeSignal(new Float32Array(0), 'stem')
    expect(firstVocalOnset(sig)).toBeNull()
  })
})
