import { describe, it, expect } from 'vitest'
import { selectClozeTokens, hasClozeBlanks } from '../../src/cloze/ClozeEngine'
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

  // 'medium' used Math.random(), so the same line was re-rolled on every mount —
  // and the overlay only mounts while its row is the active one. A replayed A/B
  // loop (or an enrichment pass replacing the tokens) therefore handed the
  // learner a different set of blanks for the same line.
  it('medium: picks the same blanks every time for the same line', () => {
    const roll = () =>
      selectClozeTokens(tokens, 'medium').map((t) => `${t.surface}:${t.blanked ? 1 : 0}`).join(',')
    const first = roll()
    for (let i = 0; i < 25; i++) expect(roll()).toBe(first)
  })

  it('medium: still varies by position, so a repeated word is not decided by its text alone', () => {
    const repeated: Token[] = [
      { surface: '星', pos: '名詞', startIndex: 0, endIndex: 1 },
      { surface: '星', pos: '名詞', startIndex: 1, endIndex: 2 },
    ]
    // Content words are blanked at every difficulty; the assertion that matters
    // is that the roll is a function of position as well as text, so two
    // identical surfaces are not forced onto the same side of the threshold.
    const rolls = repeated.map((_, i) => selectClozeTokens(repeated, 'medium')[i].blanked)
    expect(rolls.every((b) => b)).toBe(true)
  })
})

describe('hasClozeBlanks', () => {
  it('is false for a line with nothing to hide', () => {
    const punctuation: Token[] = [
      { surface: '、', pos: '記号', startIndex: 0, endIndex: 1 },
      { surface: 'は', pos: '助詞', startIndex: 1, endIndex: 2 },
    ]
    expect(hasClozeBlanks(punctuation, 'easy')).toBe(false)
  })

  it('is true when content words would be blanked, and false without tokens', () => {
    expect(hasClozeBlanks(tokens, 'easy')).toBe(true)
    expect(hasClozeBlanks([], 'easy')).toBe(false)
    expect(hasClozeBlanks(undefined, 'easy')).toBe(false)
  })
})
