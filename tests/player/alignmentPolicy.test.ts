// tests/player/alignmentPolicy.test.ts
import { describe, it, expect } from 'vitest'
import { linesAreTimed, chooseAutoAlignment, manualAlignMode } from '../../src/player/alignmentPolicy'
import type { TimedLine } from '../../src/core/types'

const untimed: TimedLine[] = [{ startTime: 0, endTime: 0, original: 'a', translation: '' }]
const timed: TimedLine[] = [{ startTime: 0, endTime: 3, original: 'a', translation: '' }]

describe('linesAreTimed', () => {
  it('true when any line has a positive endTime', () => {
    expect(linesAreTimed(timed)).toBe(true)
    expect(linesAreTimed(untimed)).toBe(false)
    expect(linesAreTimed([])).toBe(false)
  })
})

describe('chooseAutoAlignment', () => {
  it('null without stored audio', () => {
    expect(chooseAutoAlignment(false, untimed, 'full')).toBeNull()
  })
  it('null when already timed', () => {
    expect(chooseAutoAlignment(true, timed, 'full')).toBeNull()
  })
  it('null when no lines', () => {
    expect(chooseAutoAlignment(true, [], 'full')).toBeNull()
  })
  it('auto for capable device + untimed', () => {
    expect(chooseAutoAlignment(true, untimed, 'full')).toBe('auto')
    expect(chooseAutoAlignment(true, untimed, 'lite')).toBe('auto')
  })
  it('tap for manual tier + untimed', () => {
    expect(chooseAutoAlignment(true, untimed, 'manual')).toBe('tap')
  })
})

describe('manualAlignMode', () => {
  it('maps tier to align mode', () => {
    expect(manualAlignMode('full')).toBe('auto')
    expect(manualAlignMode('manual')).toBe('tap')
  })
})
