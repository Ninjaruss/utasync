import { describe, it, expect } from 'vitest'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'
import type { TimedLine } from '../../src/core/types'

/** All-silent stem envelope: EVERY line's window is acoustically empty, so every
 * 'good' line must demote — a deterministic, non-vacuous proof that the signal
 * reached applyLabelHonesty. */
function allSilent(durSec = 120): VocalActivitySignal {
  const hopSec = 0.02
  const frames = Math.ceil(durSec / hopSec)
  return { hopSec, activity: new Float32Array(frames), onset: new Float32Array(frames), source: 'stem' }
}

// NOTE: TranscriptWord's field is `word`, not `text`.
const w = (text: string, s: number, e: number): TranscriptWord => ({ word: text, startTime: s, endTime: e } as TranscriptWord)

describe('refineAlignmentWithPhrases threads vocalActivity to label honesty', () => {
  const sheet: TimedLine[] = [
    { original: 'あいうえお', translation: '', startTime: 0, endTime: 0 },
    { original: 'かきくけこ', translation: '', startTime: 0, endTime: 0 },
    { original: 'さしすせそ', translation: '', startTime: 0, endTime: 0 },
  ]
  const words = [w('あいうえお', 1, 4), w('かきくけこ', 6, 9), w('さしすせそ', 11, 14)]

  const goodCount = (r: ReturnType<typeof refineAlignmentWithPhrases>) =>
    (r.lineAlignmentQuality ?? []).filter((q) => q === 'good').length

  it('an all-silent signal strictly reduces the good count (signal reaches the gate)', () => {
    const base = goodCount(refineAlignmentWithPhrases(sheet, words, 'ja'))
    expect(base).toBeGreaterThan(0) // sanity: this trivial exact-match sheet has good lines
    const withSig = goodCount(refineAlignmentWithPhrases(sheet, words, 'ja', undefined, { vocalActivity: allSilent() }))
    expect(withSig).toBeLessThan(base) // acoustic gate demoted good→approximate
  })

  it('keeps timings/shape identical (label-only)', () => {
    const base = refineAlignmentWithPhrases(sheet, words, 'ja')
    const withSig = refineAlignmentWithPhrases(sheet, words, 'ja', undefined, { vocalActivity: allSilent() })
    expect(withSig.lines.map((l) => [l.startTime, l.endTime])).toEqual(base.lines.map((l) => [l.startTime, l.endTime]))
  })
})
