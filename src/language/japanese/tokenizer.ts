import kuromoji, { type Tokenizer } from 'kuromoji'
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

export async function tokenizeJapanese(text: string): Promise<Token[]> {
  const tokenizer = await getTokenizer()
  const raw = tokenizer.tokenize(text)

  let index = 0
  const tokens = raw.map((t): Token => {
    const startIndex = index
    index += t.surface_form.length
    return {
      surface: t.surface_form,
      reading: t.reading,
      pos: t.pos,
      posDetail1: t.pos_detail_1 && t.pos_detail_1 !== '*' ? t.pos_detail_1 : undefined,
      startIndex,
      endIndex: index,
    }
  })
  return applyReadingCorrections(tokens)
}
