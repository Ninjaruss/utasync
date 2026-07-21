import { describe, it, expect } from 'vitest'
import { computeVocalActivity, voicedFraction } from '../../src/ai-pipeline/vocalActivity'

const SR = 16000

/** Fill [startSec,endSec) of `pcm` with a sine at `freqHz`. */
function tone(pcm: Float32Array, sr: number, startSec: number, endSec: number, freqHz: number, amp = 0.5) {
  const a = Math.floor(startSec * sr), b = Math.min(pcm.length, Math.floor(endSec * sr))
  for (let i = a; i < b; i++) pcm[i] += amp * Math.sin((2 * Math.PI * freqHz * i) / sr)
}

describe('computeVocalActivity', () => {
  it('reports high activity in a vocal-band region and low activity in silence', () => {
    const pcm = new Float32Array(SR * 6) // 6s, all silent...
    tone(pcm, SR, 1, 3, 300)  // ...except a 300Hz (vocal-band) tone 1–3s
    const sig = computeVocalActivity(pcm, SR, { source: 'stem' })
    expect(sig.source).toBe('stem')
    expect(sig.hopSec).toBeGreaterThan(0)
    expect(voicedFraction(sig, 1.2, 2.8)).toBeGreaterThan(0.8) // tone region is voiced
    expect(voicedFraction(sig, 3.5, 5.5)).toBeLessThan(0.2)    // silent region is not
  })

  it('treats out-of-band (sub-bass) energy as non-vocal', () => {
    const pcm = new Float32Array(SR * 4)
    tone(pcm, SR, 0.5, 3.5, 60) // 60Hz bass, below the vocal band
    const sig = computeVocalActivity(pcm, SR, { source: 'mix' })
    expect(voicedFraction(sig, 1, 3)).toBeLessThan(0.3)
  })

  it('is empty-safe (zero-length input)', () => {
    const sig = computeVocalActivity(new Float32Array(0), SR, { source: 'mix' })
    expect(sig.activity.length).toBe(0)
    expect(voicedFraction(sig, 0, 1)).toBe(0)
  })
})
