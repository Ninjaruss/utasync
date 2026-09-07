import { describe, it, expect } from 'vitest'
import { canAutoAlign } from '../../src/ai-pipeline/capability'

/* The threshold that five copy sites had each re-implemented as `!== 'manual'`,
 * three of which drifted into promising a manual-tier device a feature it can
 * never run. Named once so the copy cannot drift from the capability again. */
describe('canAutoAlign', () => {
  it('is true on the tiers that have an on-device Whisper path', () => {
    expect(canAutoAlign('full')).toBe(true)
    expect(canAutoAlign('lite')).toBe(true)
  })

  it('is false on manual tier, which has no transcription path at all', () => {
    expect(canAutoAlign('manual')).toBe(false)
  })
})
