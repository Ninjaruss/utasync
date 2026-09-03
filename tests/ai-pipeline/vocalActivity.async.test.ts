import { describe, it, expect } from 'vitest'
import { computeVocalActivity, computeVocalActivityAsync } from '../../src/ai-pipeline/vocalActivity'

const SR = 16000

function tone(pcm: Float32Array, sr: number, startSec: number, endSec: number, freqHz: number, amp = 0.5) {
  const a = Math.floor(startSec * sr), b = Math.min(pcm.length, Math.floor(endSec * sr))
  for (let i = a; i < b; i++) pcm[i] += amp * Math.sin((2 * Math.PI * freqHz * i) / sr)
}

/**
 * The analysis runs on the MAIN thread from the align flow, and the FFT costs
 * ~128ms per minute of audio — measured 537ms of unbroken blocking for a 6:33
 * track on a fast machine, which froze the progress UI and its cancel button.
 * The async variant is the same loop interrupted on a wall-clock budget, so it
 * must agree with the synchronous one exactly, not approximately.
 */
describe('computeVocalActivityAsync', () => {
  const pcm = new Float32Array(SR * 8)
  tone(pcm, SR, 1, 3, 300)
  tone(pcm, SR, 4, 6, 2200)
  tone(pcm, SR, 5, 7, 60) // out-of-band energy

  it('agrees with the synchronous analysis bit for bit', async () => {
    const sync = computeVocalActivity(pcm, SR, { source: 'stem' })
    const async_ = await computeVocalActivityAsync(pcm, SR, { source: 'stem' })

    expect(async_.source).toBe(sync.source)
    expect(async_.hopSec).toBe(sync.hopSec)
    expect(async_.activity.length).toBe(sync.activity.length)
    expect(sync.activity.length).toBeGreaterThan(100)
    // Array.from so a mismatch reports the differing frame, not "Float32Array".
    expect(Array.from(async_.activity)).toEqual(Array.from(sync.activity))
    expect(Array.from(async_.onset)).toEqual(Array.from(sync.onset))
  })

  it('handles a buffer shorter than one FFT window the same way', async () => {
    const tiny = new Float32Array(64)
    const sync = computeVocalActivity(tiny, SR, { source: 'mix' })
    const async_ = await computeVocalActivityAsync(tiny, SR, { source: 'mix' })
    expect(sync.activity.length).toBe(0)
    expect(async_.activity.length).toBe(0)
    expect(async_.hopSec).toBe(sync.hopSec)
    expect(async_.source).toBe('mix')
  })

  it('lets other tasks run instead of holding the thread to completion', async () => {
    // Long enough to blow through the wall-clock budget; a short buffer finishes
    // inside one slice and correctly never yields.
    const long = new Float32Array(SR * 90)
    tone(long, SR, 0, 90, 440)

    let otherTaskRan = false
    const pending = computeVocalActivityAsync(long, SR, { source: 'stem' })
    setTimeout(() => { otherTaskRan = true }, 0)
    const result = await pending

    // A synchronous implementation would finish before any macrotask could run.
    expect(otherTaskRan).toBe(true)
    // ...and the interruption still produces the same answer.
    expect(Array.from(result.activity)).toEqual(
      Array.from(computeVocalActivity(long, SR, { source: 'stem' }).activity),
    )
  })
})
