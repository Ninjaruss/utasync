import { describe, it, expect } from 'vitest'
import { mapKuromojiTokens } from '../../../src/language/japanese/tokenizer'

describe('mapKuromojiTokens', () => {
  it('captures the dictionary form of conjugated words', () => {
    const tokens = mapKuromojiTokens([
      { surface_form: '泣い', reading: 'ナイ', pos: '動詞', basic_form: '泣く' },
      { surface_form: 'た', reading: 'タ', pos: '助動詞', basic_form: 'た' },
    ])
    expect(tokens[0].baseForm).toBe('泣く')
    // Same as the surface — omitted to keep persisted tokens lean.
    expect(tokens[1].baseForm).toBeUndefined()
  })

  it('omits baseForm when kuromoji reports *', () => {
    const tokens = mapKuromojiTokens([
      { surface_form: 'ちゃん', reading: 'チャン', pos: '名詞', basic_form: '*' },
    ])
    expect(tokens[0].baseForm).toBeUndefined()
  })

  it('computes contiguous start/end indices', () => {
    const tokens = mapKuromojiTokens([
      { surface_form: '星', reading: 'ホシ', pos: '名詞' },
      { surface_form: 'に', reading: 'ニ', pos: '助詞' },
    ])
    expect(tokens[0]).toMatchObject({ startIndex: 0, endIndex: 1 })
    expect(tokens[1]).toMatchObject({ startIndex: 1, endIndex: 2 })
  })
})
