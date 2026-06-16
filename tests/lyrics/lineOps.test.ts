import { describe, it, expect } from 'vitest'
import { stampStart, nudgeStart, setText, addLine, deleteLine, mergeWithNext, splitLine, reorder } from '../../src/lyrics/lineOps'
import type { TimedLine } from '../../src/core/types'

const L = (startTime: number, original: string, translation = ''): TimedLine => ({ startTime, endTime: startTime + 2, original, translation })
const lines = (): TimedLine[] => [L(0, 'a'), L(2, 'b'), L(4, 'c')]

describe('stampStart', () => {
  it('sets the start time of one line and leaves others unchanged', () => {
    const out = stampStart(lines(), 1, 2.5)
    expect(out[1].startTime).toBe(2.5)
    expect(out[0]).toEqual(lines()[0])
    expect(out).not.toBe(lines()) // new array (immutable)
  })
})

describe('nudgeStart', () => {
  it('adds a delta and clamps at zero', () => {
    expect(nudgeStart(lines(), 1, -0.1)[1].startTime).toBeCloseTo(1.9)
    expect(nudgeStart(lines(), 0, -5)[0].startTime).toBe(0)
  })
})

describe('setText', () => {
  it('updates original and translation independently', () => {
    const out = setText(lines(), 0, { original: 'x' })
    expect(out[0].original).toBe('x')
    expect(out[0].translation).toBe('')
    expect(setText(lines(), 0, { translation: 'y' })[0].translation).toBe('y')
  })

  it('drops stale enrichment when the original text changes', () => {
    const enriched: TimedLine = { ...L(0, 'a'), reading: 'old', furigana: '<ruby>', tokens: [] }
    const out = setText([enriched], 0, { original: 'b' })
    expect(out[0].reading).toBeUndefined()
    expect(out[0].furigana).toBeUndefined()
    expect(out[0].tokens).toBeUndefined()
  })
})

describe('addLine', () => {
  it('inserts an empty untimed line after the given index', () => {
    const out = addLine(lines(), 0)
    expect(out).toHaveLength(4)
    expect(out[1]).toMatchObject({ original: '', translation: '', startTime: 0 })
  })
})

describe('deleteLine', () => {
  it('removes the line at the index', () => {
    const out = deleteLine(lines(), 1)
    expect(out.map((l) => l.original)).toEqual(['a', 'c'])
  })
})

describe('mergeWithNext', () => {
  it('joins a line with the following one and keeps the earlier start', () => {
    const out = mergeWithNext(lines(), 0)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ original: 'a b', startTime: 0, endTime: 4 })
  })

  it('is a no-op on the last line', () => {
    expect(mergeWithNext(lines(), 2)).toHaveLength(3)
  })
})

describe('splitLine', () => {
  it('splits original text at a character offset into two lines', () => {
    const out = splitLine([L(0, 'hello world')], 0, 5)
    expect(out.map((l) => l.original)).toEqual(['hello', 'world'])
    expect(out[1].startTime).toBe(0)
  })
})

describe('reorder', () => {
  it('moves a line from one index to another', () => {
    expect(reorder(lines(), 0, 2).map((l) => l.original)).toEqual(['b', 'c', 'a'])
  })
})
