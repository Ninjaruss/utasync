import { describe, it, expect } from 'vitest'
import { abEndpointFromLine, abLoopPatchFromLineTap, isValidABPair } from '../../src/player/abLoopUtils'
import type { TimedLine } from '../../src/core/types'

const line = (startTime: number, endTime: number, original = 'x'): TimedLine => ({
  startTime, endTime, original, translation: '',
})

describe('abEndpointFromLine', () => {
  it('sets A to the line start', () => {
    expect(abEndpointFromLine('a', line(1, 3), null)).toBe(1)
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
    expect(afterA).toEqual({ a: 1, b: 3 })
    expect(isValidABPair(afterA.a!, afterA.b!)).toBe(true)
  })

  it('keeps cross-line B-first pairs when A is on an earlier line', () => {
    const l1 = line(1, 3)
    const l2 = line(5, 7)
    const afterB = abLoopPatchFromLineTap('b', l2, { a: null, b: null })
    expect(afterB).toEqual({ b: 5 })
    const afterA = abLoopPatchFromLineTap('a', l1, { a: null, b: afterB.b! })
    expect(afterA).toEqual({ a: 1 })
    expect(isValidABPair(afterA.a!, afterB.b!)).toBe(true)
  })
})
