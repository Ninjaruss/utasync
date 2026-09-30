import { describe, it, expect } from 'vitest'
import { applyRefinedAlignment } from '../../src/lyrics/phraseAlignment'
import type { LyricsData, TimedLine, TimingAnchor } from '../../src/core/types'

/**
 * A user's timing correction must SURVIVE a refine pass.
 *
 * `src/core/types/index.ts` has always documented `timingAnchors` as pins that "survive
 * re-align" and nothing implemented it: `applyRefinedAlignment` spread the array forward but
 * replaced `lines` wholesale, so a drag-to-retime commit was silently discarded by the next
 * refine. Three paths funnel through this function — the fresh auto-align, the version-gated
 * re-refine that runs on EVERY song open, and gap recovery on open — which meant a user could
 * fix a line and lose it by simply reopening the song and never be told.
 *
 * These specs pin the contract at the funnel, which is the only place it can be enforced
 * once for all three callers.
 */

const line = (original: string, startTime: number, endTime = startTime + 2): TimedLine => ({
  original, translation: '', startTime, endTime,
})

function lyricsWith(anchors: TimingAnchor[] | undefined): LyricsData {
  return {
    lines: [line('a', 10), line('b', 20), line('c', 30)],
    sourceLanguage: 'ja',
    translationLanguage: 'en',
    timingAnchors: anchors,
  }
}

/** A refine result that has moved every line somewhere else, as a pass would. */
function refinedElsewhere() {
  return {
    lines: [line('a', 11), line('b', 21), line('c', 31)],
    phrases: [],
    report: { merged: 0, split: 0 },
    mode: 'content' as const,
    confidence: 0.9,
    lineAlignmentQuality: ['good', 'good', 'good'] as const,
    phraseLayout: 'sheet' as const,
  }
}

describe('applyRefinedAlignment keeps user timing anchors', () => {
  it('keeps the anchored line where the user put it', () => {
    // The user dragged line 1 onto 15.0s. The pass wants 21s. The user wins.
    const out = applyRefinedAlignment(lyricsWith([{ lineIndex: 1, time: 15, source: 'user' }]), refinedElsewhere())
    expect(out.lines[1].startTime).toBe(15)
  })

  it('still lets the pass move the lines the user did NOT pin', () => {
    const out = applyRefinedAlignment(lyricsWith([{ lineIndex: 1, time: 15, source: 'user' }]), refinedElsewhere())
    expect(out.lines[0].startTime).toBe(11)
    expect(out.lines[2].startTime).toBe(31)
  })

  it('keeps the anchors themselves on the lyrics', () => {
    const anchors: TimingAnchor[] = [{ lineIndex: 2, time: 33, source: 'user' }]
    const out = applyRefinedAlignment(lyricsWith(anchors), refinedElsewhere())
    expect(out.timingAnchors).toEqual(anchors)
    expect(out.lines[2].startTime).toBe(33)
  })

  it('is a no-op with no anchors (every pre-existing path is unchanged)', () => {
    const out = applyRefinedAlignment(lyricsWith(undefined), refinedElsewhere())
    expect(out.lines.map((l) => l.startTime)).toEqual([11, 21, 31])
  })

  it('ignores STALE anchors whose indices no longer exist', () => {
    // Rows were removed or replaced under the pins. A pin that names the wrong line is worse
    // than no pin, so a stale set is dropped wholesale rather than partially applied.
    const out = applyRefinedAlignment(lyricsWith([{ lineIndex: 9, time: 99, source: 'user' }]), refinedElsewhere())
    expect(out.lines.map((l) => l.startTime)).toEqual([11, 21, 31])
  })

  it('ignores a non-integer or negative index', () => {
    const out = applyRefinedAlignment(
      lyricsWith([{ lineIndex: -1, time: 5, source: 'user' }, { lineIndex: 1.5, time: 5, source: 'user' }]),
      refinedElsewhere(),
    )
    expect(out.lines.map((l) => l.startTime)).toEqual([11, 21, 31])
  })

  it('leaves the timeline monotonic even when a pin contradicts the pass', () => {
    // Pinning line 2 EARLY would cross line 1; the refit must clamp rather than emit a
    // backwards timeline the player would render as a scrambled highlight.
    const out = applyRefinedAlignment(lyricsWith([{ lineIndex: 2, time: 12, source: 'user' }]), refinedElsewhere())
    for (let i = 1; i < out.lines.length; i++) {
      expect(out.lines[i].startTime, `line ${i}`).toBeGreaterThanOrEqual(out.lines[i - 1].startTime)
    }
  })
})
