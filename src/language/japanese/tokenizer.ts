import kuromoji, { type Token as KuromojiToken, type Tokenizer } from 'kuromoji'
import type { Token } from '../../core/types'
import { applyReadingCorrections } from './readingCorrections'

let builder: Tokenizer | null = null

function getTokenizer(): Promise<Tokenizer> {
  if (builder) return Promise.resolve(builder)
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: '/dict' }).build((err, tokenizer) => {
      if (err) reject(err)
      else { builder = tokenizer; resolve(tokenizer) }
    })
  })
}

/** Pure kuromoji→Token mapping, exported for tests (the real dictionary cannot load in node). */
export function mapKuromojiTokens(raw: KuromojiToken[]): Token[] {
  let index = 0
  return raw.map((t): Token => {
    const startIndex = index
    index += t.surface_form.length
    return {
      surface: t.surface_form,
      reading: t.reading,
      pos: t.pos,
      posDetail1: t.pos_detail_1 && t.pos_detail_1 !== '*' ? t.pos_detail_1 : undefined,
      baseForm: t.basic_form && t.basic_form !== '*' && t.basic_form !== t.surface_form ? t.basic_form : undefined,
      startIndex,
      endIndex: index,
    }
  })
}

export async function tokenizeJapanese(text: string): Promise<Token[]> {
  const tokenizer = await getTokenizer()
  return applyReadingCorrections(mapKuromojiTokens(tokenizer.tokenize(text)))
}
