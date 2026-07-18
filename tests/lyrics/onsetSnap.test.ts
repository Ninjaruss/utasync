import { describe, it, expect } from 'vitest'
import { backfillLateStartsToAcousticOnset } from '../../src/lyrics/phraseAlignment'
import { computeLineMatchedSpans } from '../../src/ai-pipeline/contentAligner'
import { sanitizeTranscript, type TranscriptWord } from '../../src/ai-pipeline/aligner'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'
import type { TimedLine } from '../../src/core/types'

// NOTE: TranscriptWord's field is `word`, not `text`.
const w = (word: string, s: number, e: number): TranscriptWord => ({ word, startTime: s, endTime: e } as TranscriptWord)

/** activity 0 on [0,onsetSec), 1 after; a strong onset frame at onsetSec. */
function dipOnsetVoiced(onsetSec: number, source: 'stem' | 'mix' = 'stem', durSec = 30): VocalActivitySignal {
  const hopSec = 0.02
  const frames = Math.ceil(durSec / hopSec)
  const activity = new Float32Array(frames)
  const onset = new Float32Array(frames)
  const oi = Math.floor(onsetSec / hopSec)
  for (let f = oi; f < frames; f++) activity[f] = 1
  onset[oi] = 1
  return { hopSec, activity, onset, source }
}

describe('backfillLateStartsToAcousticOnset', () => {
  const mk = (startTime: number): TimedLine[] => [{ original: 'ここで歌う', translation: '', startTime, endTime: startTime + 4 }]
  const words = [w('ここで', 6, 8), w('歌う', 8, 10)]
  const spans = (lines: TimedLine[]) => computeLineMatchedSpans(lines.map((l) => l.original), sanitizeTranscript(words))

  it('snaps a late start back to the vocal onset (stem), endTime preserved', () => {
    const lines = mk(8)
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(words), spans(lines), dipOnsetVoiced(6, 'stem'))
    expect(out[0].startTime).toBeGreaterThanOrEqual(5.9)
    expect(out[0].startTime).toBeLessThanOrEqual(6.1)
    expect(out[0].endTime).toBe(12)
  })

  it('does NOT snap when there is no pre-onset dip (activity all voiced)', () => {
    const lines = mk(8)
    const hopSec = 0.02, frames = 30 / hopSec
    const loud = { hopSec, activity: new Float32Array(frames).fill(1), onset: (() => { const o = new Float32Array(frames); o[Math.floor(6 / hopSec)] = 1; return o })(), source: 'stem' as const }
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(words), spans(lines), loud)
    expect(out[0].startTime).toBe(8)
  })

  // A disagreeing onset INSIDE the search window: transient at 7s while the
  // transcript onset (span.firstTime) is ~6s — exercises mix corroboration.
  function dipOnset7(source: 'stem' | 'mix'): VocalActivitySignal {
    const hopSec = 0.02, frames = Math.ceil(30 / hopSec)
    const activity = new Float32Array(frames), onset = new Float32Array(frames)
    const oi = Math.floor(7 / hopSec)
    for (let f = oi; f < frames; f++) activity[f] = 1
    onset[oi] = 1
    return { hopSec, activity, onset, source }
  }

  it('does NOT snap on a raw mix when the acoustic onset disagrees with the lexical onset', () => {
    const out = backfillLateStartsToAcousticOnset(mk(8), sanitizeTranscript(words), spans(mk(8)), dipOnset7('mix'))
    expect(out[0].startTime).toBe(8)
  })

  it('snaps on a stem even when the acoustic onset disagrees with the lexical onset (stem decisive)', () => {
    const out = backfillLateStartsToAcousticOnset(mk(8), sanitizeTranscript(words), spans(mk(8)), dipOnset7('stem'))
    expect(out[0].startTime).toBeGreaterThanOrEqual(6.9)
    expect(out[0].startTime).toBeLessThanOrEqual(7.1)
  })

  it('DOES snap on a raw mix when the acoustic onset agrees with the lexical onset', () => {
    const out = backfillLateStartsToAcousticOnset(mk(8), sanitizeTranscript(words), spans(mk(8)), dipOnsetVoiced(6, 'mix'))
    expect(out[0].startTime).toBeLessThanOrEqual(6.1)
  })

  it('does NOT snap a poorly-anchored line (coverage below floor)', () => {
    // Partial match: 'ここ' covers 2 of the 8-char line = 0.25 coverage —
    // strictly between 0 and the 0.3 floor, so the span is NON-null and this
    // exercises the numeric `coverage < ACOUSTIC_SNAP_MIN_COVERAGE` gate rather
    // than the `if (!span) continue` guard. All other gates would pass (onset at
    // 6 with a pre-onset dip and a voiced run), so coverage is the sole reason
    // the line is not snapped.
    const lines: TimedLine[] = [{ original: 'ここで歌うのだよ', translation: '', startTime: 8, endTime: 12 }]
    const partial = [w('ここ', 6, 8)]
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(partial), computeLineMatchedSpans(lines.map((l) => l.original), sanitizeTranscript(partial)), dipOnsetVoiced(6, 'stem'))
    expect(out[0].startTime).toBe(8)
  })

  it('trims the previous line end to avoid overlap when snapping', () => {
    const lines: TimedLine[] = [
      { original: 'まえ', translation: '', startTime: 4, endTime: 9 }, // padded end
      { original: 'ここで歌う', translation: '', startTime: 8, endTime: 12 },
    ]
    const two = [w('まえ', 4, 5), w('ここで', 6, 8), w('歌う', 8, 10)]
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(two), computeLineMatchedSpans(lines.map((l) => l.original), sanitizeTranscript(two)), dipOnsetVoiced(6.5, 'stem'))
    expect(out[1].startTime).toBeLessThan(8)                     // snapped earlier
    expect(out[0].endTime).toBeLessThanOrEqual(out[1].startTime) // no overlap (prev end trimmed)
  })

  it('does not snap if trimming the previous line would squash it below MIN_HIGHLIGHT', () => {
    const lines: TimedLine[] = [
      { original: 'まえ', translation: '', startTime: 6, endTime: 9 },
      { original: 'ここで歌う', translation: '', startTime: 8, endTime: 12 },
    ]
    const two = [w('まえ', 6, 6.8), w('ここで', 6.9, 8), w('歌う', 8, 10)]
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(two), computeLineMatchedSpans(lines.map((l) => l.original), sanitizeTranscript(two)), dipOnsetVoiced(6.9, 'stem'))
    expect(out[1].startTime).toBe(8) // skipped: trimming prev to 6.9 → prev = 0.9s < 1.2
  })

  it('never moves a start across the previous line', () => {
    const lines: TimedLine[] = [
      { original: 'まえのぎょう', translation: '', startTime: 5.5, endTime: 8 },
      { original: 'ここで歌う', translation: '', startTime: 8, endTime: 12 },
    ]
    const two = [w('まえの', 5.5, 7), w('ぎょう', 7, 8), w('ここで', 6, 8), w('歌う', 8, 10)]
    const out = backfillLateStartsToAcousticOnset(lines, sanitizeTranscript(two), computeLineMatchedSpans(lines.map((l) => l.original), sanitizeTranscript(two)), dipOnsetVoiced(6, 'stem'))
    expect(out[1].startTime).toBeGreaterThanOrEqual(out[0].startTime + 0.3)
  })
})
