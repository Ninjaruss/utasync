import kuromoji from 'kuromoji'
import type { Token } from '../../core/types'

let builder: any = null

function getTokenizer(): Promise<any> {
  if (builder) return Promise.resolve(builder)
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: '/dict' }).build((err: any, tokenizer: any) => {
      if (err) reject(err)
      else { builder = tokenizer; resolve(tokenizer) }
    })
  })
}

export async function tokenizeJapanese(text: string): Promise<Token[]> {
  const tokenizer = await getTokenizer()
  const raw: any[] = tokenizer.tokenize(text)

  let index = 0
  return raw.map((t): Token => {
    const startIndex = index
    index += t.surface_form.length
    return {
      surface: t.surface_form,
      reading: t.reading,
      pos: t.pos,
      startIndex,
      endIndex: index,
    }
  })
}
