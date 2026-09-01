import { describe, it, expect } from 'vitest'
import { chooseAutoAlignment } from '../../src/player/alignmentPolicy'
import type { TimedLine } from '../../src/core/types'

const timed: TimedLine[] = [
  { startTime: 6.5, endTime: 9.1, original: 'a', translation: '' },
  { startTime: 9.4, endTime: 12.0, original: 'b', translation: '' },
]
/** Plain (unsynced) lyrics are stored all-zero by linesFromPlainText. */
const untimed: TimedLine[] = [
  { startTime: 0, endTime: 0, original: 'a', translation: '' },
  { startTime: 0, endTime: 0, original: 'b', translation: '' },
]

/**
 * A found LRCLIB entry describes the local recording to within a median 0.24-0.73s
 * once ONE constant offset is removed (tests/ai-pipeline/lrc-truth.test.ts) — it is
 * the same master, shifted. So a song that already has timed lines does not need a
 * full transcription to be usable; it needs that one constant, which the user can
 * supply by dragging.
 */
describe('chooseAutoAlignment — offset fast path', () => {
  it('offers the drag when a song has audio AND already-timed lines', () => {
    expect(chooseAutoAlignment(true, timed, 'full', true, 'manual')).toBe('offset')
  })

  it('still transcribes when the lyrics carry no timings', () => {
    // Plain-text lyrics have nothing to shift, so the offset path must not fire.
    expect(chooseAutoAlignment(true, untimed, 'full', true, 'manual')).toBe('auto')
  })

  it('does not re-prompt a song that has already been aligned', () => {
    expect(chooseAutoAlignment(true, timed, 'full', true, 'auto')).toBeNull()
  })

  it('leaves the no-audio paths alone', () => {
    expect(chooseAutoAlignment(false, timed, 'full', true, 'manual')).toBeNull()
    expect(chooseAutoAlignment(false, untimed, 'full', true, 'manual')).toBe('tap')
  })

  it('offers the drag even on a manual-tier device, since it needs no model', () => {
    expect(chooseAutoAlignment(true, timed, 'manual', true, 'manual')).toBe('offset')
  })
})
