import { describe, it, expect, vi } from 'vitest'
import { assessStemQuality, warnIfStemRejected, STEM_VOICED_FLOOR } from '../../src/ai-pipeline/stemQuality'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'
import { VOICED_THRESHOLD } from '../../src/ai-pipeline/vocalActivity'

/** Build a stem signal whose frames alternate voiced/quiet to hit a target
 * voiced fraction. hopSec chosen so `frames` frames span `durationSec`. */
function stemSignal(voicedFrac: number, durationSec: number, frames = 1000): VocalActivitySignal {
  const hopSec = durationSec / frames
  const activity = new Float32Array(frames)
  const voicedCount = Math.round(voicedFrac * frames)
  // Voiced frames sit comfortably above the threshold; quiet frames at ~0.
  for (let i = 0; i < voicedCount; i++) activity[i] = VOICED_THRESHOLD * 4
  return { hopSec, activity, onset: new Float32Array(frames), source: 'stem' }
}

describe('assessStemQuality', () => {
  it('rejects a destroyed (near-silent) stem', () => {
    const sig = stemSignal(0, 200) // Demucs annihilated everything
    const v = assessStemQuality(sig, 200)
    expect(v.usable).toBe(false)
    expect(v.reason).toBe('silent-stem')
    expect(v.voicedFraction).toBeLessThan(STEM_VOICED_FLOOR)
  })

  it('accepts a healthy vocal stem', () => {
    const sig = stemSignal(0.55, 200) // typical sung track: singing most of the song
    const v = assessStemQuality(sig, 200)
    expect(v.usable).toBe(true)
    expect(v.reason).toBe('ok')
    expect(v.voicedFraction).toBeGreaterThan(STEM_VOICED_FLOOR)
  })

  it('accepts a genuinely sparse but present vocal stem (does not over-reject)', () => {
    // A track that is mostly instrumental with only occasional vocals must still
    // be transcribed on the stem — the floor only catches near-total destruction.
    const sig = stemSignal(0.15, 200)
    const v = assessStemQuality(sig, 200)
    expect(v.usable).toBe(true)
  })

  it('treats an unassessable (empty) signal as usable — never worse than status quo', () => {
    const empty: VocalActivitySignal = { hopSec: 0.02, activity: new Float32Array(0), onset: new Float32Array(0), source: 'stem' }
    const v = assessStemQuality(empty, 200)
    expect(v.usable).toBe(true)
    expect(v.reason).toBe('unassessable')
  })

  it('is decisive only for a stem source; a mix signal is never rejected', () => {
    // The guard exists to catch a bad separation. A raw mix is the fallback
    // target itself — assessing it and rejecting would be nonsensical.
    const mix: VocalActivitySignal = { ...stemSignal(0, 200), source: 'mix' }
    const v = assessStemQuality(mix, 200)
    expect(v.usable).toBe(true)
  })
})

describe('warnIfStemRejected', () => {
  it('logs (once) when a stem is rejected so real-world firing is observable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      warnIfStemRejected('unit', assessStemQuality(stemSignal(0, 200), 200))
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('unit')
    } finally {
      warn.mockRestore()
    }
  })

  it('stays silent when the stem was accepted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      warnIfStemRejected('unit', assessStemQuality(stemSignal(0.55, 200), 200))
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
