import { describe, it, expect } from 'vitest'
import { abEndpointFromLine, abLoopPatchFromLineTap, isValidABPair, lyricLoopHighlight } from '../../src/player/abLoopUtils'
import { VOCAL_ONSET_LEAD_S } from '../../src/lyrics/lineTiming'
import type { TimedLine } from '../../src/core/types'

const line = (startTime: number, endTime: number, original = 'x'): TimedLine => ({
  startTime, endTime, original, translation: '',
})

describe('abEndpointFromLine', () => {
  it('sets A to slightly before the line start', () => {
    expect(abEndpointFromLine('a', line(1, 3), null)).toBeCloseTo(1 - VOCAL_ONSET_LEAD_S)
  })

  it('sets B to the line end when A is on the same line', () => {
    expect(abEndpointFromLine('b', line(1, 3), 1)).toBe(3)
  })

  it('sets B to the next line start when A is on a different line', () => {
    expect(abEndpointFromLine('b', line(3, 5), 1)).toBe(3)
  })

  it('forms a valid pair for a single-line loop', () => {
    const a = abEndpointFromLine('a', line(1, 3), null)
    const b = abEndpointFromLine('b', line(1, 3), a)
    expect(isValidABPair(a, b)).toBe(true)
  })
})

describe('abLoopPatchFromLineTap', () => {
  it('forms a valid single-line pair when B is set before A', () => {
    const l = line(1, 3)
    const afterB = abLoopPatchFromLineTap('b', l, { a: null, b: null })
    expect(afterB).toEqual({ b: 1 })
    const afterA = abLoopPatchFromLineTap('a', l, { a: null, b: afterB.b! })
    expect(afterA.a).toBeCloseTo(1 - VOCAL_ONSET_LEAD_S)
    expect(afterA.b).toBe(3)
    expect(isValidABPair(afterA.a!, afterA.b!)).toBe(true)
  })

  it('keeps cross-line B-first pairs when A is on an earlier line', () => {
    const l1 = line(1, 3)
    const l2 = line(5, 7)
    const afterB = abLoopPatchFromLineTap('b', l2, { a: null, b: null })
    expect(afterB).toEqual({ b: 5 })
    const afterA = abLoopPatchFromLineTap('a', l1, { a: null, b: afterB.b! })
    expect(afterA.a).toBeCloseTo(1 - VOCAL_ONSET_LEAD_S)
    expect(isValidABPair(afterA.a!, afterB.b!)).toBe(true)
  })
})

describe('lyricLoopHighlight', () => {
  const lines: TimedLine[] = [
    line(0, 2, 'one'),
    line(2, 5, 'two'),
    line(5, 8, 'three'),
  ]
  const abLoop = { a: 0, b: 2.5, preRoll: 0, loopCount: 3, crossfadeDuration: 0.3 }

  it('highlights manual A/B regions when playlist is off', () => {
    expect(lyricLoopHighlight(lines[0], 0, lines, abLoop, true, false, [], 0)).toBe('ab')
    expect(lyricLoopHighlight(lines[2], 2, lines, abLoop, true, false, [], 0)).toBeNull()
  })

  it('highlights all playlist segments and marks the active one', () => {
    const entries = [
      { id: '1', a: 0, b: 2.5 },
      { id: '2', a: 5, b: 7.5 },
    ]
    expect(lyricLoopHighlight(lines[0], 0, lines, abLoop, true, true, entries, 0)).toBe('playlist-current')
    expect(lyricLoopHighlight(lines[2], 2, lines, abLoop, true, true, entries, 0)).toBe('playlist')
    expect(lyricLoopHighlight(lines[2], 2, lines, abLoop, true, true, entries, 1)).toBe('playlist-current')
  })
})
