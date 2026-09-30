import { describe, it, expect } from 'vitest'
import { refitAroundAnchors, selectAnchorTargets, type TimingAnchor } from '../../src/lyrics/anchorRefit'
import type { TimedLine } from '../../src/core/types'

const line = (original: string, startTime: number, endTime = startTime + 2): TimedLine => ({
  original,
  translation: '',
  startTime,
  endTime,
})
const anc = (lineIndex: number, time: number): TimingAnchor => ({ lineIndex, time, source: 'user' })

describe('refitAroundAnchors', () => {
  it('no anchors → input cloned unchanged', () => {
    const lines = [line('a', 1), line('b', 3)]
    const out = refitAroundAnchors(lines, undefined, 'ja')
    expect(out.map((l) => l.startTime)).toEqual([1, 3])
    expect(out).not.toBe(lines)
  })

  it('pins an isolated late line WITHOUT moving its correct neighbours', () => {
    // C is 3s late (true 5s). Pinning it must fix ONLY C — the parked engine would
    // translate A/B by C's delta and wreck them.
    const lines = [line('A', 1), line('B', 2), line('C', 8), line('D', 9)]
    const out = refitAroundAnchors(lines, [anc(2, 5)], 'ja')
    expect(out.map((l) => l.startTime)).toEqual([1, 2, 5, 9])
  })

  it('never translates lines outside the anchored span', () => {
    const lines = [line('A', 1), line('B', 2), line('C', 10), line('D', 20), line('E', 30)]
    const out = refitAroundAnchors(lines, [anc(2, 7)], 'ja') // anchor a middle line
    expect(out[0].startTime).toBe(1) // before — untouched
    expect(out[1].startTime).toBe(2)
    expect(out[2].startTime).toBe(7) // pinned
    expect(out[3].startTime).toBe(20) // after — untouched
    expect(out[4].startTime).toBe(30)
  })

  it('leaves confident lines between two anchors alone', () => {
    const lines = [line('A', 1), line('B', 5), line('C', 9)]
    const q = ['good', 'good', 'good'] as const
    const out = refitAroundAnchors(lines, [anc(0, 2), anc(2, 10)], 'ja', { quality: [...q] })
    expect(out[1].startTime).toBe(5) // confident interior line kept, not re-spread
    expect(out[0].startTime).toBe(2)
    expect(out[2].startTime).toBe(10)
  })

  it('reflows a genuinely un-timed span between two anchors, preserving relative position', () => {
    // B/C are needs_review holes between anchors at A(2s) and D(20s). They should be
    // warped into the span, keeping their relative spacing.
    const lines = [line('A', 1), line('B', 3), line('C', 7), line('D', 9)]
    const out = refitAroundAnchors(lines, [anc(0, 2), anc(3, 20)], 'ja', {
      quality: ['good', 'needs_review', 'needs_review', 'good'],
    })
    expect(out[0].startTime).toBe(2)
    expect(out[3].startTime).toBe(20)
    // B was 25% of the way from A(1) to D(9) → 2 + 0.25*18 = 6.5; C was 75% → 15.5
    expect(out[1].startTime).toBeCloseTo(6.5, 1)
    expect(out[2].startTime).toBeCloseTo(15.5, 1)
    for (let i = 1; i < out.length; i++) expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
  })

  it('enforces monotonicity when a pin conflicts with a confident neighbour', () => {
    const lines = [line('A', 1), line('B', 2), line('C', 3)]
    const out = refitAroundAnchors(lines, [anc(1, 5)], 'ja') // pin B past C
    for (let i = 1; i < out.length; i++) expect(out[i].startTime).toBeGreaterThanOrEqual(out[i - 1].startTime)
    expect(out[1].startTime).toBe(5)
  })

  it('a user anchor overrides an auto anchor on the same line', () => {
    const lines = [line('A', 1), line('B', 8)]
    const anchors: TimingAnchor[] = [
      { lineIndex: 1, time: 6, source: 'auto-end' },
      { lineIndex: 1, time: 5, source: 'user' },
    ]
    const out = refitAroundAnchors(lines, anchors, 'ja')
    expect(out[1].startTime).toBe(5)
  })
})

