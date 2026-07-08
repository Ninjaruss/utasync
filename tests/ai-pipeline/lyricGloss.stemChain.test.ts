import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setJmdictGlossForTests, resetJmdictGlossCache } from '../../src/ai-pipeline/jmdictGloss'
import { ensureGlossLexicon, glossMatchStrength } from '../../src/ai-pipeline/lyricGloss'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Stem-chain matching must not fire for romaji that are themselves known
 * lemmas. Measured production defect: また (mata, gloss "again") stripped the
 * ta "suffix", left the 2-char stem "ma", and prefix-extended to the JMdict
 * key mabi ("day") — scoring また→day as a perfect gloss match on
 * 何処かでまた会えるように / "One day we'll meet again somewhere".
 */
describe('glossMatchStrength — stem chain vs known lemma', () => {
  beforeAll(async () => {
    setJmdictGlossForTests(
      JSON.parse(readFileSync(join(here, '../../public/jmdict-gloss.json'), 'utf8')),
    )
    await ensureGlossLexicon()
  }, 30_000)

  afterAll(async () => {
    resetJmdictGlossCache()
    await ensureGlossLexicon()
  })

  it('does not stem-chain a known lemma onto an unrelated gloss (mata → day)', () => {
    expect(glossMatchStrength({ romaji: 'mata', surface: 'また' }, 'day')).toBe(0)
  })

  it('keeps the lemma own gloss match (mata → again)', () => {
    expect(glossMatchStrength({ romaji: 'mata', surface: 'また' }, 'again')).toBe(1)
  })

  it('still stem-matches genuinely inflected forms (tadotta → follow)', () => {
    // 辿った is not itself a lemma; stripping tta must keep reaching 辿る.
    expect(glossMatchStrength({ romaji: 'tadotta', surface: '辿った' }, 'follow')).toBeGreaterThan(0)
  })
})
