import { describe, it, expect } from 'vitest'
import { isParticleToken } from '../../src/core/language'
import type { Token } from '../../src/core/types'

const tok = (surface: string, pos?: string): Token => ({ surface, pos, startIndex: 0, endIndex: surface.length })

describe('isParticleToken', () => {
  it('identifies kuromoji particle tag', () => {
    expect(isParticleToken(tok('が', '助詞'))).toBe(true)
    expect(isParticleToken(tok('が', '助詞,格助詞,一般,*'))).toBe(true)
  })
  it('treats non-particle tags as false', () => {
    expect(isParticleToken(tok('君', '名詞'))).toBe(false)
    expect(isParticleToken(tok('long'))).toBe(false)
  })
})
