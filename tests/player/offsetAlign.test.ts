import { describe, it, expect } from 'vitest'
import { shiftLinesBy, offsetForLine } from '../../src/player/offsetAlign'
import type { TimedLine } from '../../src/core/types'

const L = (startTime: number, endTime: number, extra: Partial<TimedLine> = {}): TimedLine =>
  ({ startTime, endTime, original: 'o', translation: 't', ...extra })

describe('offsetForLine', () => {
  it('is the gap between where the line is and where the user put it', () => {
    expect(offsetForLine([L(6.5, 9.1)], 0, 7.76)).toBeCloseTo(1.26)
  })
  it('is negative when the user drags earlier', () => {
    expect(offsetForLine([L(6.5, 9.1)], 0, 5.0)).toBeCloseTo(-1.5)
  })
  it('is 0 for a line that does not exist', () => {
    expect(offsetForLine([], 0, 7.76)).toBe(0)
  })
})

describe('shiftLinesBy', () => {
  it('moves every line by the same delta', () => {
    const out = shiftLinesBy([L(6.5, 9.1), L(9.4, 12.0)], 1.26)
    expect(out[0].startTime).toBeCloseTo(7.76)
    expect(out[0].endTime).toBeCloseTo(10.36)
    expect(out[1].startTime).toBeCloseTo(10.66)
    expect(out[1].endTime).toBeCloseTo(13.26)
  })

  it('never produces a negative time', () => {
    // Dragging earlier must not push the opening line before the file starts.
    const out = shiftLinesBy([L(0.75, 3.0), L(4.0, 6.0)], -2.0)
    expect(out[0].startTime).toBe(0)
    expect(out[0].endTime).toBe(1.0)
    expect(out[1].startTime).toBeCloseTo(2.0)
  })

  it('leaves an end time of 0 alone rather than shifting a non-time', () => {
    // A line with no end is "unknown", not "at zero seconds".
    const out = shiftLinesBy([L(5.0, 0)], 1.5)
    expect(out[0].startTime).toBeCloseTo(6.5)
    expect(out[0].endTime).toBe(0)
  })

  it('preserves every other field on the line', () => {
    const out = shiftLinesBy(
      [L(1, 2, { furigana: '<ruby>x</ruby>', translationGroup: 3, translationConfidence: 0.4 })],
      1,
    )
    expect(out[0].furigana).toBe('<ruby>x</ruby>')
    expect(out[0].translationGroup).toBe(3)
    expect(out[0].translationConfidence).toBe(0.4)
    expect(out[0].original).toBe('o')
    expect(out[0].translation).toBe('t')
  })

  it('returns equal times for a zero delta', () => {
    const input = [L(6.5, 9.1), L(9.4, 12.0)]
    const out = shiftLinesBy(input, 0)
    expect(out.map((l) => [l.startTime, l.endTime])).toEqual([[6.5, 9.1], [9.4, 12.0]])
  })

  it('does not mutate the input', () => {
    const input = [L(6.5, 9.1)]
    shiftLinesBy(input, 5)
    expect(input[0].startTime).toBe(6.5)
  })
})
