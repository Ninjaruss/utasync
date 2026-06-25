import { describe, it, expect } from 'vitest'
import type { Token } from '../../src/core/types'
import { applyReadingCorrections } from '../../src/language/japanese/readingCorrections'

const tok = (surface: string, reading: string, pos = '名詞'): Token => ({
  surface,
  reading,
  pos,
  startIndex: 0,
  endIndex: surface.length,
})

describe('applyReadingCorrections', () => {
  it('corrects 角 from かく to かど (corner) for a standalone noun', () => {
    const [out] = applyReadingCorrections([tok('角', 'カク')])
    expect(out.reading).toBe('カド')
  })

  it('corrects 術 from じゅつ to すべ (means/way)', () => {
    const [out] = applyReadingCorrections([tok('術', 'ジュツ')])
    expect(out.reading).toBe('スベ')
  })

  it('leaves a correct reading untouched', () => {
    const [out] = applyReadingCorrections([tok('角', 'カド')])
    expect(out.reading).toBe('カド')
  })

  it('does not touch compound tokens with a different surface', () => {
    const [out] = applyReadingCorrections([tok('角度', 'カクド')])
    expect(out.reading).toBe('カクド')
  })

  it('does not touch unrelated tokens or change identity fields', () => {
    const tokens = [tok('世界', 'セカイ'), tok('角', 'カク')]
    const out = applyReadingCorrections(tokens)
    expect(out[0].reading).toBe('セカイ')
    expect(out[1]).toMatchObject({ surface: '角', startIndex: 0 })
  })
})
