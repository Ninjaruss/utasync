import { describe, it, expect, vi } from 'vitest'
import {
  assessStemPass,
  assessStemQuality,
  warnIfStemPassWeak,
  warnIfStemRejected,
  STEM_GOOD_SHARE_FLOOR,
  STEM_VOICED_FLOOR,
} from '../../src/ai-pipeline/stemQuality'
import type { LineAlignmentQuality, TimedLine } from '../../src/core/types'
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

describe('assessStemPass', () => {
  const at = (i: number): TimedLine => ({ original: `line ${i}`, translation: '', startTime: i * 2, endTime: i * 2 + 1.8 })
  const mk = (n: number, labels: LineAlignmentQuality[]) =>
    [Array.from({ length: n }, (_, i) => at(i)), labels] as const

  it('rejects a stem pass whose lines are essentially unverifiable (the live case)', () => {
    // AKFG "Rock'n'Roll…" (THE FIRST TAKE): the isolated run verified 0 of 30 rows
    // while the mix verified 21 of 30 — 15.4s vs 2.8s mean error.
    const [lines, quality] = mk(30, Array.from({ length: 30 }, () => 'approximate' as LineAlignmentQuality))
    const v = assessStemPass(lines, quality, 'stem')
    expect(v.weak).toBe(true)
    expect(v.reason).toBe('unverifiable-stem')
    expect(v.goodShare).toBe(0)
  })

  it('keeps a merely-approximate stem pass (every other measured song)', () => {
    // stranger stem 0.41, veil stem 0.40, guitar 0.67 — all above the floor.
    const labels = [
      ...Array.from({ length: 24 }, () => 'good' as LineAlignmentQuality),
      ...Array.from({ length: 35 }, () => 'approximate' as LineAlignmentQuality),
    ]
    const v = assessStemPass(Array.from({ length: 59 }, (_, i) => at(i)), labels, 'stem')
    expect(v.weak).toBe(false)
    expect(v.goodShare).toBeCloseTo(24 / 59, 2)
    expect(v.goodShare).toBeGreaterThan(STEM_GOOD_SHARE_FLOOR)
  })

  it('never triggers on a mix pass (the fallback must not recurse)', () => {
    const labels = Array.from({ length: 30 }, () => 'needs_review' as LineAlignmentQuality)
    expect(assessStemPass(Array.from({ length: 30 }, (_, i) => at(i)), labels, 'mix').weak).toBe(false)
  })

  it('does not judge a clip too short to have a signal', () => {
    const labels = Array.from({ length: 3 }, () => 'needs_review' as LineAlignmentQuality)
    const v = assessStemPass(Array.from({ length: 3 }, (_, i) => at(i)), labels, 'stem')
    expect(v.weak).toBe(false)
    expect(v.reason).toBe('too-few-lines')
  })

  it('ignores blank/translation-only rows when scoring', () => {
    const lines: TimedLine[] = [
      ...Array.from({ length: 8 }, (_, i) => at(i)),
      { original: '', translation: '', startTime: 30, endTime: 31 },
    ]
    const labels = [
      ...Array.from({ length: 8 }, () => 'needs_review' as LineAlignmentQuality),
      'good' as LineAlignmentQuality,
    ]
    const v = assessStemPass(lines, labels, 'stem')
    expect(v.scoreable).toBe(8)
    expect(v.goodShare).toBe(0)
    expect(v.weak).toBe(true)
  })

  it('logs (once) when a stem pass is discarded, so real-world firing is observable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const labels = Array.from({ length: 8 }, () => 'needs_review' as LineAlignmentQuality)
      warnIfStemPassWeak('unit', assessStemPass(Array.from({ length: 8 }, (_, i) => at(i)), labels, 'stem'))
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('unit')
    } finally {
      warn.mockRestore()
    }
  })
})
