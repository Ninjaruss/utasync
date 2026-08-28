import { describe, it, expect } from 'vitest'
import { scoreLinePairing, mapRowsToOriginals } from '../../scripts/lib/linePairingScore.mjs'

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

  it('counts a lost occurrence of a REPEATED line', () => {
    // Same text as two separate input lines; the fitter placed only one.
    const m = scoreLinePairing(
      [['refrain'], ['verse'], ['refrain']],
      [['refrain'], ['verse'], []],
      ['refrain', 'verse', 'refrain'],
      [false, false, false],
    )
    expect(m.lines_lost).toBe(1)
  })

  it('does not count a shared (merged) line as lost', () => {
    // ONE input line legitimately covering two rows — output repeats it, input had it once.
    const m = scoreLinePairing(
      [['both'], ['both']], [['both'], ['both']], ['both'], [false, false],
    )
    expect(m.lines_lost).toBe(0)
  })

  it('counts every lost occurrence when a line repeats three times', () => {
    const m = scoreLinePairing(
      [['x'], ['x'], ['x']], [['x'], [], []], ['x', 'x', 'x'], [false, false, false],
    )
    expect(m.lines_lost).toBe(2)
  })
})

describe('mapRowsToOriginals', () => {
  const row = (original: string, translation: string, translationConfidence?: number) =>
    ({ startTime: 0, endTime: 1, original, translation, translationConfidence })

  it('maps rows to originals positionally', () => {
    const { assigned } = mapRowsToOriginals(['a', 'b'], [row('a', 'x'), row('b', 'y')])
    expect(assigned).toEqual([['x'], ['y']])
  })

  it('distinguishes two non-adjacent originals with identical text', () => {
    const { assigned } = mapRowsToOriginals(
      ['same', 'other', 'same'],
      [row('same', 'first'), row('other', 'mid'), row('same', 'third')],
    )
    expect(assigned).toEqual([['first'], ['mid'], ['third']])
  })

  it('skips rows with an empty original', () => {
    const { assigned } = mapRowsToOriginals(['a', 'b'], [row('a', 'x'), row('', 'orphan'), row('b', 'y')])
    expect(assigned).toEqual([['x'], ['y']])
  })

  it('ignores a row matching no original without losing the cursor', () => {
    const { assigned } = mapRowsToOriginals(
      ['a', 'b'], [row('a', 'x'), row('ghost', 'no'), row('b', 'y')],
    )
    expect(assigned).toEqual([['x'], ['y']])
  })

  it('splits a multi-line translation into its parts', () => {
    const { assigned } = mapRowsToOriginals(['a'], [row('a', 'one\ntwo')])
    expect(assigned).toEqual([['one', 'two']])
  })

  it('flags a row below the confidence threshold', () => {
    const { flagged } = mapRowsToOriginals(['a', 'b'], [row('a', 'x', 0.2), row('b', 'y', 0.9)])
    expect(flagged).toEqual([true, false])
  })
})
