import { describe, it, expect } from 'vitest'
import { normalizeForMatch } from '../../src/ai-pipeline/contentAligner'

describe('normalizeForMatch', () => {
  it('keeps lowercase latin and Japanese, drops spaces/punctuation', () => {
    expect(normalizeForMatch('You always make me')).toBe('youalwaysmakeme')
    expect(normalizeForMatch('「どうした？」なんて')).toBe('どうしたなんて')
    expect(normalizeForMatch('I promise, for my eyes only!')).toBe('ipromiseformyeyesonly')
  })
})
