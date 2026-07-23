import { describe, it, expect, vi } from 'vitest'
import { reanalyzeLateSections } from '../../src/lyrics/lateSectionReanchor'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'
import type { TimedLine } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})
const refinedOf = (lines: TimedLine[]): RefinedAlignment =>
  ({ lines, phrases: [], report: {}, mode: 'content', confidence: 1, phraseLayout: 'sheet' } as unknown as RefinedAlignment)

/** A 'stem' signal that is quiet in [0, gapEnd) then voiced — one instrumental gap. */
const stemWithGap = (gapEnd: number, totalSec: number, hopSec = 0.1): VocalActivitySignal => {
  const n = Math.round(totalSec / hopSec)
  const activity = new Float32Array(n)
  for (let f = Math.round(gapEnd / hopSec); f < n; f++) activity[f] = 0.6
  return { hopSec, activity, onset: new Float32Array(n), source: 'stem' }
}
const word = (w: string, s: number, e: number): TranscriptWord => ({ word: w, startTime: s, endTime: e })

describe('reanalyzeLateSections', () => {
  it('pulls a late section entry back to its focused re-transcription onset', async () => {
    const lines = [line('あいうえお', 30, 33)] // placed 7s late; true onset ~23
    const sig = stemWithGap(22, 60) // gap [0,22] → window [19,49] covers line 0
    const transcribeSlice = vi.fn(async () => [word('あいうえお', 23, 25)])
    const res = await reanalyzeLateSections({
      refined: refinedOf(lines),
      sheetRows: lines,
      alignmentLanguage: 'ja',
      vocalSig: sig,
      transcribeSlice,
    })
    expect(transcribeSlice).toHaveBeenCalled()
    expect(res.changedCount).toBe(1)
    expect(res.refined.lines[0].startTime).toBeCloseTo(23, 1)
  })

  it('is a no-op on a mix source and never transcribes', async () => {
    const lines = [line('あいうえお', 30, 33)]
    const sig: VocalActivitySignal = { ...stemWithGap(22, 60), source: 'mix' }
    const transcribeSlice = vi.fn(async () => [word('あいうえお', 23, 25)])
    const res = await reanalyzeLateSections({
      refined: refinedOf(lines),
      sheetRows: lines,
      alignmentLanguage: 'ja',
      vocalSig: sig,
      transcribeSlice,
    })
    expect(transcribeSlice).not.toHaveBeenCalled()
    expect(res.changedCount).toBe(0)
    expect(res.refined.lines[0].startTime).toBe(30)
  })

  it('never drags a repeated line living outside the re-pass window', async () => {
    const lines = [line('あいうえお', 30, 33), line('あいうえお', 100, 103)]
    const sig = stemWithGap(22, 130) // one gap [0,22]; line 1 @100 is far outside the window
    const transcribeSlice = vi.fn(async () => [word('あいうえお', 23, 25)])
    const res = await reanalyzeLateSections({
      refined: refinedOf(lines),
      sheetRows: lines,
      alignmentLanguage: 'ja',
      vocalSig: sig,
      transcribeSlice,
    })
    // The far repeat is masked out of this section, so it can NEVER be pulled here.
    expect(res.refined.lines[1].startTime).toBe(100)
    // The in-window line only ever moves earlier (never later, never past the window).
    expect(res.refined.lines[0].startTime).toBeLessThanOrEqual(30)
    expect(res.refined.lines[0].startTime).toBeGreaterThanOrEqual(22)
  })

  it('leaves an already on-time line alone (no false pull)', async () => {
    const lines = [line('あいうえお', 23, 26)] // already on time
    const sig = stemWithGap(22, 60)
    const transcribeSlice = vi.fn(async () => [word('あいうえお', 23, 25)])
    const res = await reanalyzeLateSections({
      refined: refinedOf(lines),
      sheetRows: lines,
      alignmentLanguage: 'ja',
      vocalSig: sig,
      transcribeSlice,
    })
    expect(res.changedCount).toBe(0)
    expect(res.refined.lines[0].startTime).toBe(23)
  })
})
