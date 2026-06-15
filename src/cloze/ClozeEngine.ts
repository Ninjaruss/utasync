import type { Token, ClozeDifficulty } from '../core/types'

export interface ClozeToken extends Token {
  blanked: boolean
}

const CONTENT_POS = new Set(['名詞', 'Noun', 'Verb', 'Adjective', '動詞', '形容詞', '形容動詞'])
const FUNCTION_POS = new Set(['助詞', 'Conjunction', '助動詞', 'Determiner', 'Preposition'])

export function selectClozeTokens(tokens: Token[], difficulty: ClozeDifficulty): ClozeToken[] {
  return tokens.map((token): ClozeToken => {
    const pos = token.pos ?? ''
    const isContent = CONTENT_POS.has(pos)
    const isFunction = FUNCTION_POS.has(pos)

    let blanked = false
    if (difficulty === 'easy') blanked = isContent
    else if (difficulty === 'medium') blanked = isContent || Math.random() < 0.3
    else blanked = !isFunction // hard: blank almost everything

    return { ...token, blanked }
  })
}
