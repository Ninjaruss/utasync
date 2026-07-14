import { describe, it, expect } from 'vitest'
import { redistributeDegenerateRuns } from '../../src/lyrics/redistributeDegenerateRuns'
import { minLineDuration } from '../../src/lyrics/lineDegeneracy'
import type { TimedLine } from '../../src/core/types'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})
const w = (word: string, startTime: number, endTime: number) => ({ word, startTime, endTime })

function anchorWords(text: string, start: number, end: number) {
  const words = text.split(' ')
  const dur = (end - start) / words.length
  return words.map((word, i) => w(word, start + i * dur, start + (i + 1) * dur))
}

// Round-6 packing floor (diagnosis H2): when activity capacity is a fraction of
// a run's expected duration (evidence desert with a hallucinated blip), the old
// packer scaled every line by capacity/totalExpected with no lower bound —
// sub-second slivers hugging the region's left edge, and start == end rows once
// the cursor exhausted the last region.
describe('redistributeDegenerateRuns — packing floor', () => {
  const before = 'the quick brown fox jumps over the lazy dog again'
  const after = 'every good boy deserves fudge and cake at the party'
  const runText = (i: number) => `stranger than heaven calling out my name tonight ${i}`

  it('never packs a run line below min(minLineDuration, fairShare) onto a garbage blip', () => {
    // One 0.9s blip vs ~16s of expected run duration: the old scale (×0.056)
    // packed five 0.18s slivers into [20, 20.9].
    const words = [
      ...anchorWords(before, 10, 14),
      ...anchorWords('blip noise', 20, 20.9),
      ...anchorWords(after, 60, 64),
    ]
    const lines = [
      line(before, 10, 14),
      ...Array.from({ length: 5 }, (_, i) => line(runText(i), 14 + i * 0.1, 14.1 + i * 0.1)),
      line(after, 60, 64),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    expect(res.redistributed.slice(1, 6)).toEqual([true, true, true, true, true])
    const fairShare = (60 - 14) / 5
    for (let i = 1; i <= 5; i++) {
      const dur = res.lines[i].endTime - res.lines[i].startTime
      const floor = Math.min(minLineDuration(res.lines[i].original), fairShare)
      expect(dur, `line ${i} duration`).toBeGreaterThanOrEqual(floor - 1e-6)
    }
    // Monotone, inside the inter-anchor window.
    for (let i = 2; i <= 5; i++) {
      expect(res.lines[i].startTime).toBeGreaterThanOrEqual(res.lines[i - 1].endTime - 1e-6)
    }
    expect(res.lines[1].startTime).toBeGreaterThanOrEqual(14)
    expect(res.lines[5].endTime).toBeLessThanOrEqual(60)
    expect(res.lines[0]).toMatchObject({ startTime: 10, endTime: 14 })
    expect(res.lines[6]).toMatchObject({ startTime: 60, endTime: 64 })
  })

  it('never emits start == end rows when the last activity region exhausts', () => {
    // Fragmented capacity: the long line cannot fit region0, so the old packer
    // advanced and clamped it to ALL of region1 — every following line then
    // started AND ended at region1's end (the literal zero-duration rows).
    const long =
      'stranger than heaven calling out my name tonight while the city sleeps ' +
      'and every light goes out across the tired old town again'
    const words = [
      ...anchorWords(before, 10, 14),
      ...anchorWords('hmm ooh', 20, 20.5),
      w('blip', 30, 30.3),
      ...anchorWords(after, 60, 64),
    ]
    const runTexts = [long, 'oh yeah one', 'oh yeah two']
    const lines = [
      line(before, 10, 14),
      ...runTexts.map((t, i) => line(t, 14 + i * 0.05, 14.05 + i * 0.05)),
      line(after, 60, 64),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    const fairShare = (60 - 14) / 3
    for (let i = 1; i <= 3; i++) {
      const dur = res.lines[i].endTime - res.lines[i].startTime
      expect(res.lines[i].endTime, `line ${i} zero width`).toBeGreaterThan(res.lines[i].startTime)
      const floor = Math.min(minLineDuration(res.lines[i].original), fairShare)
      expect(dur, `line ${i} duration`).toBeGreaterThanOrEqual(floor - 1e-6)
    }
    for (let i = 2; i <= 3; i++) {
      expect(res.lines[i].startTime).toBeGreaterThanOrEqual(res.lines[i - 1].endTime - 1e-6)
    }
    expect(res.lines[3].endTime).toBeLessThanOrEqual(60)
  })
})
