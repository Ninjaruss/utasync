import { describe, it, expect } from 'vitest'
import { selectClozeTokens } from '../../src/cloze/ClozeEngine'
import type { Token } from '../../src/core/types'

const tokens: Token[] = [
  { surface: '星', pos: '名詞', startIndex: 0, endIndex: 1 },
  { surface: 'に', pos: '助詞', startIndex: 1, endIndex: 2 },
  { surface: '願い', pos: '名詞', startIndex: 2, endIndex: 4 },
  { surface: 'を', pos: '助詞', startIndex: 4, endIndex: 5 },
]

describe('selectClozeTokens', () => {
  it('easy: blanks content words only', () => {
    const blanked = selectClozeTokens(tokens, 'easy')
    const blankedSurfaces = blanked.filter((t) => t.blanked).map((t) => t.surface)
    expect(blankedSurfaces).toContain('星')
    expect(blankedSurfaces).not.toContain('に')
  })

  it('hard: blanks more tokens', () => {
    const easy = selectClozeTokens(tokens, 'easy').filter((t) => t.blanked).length
    const hard = selectClozeTokens(tokens, 'hard').filter((t) => t.blanked).length
    expect(hard).toBeGreaterThanOrEqual(easy)
  })
})
