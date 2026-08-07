import { describe, it, expect } from 'vitest'
import { snapToSupportedRate } from '../../src/player/snapPlaybackRate'

// What YouTube's iframe API actually offers.
const YT = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

describe('snapToSupportedRate', () => {
  it('passes through a rate the player already supports', () => {
    expect(snapToSupportedRate(0.75, YT)).toBe(0.75)
    expect(snapToSupportedRate(1, YT)).toBe(1)
  })

  // Regression: the "Slower" preset is 60%, which YouTube ignores outright — the
  // chip lit up and the dock read "Speed · 60%" while the audio played at 100%.
  it('snaps an unsupported rate to the nearest one that works', () => {
    expect(snapToSupportedRate(0.6, YT)).toBe(0.5)
    expect(snapToSupportedRate(0.7, YT)).toBe(0.75)
    expect(snapToSupportedRate(1.1, YT)).toBe(1)
    expect(snapToSupportedRate(1.9, YT)).toBe(2)
  })

  it('prefers the slower option on an exact tie, since this is a study tool', () => {
    expect(snapToSupportedRate(0.875, YT)).toBe(0.75)
    expect(snapToSupportedRate(1.125, YT)).toBe(1)
  })

  it('clamps beyond the supported range rather than giving up', () => {
    expect(snapToSupportedRate(0.1, YT)).toBe(0.25)
    expect(snapToSupportedRate(4, YT)).toBe(2)
  })

  it('returns the request unchanged when the player reports no rates', () => {
    expect(snapToSupportedRate(0.6, [])).toBe(0.6)
    expect(snapToSupportedRate(0.6, undefined)).toBe(0.6)
  })

  it('copes with an unsorted list', () => {
    expect(snapToSupportedRate(0.6, [2, 0.5, 1, 0.75])).toBe(0.5)
  })
})
