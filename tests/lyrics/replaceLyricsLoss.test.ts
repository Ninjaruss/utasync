import { describe, it, expect } from 'vitest'
import { describeReplaceLoss } from '../../src/lyrics/replaceLyricsLoss'
import type { TimedLine } from '../../src/core/types'

const timed = (n: number): TimedLine[] =>
  Array.from({ length: n }, (_, i) => ({ startTime: i * 3, endTime: i * 3 + 2, original: `line ${i}`, translation: '' }))

const untimed = (n: number): TimedLine[] =>
  Array.from({ length: n }, (_, i) => ({ startTime: 0, endTime: 0, original: `line ${i}`, translation: '' }))

const withTranslations = (lines: TimedLine[]): TimedLine[] =>
  lines.map((l, i) => ({ ...l, translation: `translation ${i}` }))

describe('describeReplaceLoss', () => {
  it('says nothing when there is nothing to lose', () => {
    expect(describeReplaceLoss(untimed(3), untimed(3))).toBeNull()
  })

  it('warns when timing would be dropped, and counts the lines', () => {
    const msg = describeReplaceLoss(timed(12), untimed(12))
    expect(msg).toMatch(/timing for 12 lines/i)
    expect(msg).toMatch(/can'?t be undone/i)
  })

  it('warns when an attached translation would be dropped', () => {
    const msg = describeReplaceLoss(withTranslations(untimed(5)), untimed(5))
    expect(msg).toMatch(/translation/i)
  })

  it('names both losses in one sentence rather than stacking warnings', () => {
    const msg = describeReplaceLoss(withTranslations(timed(8)), untimed(8))
    expect(msg).toMatch(/timing for 8 lines/i)
    expect(msg).toMatch(/translation/i)
  })

  // Importing an LRC brings its own timing, so nothing is lost.
  it('stays quiet when the incoming lyrics carry their own timing', () => {
    expect(describeReplaceLoss(timed(6), timed(6))).toBeNull()
  })

  it('stays quiet when the incoming lyrics carry their own translation', () => {
    expect(describeReplaceLoss(withTranslations(untimed(4)), withTranslations(untimed(4)))).toBeNull()
  })

  it('counts only lines that actually carry timing', () => {
    const partly = [...timed(3), ...untimed(5)]
    expect(describeReplaceLoss(partly, untimed(8))).toMatch(/timing for 3 lines/i)
  })

  it('uses the singular for a single timed line', () => {
    expect(describeReplaceLoss(timed(1), untimed(1))).toMatch(/timing for 1 line\b/i)
  })

  it('ignores whitespace-only translations', () => {
    const blank = untimed(3).map((l) => ({ ...l, translation: '   ' }))
    expect(describeReplaceLoss(blank, untimed(3))).toBeNull()
  })
})
