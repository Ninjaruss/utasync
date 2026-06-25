import { describe, it, expect } from 'vitest'
import {
  preferredWhisperTimestampMode,
  accurateReadingsAvailable,
  accurateReadingsEstimate,
} from '../../src/ai-pipeline/alignTimestampMode'

describe('preferredWhisperTimestampMode', () => {
  it('uses segment timestamps on lite tier', () => {
    expect(preferredWhisperTimestampMode('lite', 60)).toBe('segment')
  })

  it('uses segment timestamps for long songs on full tier', () => {
    expect(preferredWhisperTimestampMode('full', 300)).toBe('segment')
    expect(preferredWhisperTimestampMode('full', 200)).toBe('segment')
  })

  it('uses word timestamps for short songs on full tier', () => {
    expect(preferredWhisperTimestampMode('full', 120)).toBe('word')
  })

  it('forces word timestamps on full tier when accurate readings are opted in', () => {
    expect(preferredWhisperTimestampMode('full', 300, { accurateReadings: true })).toBe('word')
  })

  it('still uses segment on lite tier even with accurate readings (word merge stalls on phones)', () => {
    expect(preferredWhisperTimestampMode('lite', 120, { accurateReadings: true })).toBe('segment')
  })
})

describe('accurateReadingsAvailable', () => {
  it('is offered only on full tier for long songs (short songs already use word mode)', () => {
    expect(accurateReadingsAvailable('full', 300)).toBe(true)
    expect(accurateReadingsAvailable('full', 120)).toBe(false)
    expect(accurateReadingsAvailable('lite', 300)).toBe(false)
    expect(accurateReadingsAvailable('manual', 300)).toBe(false)
  })
})

describe('accurateReadingsEstimate', () => {
  it('gives a time estimate only when the slower pass would actually run', () => {
    expect(accurateReadingsEstimate('full', 300)).toBe('~3–8 min')
    expect(accurateReadingsEstimate('full', 120)).toBeNull()
    expect(accurateReadingsEstimate('lite', 300)).toBeNull()
  })
})
