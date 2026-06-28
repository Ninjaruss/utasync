import { describe, it, expect } from 'vitest'
import { nwAlign } from '../../src/ai-pipeline/readingAlignment'

describe('nwAlign', () => {
  it('aligns identical strings as all matches', () => {
    const cols = nwAlign('あい', 'あい')
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: 1, b: 1 }])
  })

  it('represents a substitution as aligned mismatched columns', () => {
    const cols = nwAlign('あいう', 'あえう')
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: 1, b: 1 }, { a: 2, b: 2 }])
  })

  it('represents a deletion (extra A char) with b = -1', () => {
    const cols = nwAlign('あいう', 'あう')
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: 1, b: -1 }, { a: 2, b: 1 }])
  })

  it('represents an insertion (extra B char) with a = -1', () => {
    const cols = nwAlign('あう', 'あいう')
    expect(cols).toEqual([{ a: 0, b: 0 }, { a: -1, b: 1 }, { a: 1, b: 2 }])
  })
})
