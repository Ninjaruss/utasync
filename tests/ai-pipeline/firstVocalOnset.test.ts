import { describe, it, expect } from 'vitest'
import { firstVocalOnset, detectInstrumentalGaps, type VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'

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

describe('detectInstrumentalGaps', () => {
  it('detects an instrumental break between two voiced sections', () => {
    // 0–3s voiced, 3–12s quiet (a 9s break), 12–20s voiced. hopSec 0.1.
    const a = new Float32Array(200)
    for (let f = 0; f < 30; f++) a[f] = 0.6
    for (let f = 120; f < 200; f++) a[f] = 0.6
    const gaps = detectInstrumentalGaps(makeSignal(a, 'stem'))
    expect(gaps.length).toBe(1)
    expect(gaps[0].start).toBeCloseTo(3, 1)
    expect(gaps[0].end).toBeCloseTo(12, 1)
  })

  it('ignores breaks shorter than minGapSec (default 4s)', () => {
    const a = filled(200, 0.6)
    for (let f = 50; f < 70; f++) a[f] = 0 // 2s quiet
    expect(detectInstrumentalGaps(makeSignal(a, 'stem')).length).toBe(0)
  })

  it('honors a custom minGapSec', () => {
    const a = filled(200, 0.6)
    for (let f = 50; f < 70; f++) a[f] = 0 // 2s quiet
    expect(detectInstrumentalGaps(makeSignal(a, 'stem'), { minGapSec: 1.5 }).length).toBe(1)
  })

  it('finds multiple breaks', () => {
    const a = filled(300, 0.6)
    for (let f = 30; f < 90; f++) a[f] = 0 // 6s
    for (let f = 180; f < 240; f++) a[f] = 0 // 6s
    expect(detectInstrumentalGaps(makeSignal(a, 'stem')).length).toBe(2)
  })

  it('empty signal → no gaps', () => {
    expect(detectInstrumentalGaps(makeSignal(new Float32Array(0), 'stem'))).toEqual([])
  })
})
