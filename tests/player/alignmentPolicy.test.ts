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
  it('null without stored audio or playback', () => {
    expect(chooseAutoAlignment(false, untimed, 'full', false)).toBeNull()
  })
  it('tap for YouTube-only playback without stored audio', () => {
    expect(chooseAutoAlignment(false, untimed, 'full', true)).toBe('tap')
    expect(chooseAutoAlignment(false, untimed, 'manual', true)).toBe('tap')
  })
  it('offers the drag for local audio whose lines are ALREADY timed', () => {
    // Changed deliberately: this used to assert 'auto'. A found LRCLIB entry
    // matches the local recording to within a median 0.24-0.73s after one
    // constant shift, so a timed song needs that constant, not a full
    // transcription. See tests/player/alignmentPolicy.offset.test.ts.
    expect(chooseAutoAlignment(true, timed, 'full')).toBe('offset')
  })
  it('auto for local audio with untimed lines, until auto-align has run once', () => {
    expect(chooseAutoAlignment(true, untimed, 'full')).toBe('auto')
    expect(chooseAutoAlignment(true, timed, 'full', true, 'auto')).toBeNull()
    expect(chooseAutoAlignment(true, untimed, 'full', true, 'auto')).toBeNull()
  })
  it('null for imported sync on YouTube-only playback', () => {
    expect(chooseAutoAlignment(false, timed, 'full')).toBeNull()
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
