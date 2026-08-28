import { describe, it, expect } from 'vitest'
import {
  identity, mergeAdjacent, splitLine, dropTranslationFor, insertNoiseLine,
} from '../../scripts/lib/translationPerturbations.mjs'

const T = ['alpha one', 'beta two', 'gamma three, delta four', 'epsilon five']

describe('identity', () => {
  it('maps each original to its own line', () => {
    const s = identity(T)
    expect(s.lines).toEqual(T)
    expect(s.truth).toEqual([['alpha one'], ['beta two'], ['gamma three, delta four'], ['epsilon five']])
  })
})

describe('mergeAdjacent', () => {
  it('folds two lines into one and maps both originals to it', () => {
    const s = mergeAdjacent(identity(T), 0)
    expect(s.lines).toEqual(['alpha one beta two', 'gamma three, delta four', 'epsilon five'])
    expect(s.truth[0]).toEqual(['alpha one beta two'])
    expect(s.truth[1]).toEqual(['alpha one beta two'])
    expect(s.truth[2]).toEqual(['gamma three, delta four'])
  })
})

describe('splitLine', () => {
  it('splits at a clause boundary and maps one original to both halves', () => {
    const s = splitLine(identity(T), 2)
    expect(s.lines).toEqual(['alpha one', 'beta two', 'gamma three', 'delta four', 'epsilon five'])
    expect(s.truth[2]).toEqual(['gamma three', 'delta four'])
    expect(s.truth[3]).toEqual(['epsilon five'])
  })

  it('is a no-op when the line has no clause boundary', () => {
    const s = splitLine(identity(T), 0)
    expect(s.lines).toEqual(T)
  })
})

describe('dropTranslationFor', () => {
  it('removes the line and leaves that original with no truth', () => {
    const s = dropTranslationFor(identity(T), 1)
    expect(s.lines).toEqual(['alpha one', 'gamma three, delta four', 'epsilon five'])
    expect(s.truth[1]).toEqual([])
    expect(s.truth[2]).toEqual(['gamma three, delta four'])
  })
})

describe('insertNoiseLine', () => {
  it('inserts a line that belongs to no original', () => {
    const s = insertNoiseLine(identity(T), 0, '[Chorus]')
    expect(s.lines[0]).toBe('[Chorus]')
    expect(s.truth.flat()).not.toContain('[Chorus]')
    expect(s.truth[0]).toEqual(['alpha one'])
  })
})

describe('composition', () => {
  it('composes without corrupting truth', () => {
    const s = insertNoiseLine(mergeAdjacent(identity(T), 0), 0, 'Song Title')
    expect(s.lines).toEqual(['Song Title', 'alpha one beta two', 'gamma three, delta four', 'epsilon five'])
    expect(s.truth[0]).toEqual(['alpha one beta two'])
    expect(s.truth[1]).toEqual(['alpha one beta two'])
    expect(s.truth[3]).toEqual(['epsilon five'])
  })
})
