import { it, expect } from 'vitest'
import type { TimedLine } from '../../src/core/types'
import { detectEdgeAnchors, refitAroundAnchors } from '../../src/lyrics/anchorRefit'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

// The composition AutoAlignFlow performs: detect edge anchors from the sheet +
// transcript, then re-fit line timing around them.
it('auto start/end anchors pull the first and last lines onto their detected onsets', () => {
  const texts = ['intro line', 'x', 'outro line']
  const lines: TimedLine[] = texts.map((t, i) => ({ original: t, translation: '', startTime: i, endTime: i + 1 }))
  const words: TranscriptWord[] = [
    { word: 'intro', startTime: 4, endTime: 4.5 }, { word: 'line', startTime: 4.5, endTime: 5 },
    { word: 'outro', startTime: 30, endTime: 30.5 }, { word: 'line', startTime: 30.5, endTime: 31 },
  ]
  const anchors = detectEdgeAnchors(texts, words, 0.5)
  const out = refitAroundAnchors(lines, anchors, 'en')
  expect(out[0].startTime).toBeCloseTo(4, 0)
  expect(out[2].startTime).toBeCloseTo(30, 0)
})
