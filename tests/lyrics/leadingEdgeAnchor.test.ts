import { describe, it, expect } from 'vitest'
import { anchorLeadingEdge, snapLeadingVerseToOnset } from '../../src/lyrics/leadingEdgeAnchor'
import type { TimedLine } from '../../src/core/types'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})

describe('anchorLeadingEdge', () => {
  it('re-spreads a crammed opening forward to the vocal onset', () => {
    const lines = [
      line('a', 0, 1),
      line('b', 1, 2),
      line('c', 2, 3),
      line('d', 3, 4),
      line('e', 20, 21),
      line('f', 22, 23),
    ]
    const out = anchorLeadingEdge(lines, 15, 'en')
    expect(out[0].startTime).toBeGreaterThanOrEqual(14.9)
    expect(out[0].startTime).toBeLessThanOrEqual(15.1)
    expect(out[4].startTime).toBe(20)
    expect(out[5].startTime).toBe(22)
    expect(out[3].startTime).toBeLessThan(20)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    }
  })

  it('is a no-op when the opening is not crammed before the onset', () => {
    const lines = [line('a', 16, 17), line('b', 18, 19), line('c', 20, 21)]
    const out = anchorLeadingEdge(lines, 15, 'en')
    expect(out[0].startTime).toBe(16)
  })

  it('is a no-op when no line is placed at/after the onset', () => {
    const lines = [line('a', 0, 1), line('b', 1, 2), line('c', 2, 3)]
    const out = anchorLeadingEdge(lines, 15, 'en')
    expect(out[0].startTime).toBe(0)
  })

  const span = (matchedChars: number, totalChars: number, firstTime: number, lastEndTime: number) => ({
    matchedChars,
    totalChars,
    firstTime,
    lastEndTime,
  })

  it('re-spreads a late-shifted opening back to the vocal onset (bidirectional)', () => {
    // First 4 lines are interpolated 12s late (no content match); line 4 is the
    // first content-anchored line at 25s. Onset detected at 2.2s.
    const lines = [
      line('tag', 14.8, 15.8),
      line('verse1', 16, 17),
      line('verse2', 18, 19),
      line('verse3', 20, 21),
      line('chorus', 25, 27),
      line('chorus2', 28, 30),
    ]
    const spans = [
      span(0, 3, 0, 0),
      span(0, 6, 0, 0),
      span(0, 6, 0, 0),
      span(0, 6, 0, 0),
      span(6, 6, 25, 27),
      span(6, 6, 28, 30),
    ]
    const out = anchorLeadingEdge(lines, 2.2, 'en', { spans })
    expect(out[0].startTime).toBeGreaterThanOrEqual(2.1)
    expect(out[0].startTime).toBeLessThanOrEqual(2.4)
    expect(out[4].startTime).toBe(25) // trusted line untouched
    expect(out[3].startTime).toBeGreaterThan(2.2)
    expect(out[3].startTime).toBeLessThan(25)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    }
  })

  it('does not pull back a genuinely-late first line that has a content match', () => {
    const lines = [line('real', 14.8, 16), line('b', 18, 19)]
    const spans = [span(4, 4, 14.8, 16), span(1, 1, 18, 19)]
    const out = anchorLeadingEdge(lines, 2.2, 'en', { spans })
    expect(out[0].startTime).toBe(14.8)
  })

  it('late-shift case is a no-op without spans (cannot tell displaced from genuinely late)', () => {
    const lines = [line('a', 14.8, 16), line('b', 18, 19), line('c', 25, 27)]
    const out = anchorLeadingEdge(lines, 2.2, 'en')
    expect(out[0].startTime).toBe(14.8)
  })

  it('snapLeadingVerseToOnset: pulls a late first verse line back to the post-intro onset', () => {
    // Opening sings early (untouched by this pass), instrumental, then the verse
    // enters at onset=23 but Whisper placed its first line ~6s late at 29.
    const lines = [
      line('opening', 0.5, 6),
      line('verse0', 29, 31.8),
      line('verse1', 31.8, 34),
      line('verse2', 34, 37), // correctly placed — the bound
    ]
    const spans = [span(6, 6, 0.5, 6), span(4, 6, 29, 31.8), span(4, 6, 31.8, 34), span(6, 6, 34, 37)]
    const out = snapLeadingVerseToOnset(lines, 23, 'ja', { spans })
    expect(out[0].startTime).toBe(0.5) // opening untouched
    expect(out[1].startTime).toBeCloseTo(23, 1) // late verse entry snapped to the onset
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    }
  })

  it('snapLeadingVerseToOnset: no-op when the gap to the onset exceeds maxGap', () => {
    // A 12s gap is too large to trust the onset for this line (could be a genuinely
    // late-entering verse, not a mis-timed one).
    const lines = [line('opening', 0.5, 6), line('verse', 35, 38), line('verse2', 38, 41)]
    const spans = [span(6, 6, 0.5, 6), span(4, 6, 35, 38), span(6, 6, 38, 41)]
    const out = snapLeadingVerseToOnset(lines, 23, 'ja', { spans })
    expect(out[1].startTime).toBe(35)
  })

  it('snapLeadingVerseToOnset: no-op when the first post-onset line is not content-matched', () => {
    // An interpolated (uncovered) line carries no evidence it belongs at the onset.
    const lines = [line('opening', 0.5, 6), line('interp', 29, 31), line('real', 31, 34)]
    const spans = [span(6, 6, 0.5, 6), span(0, 6, 0, 0), span(4, 6, 31, 34)]
    const out = snapLeadingVerseToOnset(lines, 23, 'ja', { spans })
    // 'real' (firstIdx) is 8s past the onset → beyond maxGap → nothing moves.
    expect(out[1].startTime).toBe(29)
    expect(out[2].startTime).toBe(31)
  })

  it('does not re-spread a content-matched early opening onto a later re-entry onset', () => {
    // Real case ("Going My Way"): the song starts singing at ~0.5s (line 0 has a
    // strong content match there), breaks to an instrumental, then the verse
    // enters at ~23s. firstVocalOnset reports the *verse* entry as the onset, but
    // the opening is genuine early vocals — NOT an interpolated intro-cram — so it
    // must be left where its content match placed it, not yanked forward onto 23s.
    // Symmetric to the displacement>0 content-trust guard above.
    const lines = [line('opening', 0.5, 6), line('bridge', 6.7, 10), line('verse', 29, 31)]
    const spans = [span(6, 6, 0.5, 6), span(1, 6, 6.7, 10), span(6, 6, 29, 31)]
    const out = anchorLeadingEdge(lines, 23.15, 'ja', { spans })
    expect(out[0].startTime).toBeCloseTo(0.5)
    expect(out[1].startTime).toBeCloseTo(6.7)
  })
})
