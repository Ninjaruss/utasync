import { describe, it, expect } from 'vitest'
import { redistributeDegenerateRuns } from '../../src/lyrics/redistributeDegenerateRuns'
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

  it('returns input untouched when the transcript is empty', () => {
    const lines = [line('abc', 0, 0), line('def', 0, 0)]
    const res = redistributeDegenerateRuns(lines, [], 'ja')
    expect(res.lines).toEqual(lines)
    expect(res.redistributed).toEqual([false, false])
  })
})
