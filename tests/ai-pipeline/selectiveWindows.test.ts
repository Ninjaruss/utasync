import { describe, expect, it } from 'vitest'
// @ts-expect-error mjs module without types
import { buildSelectiveWindows } from '../../scripts/lib/selectiveWindows.mjs'

const base = (starts: number[]) => starts.map((s) => ({ startTime: s }))

describe('buildSelectiveWindows', () => {
  it('creates one closed window per anchor gap containing untrusted lines', () => {
    const wins = buildSelectiveWindows({
      lines: base([1, 5, 9, 20, 24, 30]),
      tokensPerLine: [10, 10, 10, 10, 10, 10],
      anchorIdx: [0, 3, 5],
      durationSec: 40,
      padSec: 1,
    })
    // gap (0,3): interior 1,2; t0=max(0,1-1)=0, t1=20+1=21; 20 toks / 21s ok
    // gap (3,5): interior 4; t0=20-1=19, t1=30+1=31; 10 toks / 12s ok
    // gap (5,edge): interior none
    // head gap (-1,0): interior none
    expect(wins).toHaveLength(2)
    expect(wins[0]).toMatchObject({ lineIdx: [1, 2], t0: 0, t1: 21 })
    expect(wins[1]).toMatchObject({ lineIdx: [4], t0: 19, t1: 31 })
  })

  it('closes head and tail windows at 0 and duration', () => {
    const wins = buildSelectiveWindows({
      lines: base([5, 10, 15]),
      tokensPerLine: [8, 8, 8],
      anchorIdx: [1],
      durationSec: 35,
      padSec: 0,
    })
    // head (-1@0, 1@10): interior line 0 -> t0=0, t1=10; 8 toks/10s ok (10/8 < 4)
    // tail (1@10, edge@35): interior line 2 -> t0=10, t1=35; span 25, 8 toks -> 25/8=3.125 s/tok ok
    expect(wins).toHaveLength(2)
    expect(wins[0]).toMatchObject({ lineIdx: [0], t0: 0, t1: 10 })
    expect(wins[1]).toMatchObject({ lineIdx: [2], t0: 10, t1: 35 })
  })

  it('skips a window that is too dense (cram risk)', () => {
    const wins = buildSelectiveWindows({
      lines: base([1, 2, 3]),
      tokensPerLine: [0, 100, 0],
      anchorIdx: [0, 2],
      durationSec: 10,
      padSec: 0,
    })
    // gap (0,2): interior line 1; t0=1, t1=2, span=2s; 100 toks -> 50 tok/s > 12 -> skip
    expect(wins).toHaveLength(0)
  })

  it('skips a window that is too sparse (smear risk)', () => {
    const wins = buildSelectiveWindows({
      lines: base([1, 2, 100]),
      tokensPerLine: [10, 3, 10],
      anchorIdx: [0, 2],
      durationSec: 120,
      padSec: 0,
    })
    // gap (0,2): interior line 1; t0=1, t1=100, span=99s; 3 toks -> 33 s/tok > 4 -> skip
    expect(wins).toHaveLength(0)
  })

  it('produces no window when a gap has no interior lines', () => {
    const wins = buildSelectiveWindows({
      lines: base([1, 2]),
      tokensPerLine: [5, 5],
      anchorIdx: [0, 1],
      durationSec: 10,
      padSec: 1,
    })
    expect(wins).toHaveLength(0)
  })

  it('handles a single anchor with a tail window to the song edge', () => {
    const wins = buildSelectiveWindows({
      lines: base([1, 2]),
      tokensPerLine: [5, 5],
      anchorIdx: [0],
      durationSec: 10,
      padSec: 1,
    })
    // tail gap (0@1, edge@10): interior line 1; t0=max(0,1-1)=0, t1=min(10,10+1)=10
    // span=10, 5 toks -> 2 s/tok ok, 0.5 tok/s ok
    expect(wins).toHaveLength(1)
    expect(wins[0]).toMatchObject({ lineIdx: [1], t0: 0, t1: 10 })
  })

  it('sorts unsorted anchorIdx input before processing', () => {
    const wins = buildSelectiveWindows({
      lines: base([1, 5, 9, 20, 24, 30]),
      tokensPerLine: [10, 10, 10, 10, 10, 10],
      anchorIdx: [3, 0, 5],
      durationSec: 40,
      padSec: 1,
    })
    expect(wins).toHaveLength(2)
    expect(wins[0]).toMatchObject({ lineIdx: [1, 2], t0: 0, t1: 21 })
    expect(wins[1]).toMatchObject({ lineIdx: [4], t0: 19, t1: 31 })
  })

  it('excludes zero-token lines from lineIdx and the density calculation', () => {
    const wins = buildSelectiveWindows({
      lines: base([1, 2, 3, 4]),
      tokensPerLine: [10, 0, 10, 0],
      anchorIdx: [0, 3],
      durationSec: 10,
      padSec: 0,
    })
    // gap (0,3): interior 1,2; line 1 has 0 tokens (excluded); line 2 has 10 tokens
    // t0=1, t1=4, span=3; 10 toks -> 3.33 tok/s ok, 0.3 s/tok ok
    expect(wins).toHaveLength(1)
    expect(wins[0]).toMatchObject({ lineIdx: [2], t0: 1, t1: 4 })
  })

  it('throws on a non-finite padSec instead of silently emitting NaN windows', () => {
    expect(() =>
      buildSelectiveWindows({
        lines: base([1, 2]),
        tokensPerLine: [5, 5],
        anchorIdx: [0],
        durationSec: 10,
        padSec: undefined,
      })
    ).toThrow(/padSec/)
  })

  it('throws on an out-of-range anchor index', () => {
    expect(() =>
      buildSelectiveWindows({
        lines: base([1, 2]),
        tokensPerLine: [5, 5],
        anchorIdx: [5],
        durationSec: 10,
        padSec: 1,
      })
    ).toThrow(/out of range/)
  })
})
