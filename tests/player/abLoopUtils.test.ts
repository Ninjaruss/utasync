import { describe, it, expect } from 'vitest'
import { abEndpointFromLine, isValidABPair } from '../../src/player/abLoopUtils'
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
