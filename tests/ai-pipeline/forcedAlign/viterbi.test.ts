import { describe, it, expect } from 'vitest'
import { forcedAlignCTC } from '../../../src/ai-pipeline/forcedAlign/viterbi'

// 3 frames, vocab {0:blank, 1:'a', 2:'b'}. Log-probs (natural log of a clear winner).
// frame0 -> 'a', frame1 -> blank, frame2 -> 'b'. Target tokens [1,2] ('a','b').
const L = Math.log
const emissions = [
  [L(0.1), L(0.8), L(0.1)], // a
  [L(0.8), L(0.1), L(0.1)], // blank
  [L(0.1), L(0.1), L(0.8)], // b
]

describe('forcedAlignCTC', () => {
  it('maps each target token to its most likely frame span, monotonically', () => {
    const spans = forcedAlignCTC(emissions, [1, 2], 0)
    expect(spans).toHaveLength(2)
    expect(spans[0]).toEqual({ tokenIndex: 0, tokenId: 1, startFrame: 0, endFrame: 0 })
    expect(spans[1].tokenId).toBe(2)
    expect(spans[1].startFrame).toBe(2)
    // Monotonic non-overlapping frames.
    expect(spans[1].startFrame).toBeGreaterThanOrEqual(spans[0].endFrame)
  })

  it('handles a repeated token separated by a blank', () => {
    const e = [[L(0.1), L(0.8)], [L(0.8), L(0.1)], [L(0.1), L(0.8)]] // vocab {0:blank,1:'a'}
    const spans = forcedAlignCTC(e, [1, 1], 0)
    expect(spans).toHaveLength(2)
    expect(spans[0].startFrame).toBe(0)
    expect(spans[1].startFrame).toBe(2)
  })
})
