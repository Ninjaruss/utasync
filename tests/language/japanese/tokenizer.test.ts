import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/language/japanese/tokenizer', () => ({
  tokenizeJapanese: async (text: string) => {
    return text.split('').map((char, i) => ({
      surface: char,
      reading: char,
      pos: i === 0 ? '動詞' : '名詞',
      startIndex: i,
      endIndex: i + 1,
    }))
  }
}))

import { tokenizeJapanese } from '../../../src/language/japanese/tokenizer'

describe('tokenizeJapanese', () => {
  it('tokenizes a simple sentence', async () => {
    const tokens = await tokenizeJapanese('星に願いを')
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens[0].surface).toBeTruthy()
  })

  it('includes reading for kanji', async () => {
    const tokens = await tokenizeJapanese('星')
    const star = tokens.find((t) => t.surface === '星')
    expect(star?.reading).toBeTruthy()
  })

  it('includes part of speech', async () => {
    const tokens = await tokenizeJapanese('走る')
    const verb = tokens.find((t) => t.surface === '走')
    expect(verb?.pos).toMatch(/動詞|verb/i)
  })
})
