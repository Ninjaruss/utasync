import { describe, it, expect } from 'vitest'
import { alignByContent } from '../../src/ai-pipeline/contentAligner'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

/**
 * Regression: a line whose drawn-out tail is mistranscribed but whose FINAL mora
 * coincidentally LCS-matches must still claim the orphan gap up to the next
 * anchored line — instead of ending early at its reliable-run end.
 *
 * Mirrors the real AKFG "遠く向こうの角を曲がって｜此処からは…" merged segment:
 * Whisper rendered the tail まがって as まげて, so the reliable run stops at ま
 * while the final て isolated-matches, zeroing unmatchedTail and (before the fix)
 * defeating the orphan-gap fill, leaving the line ending ~2.7s early.
 */
describe('orphan-gap tail fill', () => {
  it('extends a line whose tail mismatched but final mora coincidentally matched', () => {
    const lineA = 'とおくのかどをまがって'
    const lineB = 'ここからみえない'
    // One merged segment: lineA tail rendered "まげて" (reliable run ends at ま,
    // final て isolated-matches), then lineB transcribed cleanly.
    const words: TranscriptWord[] = [
      { word: 'とおくのかどをまげてここからみえない', startTime: 10, endTime: 26 },
    ]

    const { lines } = alignByContent([lineA, lineB], words, undefined, 'ja')

    const gap = lines[1].startTime - lines[0].endTime
    // Line A should hand off to line B with no dead air — its melisma fills the gap.
    expect(gap).toBeLessThan(0.5)
    expect(lines[0].endTime).toBeGreaterThan(lines[0].startTime + 5)
  })
})
