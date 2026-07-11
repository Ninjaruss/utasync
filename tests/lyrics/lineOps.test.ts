import { describe, it, expect } from 'vitest'
import { stampStart, stampTimes, setText, addLine, deleteLine, mergeWithNext, splitLine, reorder } from '../../src/lyrics/lineOps'
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

describe('stampTimes', () => {
  it('sets start and end together, immutably, leaving other lines unchanged', () => {
    const out = stampTimes(lines(), 1, { start: 2.5, end: 3.5 })
    expect(out[1]).toMatchObject({ startTime: 2.5, endTime: 3.5 })
    expect(out[0]).toEqual(lines()[0])
    expect(out).not.toBe(lines())
  })

  it('sets only the end when start is omitted', () => {
    const out = stampTimes(lines(), 1, { end: 3.5 })
    expect(out[1]).toMatchObject({ startTime: 2, endTime: 3.5 })
  })

  it('clears the explicit end back to auto with end: null (endTime collapses to startTime)', () => {
    const out = stampTimes(lines(), 1, { end: null })
    expect(out[1]).toMatchObject({ startTime: 2, endTime: 2 })
  })

  it('clamps an explicit end to not precede the start', () => {
    const out = stampTimes(lines(), 1, { start: 5, end: 4 })
    expect(out[1].endTime).toBe(5)
  })

  it('drags a stale explicit end along when the start moves past it', () => {
    const out = stampTimes(lines(), 1, { start: 10 })
    expect(out[1]).toMatchObject({ startTime: 10, endTime: 10 })
  })

  it('keeps an auto end auto when only the start moves', () => {
    const untimedEnd: TimedLine[] = [{ startTime: 2, endTime: 2, original: 'a', translation: '' }]
    const out = stampTimes(untimedEnd, 0, { start: 1 })
    expect(out[0]).toMatchObject({ startTime: 1, endTime: 1 })
  })

  it('clamps a negative start to 0', () => {
    const out = stampTimes(lines(), 0, { start: -3 })
    expect(out[0].startTime).toBe(0)
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
    const enriched: TimedLine = { ...L(0, 'a'), reading: 'old', furigana: '<ruby>', tokens: [], grammarAnnotations: [] }
    const out = setText([enriched], 0, { original: 'b' })
    expect(out[0].reading).toBeUndefined()
    expect(out[0].furigana).toBeUndefined()
    expect(out[0].tokens).toBeUndefined()
    expect(out[0].grammarAnnotations).toBeUndefined()
  })

  it('drops stale tokens (with stale alignmentIndices) when only the translation changes, but keeps reading/furigana/grammarAnnotations', () => {
    const enriched: TimedLine = { ...L(0, 'a', 'old translation'), reading: 'reading', furigana: '<ruby>', tokens: [], grammarAnnotations: [] }
    const out = setText([enriched], 0, { translation: 'new translation' })
    expect(out[0].translation).toBe('new translation')
    expect(out[0].tokens).toBeUndefined()
    expect(out[0].reading).toBe('reading')
    expect(out[0].furigana).toBe('<ruby>')
    expect(out[0].grammarAnnotations).toEqual([])
  })

  it('clears nothing when the patch matches the existing original and translation', () => {
    const enriched: TimedLine = { ...L(0, 'a', 'b'), reading: 'reading', furigana: '<ruby>', tokens: [], grammarAnnotations: [] }
    const out = setText([enriched], 0, { original: 'a', translation: 'b' })
    expect(out[0].reading).toBe('reading')
    expect(out[0].furigana).toBe('<ruby>')
    expect(out[0].tokens).toEqual([])
    expect(out[0].grammarAnnotations).toEqual([])
  })

  it('clears nothing when no patch fields are provided', () => {
    const enriched: TimedLine = { ...L(0, 'a', 'b'), reading: 'reading', furigana: '<ruby>', tokens: [], grammarAnnotations: [] }
    const out = setText([enriched], 0, {})
    expect(out[0].reading).toBe('reading')
    expect(out[0].furigana).toBe('<ruby>')
    expect(out[0].tokens).toEqual([])
    expect(out[0].grammarAnnotations).toEqual([])
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
