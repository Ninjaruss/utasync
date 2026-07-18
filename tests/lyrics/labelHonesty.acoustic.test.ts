import { describe, it, expect } from 'vitest'
import { applyLabelHonesty } from '../../src/lyrics/labelHonesty'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'
import type { TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

/** Envelope with `activity`=1 everywhere except [breakStart,breakEnd)=0. */
function signal(source: 'stem' | 'mix', breakStart: number, breakEnd: number, durSec = 30): VocalActivitySignal {
  const hopSec = 0.02
  const frames = Math.ceil(durSec / hopSec)
  const activity = new Float32Array(frames).fill(1)
  for (let f = Math.floor(breakStart / hopSec); f < Math.ceil(breakEnd / hopSec) && f < frames; f++) activity[f] = 0
  return { hopSec, activity, onset: new Float32Array(frames), source }
}

const line = (original: string, startTime: number, endTime: number): TimedLine => ({ original, translation: '', startTime, endTime })
const word = (text: string, s: number, e: number): TranscriptWord => ({ word: text, startTime: s, endTime: e })

describe('applyLabelHonesty acoustic gate', () => {
  const lines = [line('歌ってる', 1, 4), line('ここは無音', 10, 14), line('また歌う', 20, 23)]
  const lineTexts = lines.map((l) => l.original)
  // Transcript matches lines 0 and 2; line 1 sits on the acoustic break (10–15s).
  const words = [word('歌っ', 1, 2), word('てる', 2, 4), word('また', 20, 21), word('歌う', 21, 23)]

  it('demotes a good line whose window is acoustically empty (stem)', () => {
    const q = applyLabelHonesty({
      lines, lineTexts, quality: ['good', 'good', 'good'], words, mode: 'content',
      vocalActivity: signal('stem', 10, 15),
    })
    expect(q[1]).toBe('approximate') // on the break → demoted
    expect(q[0]).toBe('good')        // real vocals → kept
    expect(q[2]).toBe('good')
  })

  it('does NOT demote on a raw mix when the line has strong lexical coverage', () => {
    // Line 1 now has matching transcript words inside the "break" window.
    const wordsCovered = [...words, word('ここは', 10.5, 11.5), word('無音', 11.5, 13)]
    const q = applyLabelHonesty({
      lines, lineTexts, quality: ['good', 'good', 'good'], words: wordsCovered, mode: 'content',
      vocalActivity: signal('mix', 10, 15),
    })
    expect(q[1]).toBe('good') // mix + strong lexical coverage → spared (corroborate, don't override)
  })

  it('DOES demote on a stem even with lexical coverage (stem is decisive)', () => {
    const wordsCovered = [...words, word('ここは', 10.5, 11.5), word('無音', 11.5, 13)]
    const q = applyLabelHonesty({
      lines, lineTexts, quality: ['good', 'good', 'good'], words: wordsCovered, mode: 'content',
      vocalActivity: signal('stem', 10, 15),
    })
    expect(q[1]).toBe('approximate')
  })

  it('is a no-op when no vocalActivity is supplied', () => {
    const q = applyLabelHonesty({ lines, lineTexts, quality: ['good', 'good', 'good'], words, mode: 'content' })
    expect(q).toEqual(['good', 'good', 'good'])
  })

  it('does NOT demote a correctly-placed quiet verse (graded low-but-present energy) on a stem', () => {
    // Line 1's window (10–14s) has quiet-but-present vocal energy (0.08) — far below
    // the loud chorus but clearly not silence. It must be SPARED; only true silence
    // (a break/intro, activity ≈ 0) should demote.
    const hopSec = 0.02
    const frames = Math.ceil(30 / hopSec)
    const activity = new Float32Array(frames).fill(1)
    for (let f = Math.floor(10 / hopSec); f < Math.ceil(14 / hopSec); f++) activity[f] = 0.08
    const va = { hopSec, activity, onset: new Float32Array(frames), source: 'stem' as const }
    const q = applyLabelHonesty({ lines, lineTexts, quality: ['good', 'good', 'good'], words, mode: 'content', vocalActivity: va })
    expect(q[1]).toBe('good') // quiet-but-present verse spared
  })

  it('STILL demotes a good line on true silence (stem)', () => {
    // Regression guard: a genuinely silent window (activity 0) must still demote.
    const q = applyLabelHonesty({
      lines, lineTexts, quality: ['good', 'good', 'good'], words, mode: 'content',
      vocalActivity: signal('stem', 10, 15),
    })
    expect(q[1]).toBe('approximate')
  })
})
