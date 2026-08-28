import { describe, it, expect } from 'vitest'
import { scoreLinePairing } from '../../scripts/lib/linePairingScore.mjs'

describe('scoreLinePairing', () => {
  it('counts an exact match as correct', () => {
    const m = scoreLinePairing([['a'], ['b']], [['a'], ['b']], ['a', 'b'], [false, false])
    expect(m.line_correct).toBe(2)
    expect(m.line_wrong).toBe(0)
    expect(m.line_missing).toBe(0)
    expect(m.lines_lost).toBe(0)
  })

  it('counts a non-empty wrong assignment as wrong, not missing', () => {
    const m = scoreLinePairing([['a'], ['b']], [['b'], ['a']], ['a', 'b'], [false, false])
    expect(m.line_wrong).toBe(2)
    expect(m.line_missing).toBe(0)
  })

  it('counts an empty assignment against non-empty truth as missing', () => {
    const m = scoreLinePairing([['a'], ['b']], [['a'], []], ['a', 'b'], [false, false])
    expect(m.line_correct).toBe(1)
    expect(m.line_missing).toBe(1)
  })

  it('an original with no truth and no assignment is correct', () => {
    const m = scoreLinePairing([['a'], []], [['a'], []], ['a'], [false, false])
    expect(m.line_correct).toBe(2)
  })

  it('counts input lines appearing nowhere in the output as lost', () => {
    const m = scoreLinePairing([['a'], ['b']], [['a'], []], ['a', 'b'], [false, false])
    expect(m.lines_lost).toBe(1)
  })

  it('a noise line that is correctly placed nowhere is not lost', () => {
    // '[Chorus]' belongs to no original; the fitter dropped it. That is correct,
    // so it must not count as lost — only lines with truth can be lost.
    const m = scoreLinePairing([['a']], [['a']], ['a', '[Chorus]'], [false])
    expect(m.lines_lost).toBe(0)
  })

  it('scores flag precision and recall against actual wrongness', () => {
    // row 0 correct+unflagged, row 1 wrong+flagged, row 2 wrong+unflagged
    const m = scoreLinePairing(
      [['a'], ['b'], ['c']],
      [['a'], ['x'], ['y']],
      ['a', 'b', 'c'],
      [false, true, false],
    )
    expect(m.flag_precision).toBe(1)    // 1 flagged, 1 of them wrong
    expect(m.flag_recall).toBeCloseTo(0.5) // 2 wrong, 1 caught
  })

  it('reports precision and recall as null when there is nothing to score', () => {
    const m = scoreLinePairing([['a']], [['a']], ['a'], [false])
    expect(m.flag_precision).toBeNull()  // nothing flagged
    expect(m.flag_recall).toBeNull()     // nothing wrong
  })
})
