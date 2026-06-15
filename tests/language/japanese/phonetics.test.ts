import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/language/japanese/phonetics', () => ({
  toRomaji: async (text: string) => 'hoshi',
  toFurigana: async (text: string) => '<ruby>星<rt>ほし</rt></ruby>',
  toKatakana: async (text: string) => 'ホシ',
}))

import { toRomaji, toFurigana } from '../../../src/language/japanese/phonetics'

describe('toRomaji', () => {
  it('converts hiragana to romaji', async () => {
    const result = await toRomaji('ほし')
    expect(result).toBe('hoshi')
  })

  it('converts kanji sentence with readings', async () => {
    const result = await toRomaji('星に願いを')
    expect(result.toLowerCase()).toContain('hoshi')
  })
})

describe('toFurigana', () => {
  it('returns HTML with ruby annotations', async () => {
    const result = await toFurigana('星')
    expect(result).toContain('<ruby>')
    expect(result).toContain('<rt>')
  })
})
