import { describe, it, expect } from 'vitest'
import {
  lineEffectiveEnd,
  lineIndexAtPlayhead,
  lineOverlapsABLoop,
  linePlaybackStart,
  lineHasTiming,
  VOCAL_ONSET_LEAD_S,
} from '../../src/lyrics/lineTiming'
import type { TimedLine } from '../../src/core/types'

/** `{0, 0}` is not a coincidence — it is the app's own marker for "no timing known": what
 *  songBuilder leaves after a fresh lyrics import, and what TapSyncEditor stores for every line
 *  the user did not tap. */
const untimed = (original: string): TimedLine => ({ startTime: 0, endTime: 0, original, translation: '' })

const lines: TimedLine[] = [
  { startTime: 0, endTime: 2, original: 'a', translation: '' },
  { startTime: 2, endTime: 5, original: 'b', translation: '' },
  { startTime: 5, endTime: 8, original: 'c', translation: '' },
]

describe('lineTiming', () => {
  it('finds the row containing the playhead', () => {
    expect(lineIndexAtPlayhead(lines, 1)).toBe(0)
    expect(lineIndexAtPlayhead(lines, 2)).toBe(1)
    expect(lineIndexAtPlayhead(lines, 4.5)).toBe(1)
    expect(lineIndexAtPlayhead(lines, 9)).toBe(-1)
  })

  it('detects lines overlapping an A-B window', () => {
    expect(lineOverlapsABLoop(lines[0], 0, lines, 0, 2)).toBe(true)
    expect(lineOverlapsABLoop(lines[1], 1, lines, 1, 6)).toBe(true)
    expect(lineOverlapsABLoop(lines[2], 2, lines, 0, 2)).toBe(false)
  })

  it('highlights a line slightly before its stored start', () => {
    const timed: TimedLine[] = [{ startTime: 10, endTime: 15, original: 'a', translation: '' }]
    expect(lineIndexAtPlayhead(timed, 10 - VOCAL_ONSET_LEAD_S + 0.01)).toBe(0)
    expect(lineIndexAtPlayhead(timed, 10 - VOCAL_ONSET_LEAD_S - 0.01)).toBe(-1)
  })

  it('seeks slightly before the stored line start', () => {
    expect(linePlaybackStart({ startTime: 10, endTime: 15, original: 'a', translation: '' }))
      .toBeCloseTo(10 - VOCAL_ONSET_LEAD_S)
  })

  /* A real-browser check found this on 2026-09-30: an untimed song highlighted the LAST line for
   * the whole song (86/86 samples of real playback, row 46 of 47). The cause was `lineEffectiveEnd`
   * inventing a span for a line that has no timing — for the last such line, [0, Infinity). These
   * specs are the guard for that; each one FAILS on the old rule. */
  describe('a line with no timing never owns a moment of the song', () => {
    it('an all-untimed song highlights nothing at any playhead', () => {
      const allUntimed = [untimed('a'), untimed('b'), untimed('c')]
      for (const t of [0, 0.5, 30, 120, 600]) {
        expect(lineIndexAtPlayhead(allUntimed, t)).toBe(-1)
      }
    })

    it('a trailing untimed run does not extend the last timed line, and owns nothing after it', () => {
      const mixed: TimedLine[] = [
        { startTime: 10, endTime: 20, original: 'a', translation: '' },
        untimed('b'),
        untimed('c'),
      ]
      // Inside the timed line, unchanged.
      expect(lineIndexAtPlayhead(mixed, 15)).toBe(0)
      // The gap after it belongs to nobody — before the fix, the LAST untimed row claimed it.
      expect(lineIndexAtPlayhead(mixed, 25)).toBe(-1)
      expect(lineIndexAtPlayhead(mixed, 200)).toBe(-1)
      expect(lineIndexAtPlayhead(mixed, 1)).toBe(-1)
    })

    it('an untimed run between tapped lines does not claim the gap', () => {
      const tapped: TimedLine[] = [
        { startTime: 10, endTime: 20, original: 'a', translation: '' },
        untimed('b'),
        { startTime: 30, endTime: 40, original: 'c', translation: '' },
      ]
      expect(lineIndexAtPlayhead(tapped, 15)).toBe(0)
      expect(lineIndexAtPlayhead(tapped, 25)).toBe(-1)
      expect(lineIndexAtPlayhead(tapped, 35)).toBe(2)
      expect(lineOverlapsABLoop(tapped[1], 1, tapped, 0, 60)).toBe(false)
    })

    it('leaves a timed first line that starts at exactly 0 alone', () => {
      const startsAtZero: TimedLine[] = [
        { startTime: 0, endTime: 6, original: 'a', translation: '' },
        untimed('b'),
      ]
      expect(lineHasTiming(startsAtZero[0])).toBe(true)
      expect(lineIndexAtPlayhead(startsAtZero, 0)).toBe(0)
      expect(lineIndexAtPlayhead(startsAtZero, 3)).toBe(0)
      expect(lineIndexAtPlayhead(startsAtZero, 30)).toBe(-1)
    })

    it('keeps the next-start fallback for a line that has a start but no end', () => {
      const noEnd: TimedLine[] = [
        { startTime: 10, endTime: 0, original: 'a', translation: '' },
        { startTime: 30, endTime: 40, original: 'b', translation: '' },
      ]
      expect(lineHasTiming(noEnd[0])).toBe(true)
      expect(lineEffectiveEnd(noEnd[0], 0, noEnd)).toBe(30)
      expect(lineIndexAtPlayhead(noEnd, 20)).toBe(0)
    })
  })
})
