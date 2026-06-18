import type { Token } from './types'

/** kuromoji tags particles as "助詞" (optionally with sub-category after a comma). */
export function isParticleToken(token: Token): boolean {
  return token.pos?.startsWith('助詞') ?? false
}