describe('selectAnchorTargets', () => {
  const L = (n: number) => Array.from({ length: n }, (_, i) => line(`L${i}`, i))

  it('picks uncertain lines worst-first, capped', () => {
    const lines = L(5)
    const q = ['good', 'approximate', 'needs_review', 'good', 'approximate'] as const
    // needs_review (#2) before approximate (#1,#4); capped at 2, returned in order
    expect(selectAnchorTargets(lines, [...q], { max: 2 })).toEqual([1, 2])
  })

  it('skips blank rows, good lines, and already-anchored lines', () => {
    const lines = [line('A', 0), line('', 1), line('C', 2), line('D', 3)]
    const q = ['approximate', 'needs_review', 'approximate', 'good'] as const
    expect(selectAnchorTargets(lines, [...q], { alreadyAnchored: [2] })).toEqual([0]) // #1 blank, #2 anchored, #3 good
  })

  it('promotes section entries within a tier', () => {
    const lines = L(4)
    const q = ['approximate', 'approximate', 'approximate', 'good'] as const
    // all approximate; #2 is a section entry → it ranks first, so with max=1 it wins
    expect(selectAnchorTargets(lines, [...q], { max: 1, sectionEntry: [2] })).toEqual([2])
  })

  it('returns [] when there is no quality signal', () => {
    expect(selectAnchorTargets(L(3), undefined)).toEqual([])
  })
})

/**
 * The recall gap in the drag strip's candidate set.
 *
 * The filter admitted only lines the per-line LABELS already distrust (`tier < 2`), and those
 * labels catch 22 of 41 known >1.5s errors (ledger L5). So a line the labels confidently call
 * 'good' while it sits seconds from the vocal was never offered for re-timing — the user was
 * never invited to fix the app's most confident mistakes. The truth-free verdict closes that,
 * and it separates cleanly at this layer (verified p90 1.91s vs unverified 8.74s, L14) even
 * though it is saturated at song level and must not drive the song-level banner (L20).
 */
describe('selectAnchorTargets with a verdict', () => {
  const lines = [
    { original: 'a', translation: '', startTime: 0, endTime: 2 },
    { original: 'b', translation: '', startTime: 2, endTime: 4 },
    { original: 'c', translation: '', startTime: 4, endTime: 6 },
  ]

  it('is byte-identical to the old behaviour when no verdict is supplied', () => {
    const quality = ['good', 'approximate', 'good'] as const
    expect([...selectAnchorTargets([...lines], [...quality] as never)]).toEqual([1])
    expect([...selectAnchorTargets([...lines], [...quality] as never, {})]).toEqual([1])
  })

  it('admits a line the labels call good but the verdict distrusts', () => {
    // Every line is 'good' to the labels, so the old filter yields nothing at all.
    const quality = ['good', 'good', 'good'] as const
    expect([...selectAnchorTargets([...lines], [...quality] as never)]).toEqual([])
    // With the verdict flagging line 2, it becomes a target.
    expect([...selectAnchorTargets([...lines], [...quality] as never, { verdictFlagged: [2] })]).toEqual([2])
  })

  it('ranks labelled lines ahead of verdict-only ones, so the existing order is unchanged', () => {
    const quality = ['good', 'needs_review', 'good'] as const
    // Line 1 is labelled, lines 0 and 2 are verdict-only: the labelled one leads.
    expect([...selectAnchorTargets([...lines], [...quality] as never, { verdictFlagged: [0, 2] })]).toEqual([0, 1, 2])
    // ...and with only one slot, the labelled line takes it.
    expect([...selectAnchorTargets([...lines], [...quality] as never, { verdictFlagged: [0, 2], max: 1 })]).toEqual([1])
  })

  it('still retires an anchored line and still skips blank rows', () => {
    const blank = [
      { original: '', translation: '', startTime: 0, endTime: 2 },
      { original: 'b', translation: '', startTime: 2, endTime: 4 },
    ]
    const quality = ['good', 'good'] as const
    expect([...selectAnchorTargets([...blank], [...quality] as never, { verdictFlagged: [0, 1] })]).toEqual([1])
    expect([...selectAnchorTargets([...lines], ['good', 'good', 'good'] as never, { verdictFlagged: [2], alreadyAnchored: [2] })]).toEqual([])
  })

  it('never returns more than the cap, verdict or not', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ original: `l${i}`, translation: '', startTime: i, endTime: i + 1 }))
    const quality = many.map(() => 'good')
    const out = selectAnchorTargets([...many], [...quality] as never, { verdictFlagged: many.map((_, i) => i) })
    expect(out.length).toBe(4)
  })
})

