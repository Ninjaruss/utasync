import { describe, it, expect } from 'vitest'
import { preferredWhisperTimestampMode } from '../../src/ai-pipeline/alignTimestampMode'

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
})
