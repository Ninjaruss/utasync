import { describe, it, expect } from 'vitest'
import { tokenizeEnglish } from '../../../src/language/english/tokenizer'

/**
 * Runs the REAL compromise, deliberately unmocked. This is the coverage whose
 * absence let the tokenizer ship broken: it read `doc.terms().json()` as
 * `{ text, offset, tags }`, but v14 returns `{ text, terms: [{ tags }] }` with
 * no top-level tags and no offsets unless asked. An `as` cast hid the mismatch
 * from TypeScript, so every call threw and enrichLines' `catch` swallowed it —
 * English songs silently got no tokens, no readings and no grammar at all.
 */
describe('tokenizeEnglish (real compromise)', () => {
  const LINE = "Who's that playing the guitar?"

  it('returns tokens for an ordinary lyric line', async () => {
    const tokens = await tokenizeEnglish(LINE)
    expect(tokens.length).toBeGreaterThan(3)
    expect(tokens.map((t) => t.surface)).toContain('guitar?')
  })

  it('produces offsets that actually index back into the source text', async () => {
    // The invariant the Japanese tokenizer also holds, and the one that would
    // have caught the missing `{ offset: true }`: indices were NaN without it.
    for (const t of await tokenizeEnglish(LINE)) {
      expect(Number.isFinite(t.startIndex)).toBe(true)
      expect(Number.isFinite(t.endIndex)).toBe(true)
      expect(t.endIndex).toBeGreaterThan(t.startIndex)
      expect(LINE.slice(t.startIndex, t.endIndex)).toBe(t.surface)
    }
  })

  it('resolves a part of speech instead of falling back to unknown', async () => {
    const tokens = await tokenizeEnglish(LINE)
    const guitar = tokens.find((t) => t.surface.startsWith('guitar'))
    expect(guitar?.pos).toBe('Noun')
    expect(tokens.every((t) => t.pos === 'unknown')).toBe(false)
  })

  it('drops zero-width implicit terms', async () => {
    // compromise emits an implicit copula for "Who's" with length 0 — it has no
    // surface to render, colour or tap.
    const tokens = await tokenizeEnglish(LINE)
    expect(tokens.every((t) => t.surface.trim().length > 0)).toBe(true)
  })

  it('handles an empty line without throwing', async () => {
    expect(await tokenizeEnglish('')).toEqual([])
  })
})
