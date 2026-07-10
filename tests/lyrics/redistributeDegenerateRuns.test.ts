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

describe('redistributeDegenerateRuns', () => {
  it('spreads a pileup run across the activity between its anchors', () => {
    const words = [
      ...anchorWords('the quick brown fox jumps over the lazy dog again', 10, 14),
      ...anchorWords('mumble garble noise hums here and more of it still', 15, 25),
      ...anchorWords('every good boy deserves fudge and cake at the party', 30, 34),
    ]
    const lines = [
      line('The quick brown fox jumps over the lazy dog again', 10, 14),
      line('Something whisper misheard entirely first', 14, 14.2),
      line('Something whisper misheard entirely second', 14.2, 14.4),
      line('Something whisper misheard entirely third', 14.4, 14.6),
      line('Every good boy deserves fudge and cake at the party', 30, 34),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    expect(res.redistributed.slice(1, 4)).toEqual([true, true, true])
    for (let i = 2; i <= 3; i++) {
      expect(res.lines[i].startTime - res.lines[i - 1].startTime).toBeGreaterThanOrEqual(0.4)
    }
    expect(res.lines[1].startTime).toBeGreaterThanOrEqual(14)
    expect(res.lines[3].endTime).toBeLessThanOrEqual(30)
    expect(res.lines[1].startTime).toBeGreaterThanOrEqual(14.9)
    expect(res.onActivity.slice(1, 4)).toEqual([true, true, true])
    expect(res.lines[0]).toMatchObject({ startTime: 10, endTime: 14 })
    expect(res.lines[4]).toMatchObject({ startTime: 30, endTime: 34 })
  })

  it('shrinks an absorbed line instead of letting it span an instrumental', () => {
    const words = [
      ...anchorWords('the quick brown fox jumps over the lazy dog again', 10, 14),
      ...anchorWords('hums and noise right here', 14.5, 18),
      ...anchorWords('every good boy deserves fudge and cake at the party', 48, 52),
    ]
    const lines = [
      line('The quick brown fox jumps over the lazy dog again', 10, 14),
      line('Some middle line the transcript missed', 14.5, 47.5),
      line('Every good boy deserves fudge and cake at the party', 48, 52),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    expect(res.redistributed[1]).toBe(true)
    const dur = res.lines[1].endTime - res.lines[1].startTime
    expect(dur).toBeLessThanOrEqual(6)
    expect(res.lines[1].startTime).toBeGreaterThanOrEqual(14)
    expect(res.lines[1].endTime).toBeLessThanOrEqual(18.5)
  })

  it('is a no-op on sane, well-spaced lines', () => {
    const words = [
      ...anchorWords('the quick brown fox jumps over the lazy dog again', 10, 14),
      ...anchorWords('every good boy deserves fudge and cake at the party', 16, 20),
    ]
    const lines = [
      line('The quick brown fox jumps over the lazy dog again', 10, 14),
      line('Every good boy deserves fudge and cake at the party', 16, 20),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    expect(res.redistributed).toEqual([false, false])
    expect(res.lines).toEqual(lines)
  })

  it('spreads evenly across the window when there is no activity, flagged off-activity', () => {
    const words = [
      ...anchorWords('the quick brown fox jumps over the lazy dog again', 10, 14),
      ...anchorWords('every good boy deserves fudge and cake at the party', 30, 34),
    ]
    const lines = [
      line('The quick brown fox jumps over the lazy dog again', 10, 14),
      line('Ghost line one with several words', 14, 14.1),
      line('Ghost line two with several words', 14.1, 14.2),
      line('Every good boy deserves fudge and cake at the party', 30, 34),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    expect(res.redistributed.slice(1, 3)).toEqual([true, true])
    expect(res.onActivity.slice(1, 3)).toEqual([false, false])
    expect(res.lines[2].startTime).toBeGreaterThan(res.lines[1].startTime + 0.4)
    expect(res.lines[2].endTime).toBeLessThanOrEqual(30)
  })

  it('never strands a line below its minLineDuration when regions have room for the run', () => {
    // Two activity regions separated by an instrumental gap: region0=[16,20]
    // (4s) and region1=[36,56] (20s), total capacity 24s. A three-line run
    // with expected shares ~[0.8, 4.4, 12] (total 17.2) fits comfortably. The
    // middle line's weighted share is larger than the room left in region0
    // after the first line, so it crosses the region boundary. It must not be
    // clamped to a sub-minLineDuration sliver at the region edge — the unspent
    // budget has to carry forward, not evaporate.
    const before = 'the quick brown fox jumps over the lazy dog again'
    const after = 'every good boy deserves fudge and cake at the party'
    const region0 = 'alpha bravo charlie delta echo foxtrot golf hotel'
    const region1 =
      'india juliet kilo lima mike november oscar papa quebec romeo sierra ' +
      'tango uniform victor whiskey xray yankee zulu oneword twoword threeword ' +
      'fourword fiveword sixword'
    const words = [
      ...anchorWords(before, 10, 14),
      ...anchorWords(region0, 16, 20),
      ...anchorWords(region1, 36, 56),
      ...anchorWords(after, 58, 62),
    ]
    const l1 = 'aa bb cc dd ee ff gg'
    const l2 = 'mmnn oopp qqrr sstt uuvv wwxx yyzz aabb ccdd eeff gghh'
    const l3 = 'pp '.repeat(40).trim()
    const lines = [
      line(before, 10, 14),
      line(l1, 14, 14.2),
      line(l2, 14.2, 14.4),
      line(l3, 14.4, 14.6),
      line(after, 58, 62),
    ]
    const res = redistributeDegenerateRuns(lines, words, 'ja')
    // The anchors are untouched; the three middle lines are redistributed.
    expect(res.redistributed).toEqual([false, true, true, true, false])
    // Capacity (24s) >= total expected (~17.2s): no redistributed line may be
    // squeezed below its own minLineDuration.
    for (let i = 1; i <= 3; i++) {
      const dur = res.lines[i].endTime - res.lines[i].startTime
      expect(dur, `line ${i} "${res.lines[i].original.slice(0, 12)}" duration`).toBeGreaterThanOrEqual(
        minLineDuration(res.lines[i].original),
      )
    }
    // Monotonic and none straddles the gap (each stays inside one region).
    for (let i = 2; i <= 3; i++) {
      expect(res.lines[i].startTime).toBeGreaterThanOrEqual(res.lines[i - 1].startTime)
    }
  })

  it('returns input untouched when the transcript is empty', () => {
    const lines = [line('abc', 0, 0), line('def', 0, 0)]
    const res = redistributeDegenerateRuns(lines, [], 'ja')
    expect(res.lines).toEqual(lines)
    expect(res.redistributed).toEqual([false, false])
  })
})
