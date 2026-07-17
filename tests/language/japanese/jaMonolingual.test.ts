import { describe, it, expect, afterEach } from 'vitest'
import { lookupJaDefinition, jaMonolingualLoaded, resetJaMonolingualCache, setJaMonolingualForTests } from '../../../src/language/japanese/jaMonolingual'
import type { Token } from '../../../src/core/types'

const tok = (patch: Partial<Token> & { surface: string }): Token => ({ startIndex: 0, endIndex: patch.surface.length, ...patch })

afterEach(() => resetJaMonolingualCache())

describe('lookupJaDefinition', () => {
  it('resolves by baseForm first, then surface', () => {
    setJaMonolingualForTests({ v: 1, source: 't', entries: { '走る': ['速く移動する'] } })
    expect(jaMonolingualLoaded()).toBe(true)
    expect(lookupJaDefinition(tok({ surface: '走っ', baseForm: '走る' }))).toEqual(['速く移動する'])
  })
  it('falls back to surface when baseForm is absent from the dictionary', () => {
    setJaMonolingualForTests({ v: 1, source: 't', entries: { '猫': ['ネコ科の動物'] } })
    expect(lookupJaDefinition(tok({ surface: '猫' }))).toEqual(['ネコ科の動物'])
  })
  it('returns undefined for a lemma not in the dictionary', () => {
    setJaMonolingualForTests({ v: 1, source: 't', entries: {} })
    expect(lookupJaDefinition(tok({ surface: 'ゑ' }))).toBeUndefined()
  })
  it('returns undefined for a prototype-member key not present', () => {
    setJaMonolingualForTests({ v: 1, source: 't', entries: { '走る': ['速く移動する'] } })
    expect(lookupJaDefinition(tok({ surface: 'constructor' }))).toBeUndefined()
    expect(lookupJaDefinition(tok({ surface: 'toString' }))).toBeUndefined()
  })
})
