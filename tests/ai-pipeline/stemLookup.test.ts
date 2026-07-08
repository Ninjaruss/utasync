import { describe, it, expect } from 'vitest'
import {
  dictKeysMatchingStem,
  inflectionStemCandidates,
  stemLookupMatchesTarget,
} from '../../src/ai-pipeline/stemLookup'
import { glossMatchesTarget, ROMAJI_GLOSS } from '../../src/ai-pipeline/lyricGloss'

describe('inflectionStemCandidates', () => {
  it('strips past tense from godan verbs', () => {
    expect(inflectionStemCandidates('korogatta')).toContain('koroga')
  })

  it('strips te-form chains toward the lexical stem', () => {
    const stems = inflectionStemCandidates('aishiteiru')
    expect(stems.some((s) => s.startsWith('aish'))).toBe(true)
  })

  it('does not over-strip to very short fragments', () => {
    expect(inflectionStemCandidates('ai')).toEqual([])
  })

  it('restores nasal-onbin lemma candidates for stems ending in n', () => {
    // 口をつぐん → tsugun → つぐむ tsugumu; 滲ん → nijin → 滲む nijimu
    expect(inflectionStemCandidates('tsugun')).toContain('tsugumu')
    expect(inflectionStemCandidates('nijin')).toContain('nijimu')
    // 叫ん → saken → 叫ぶ sakebu
    expect(inflectionStemCandidates('saken')).toContain('sakebu')
  })
})

describe('dictKeysMatchingStem', () => {
  it('links verb stems to dictionary-form keys', () => {
    expect(dictKeysMatchingStem('koroga', Object.keys(ROMAJI_GLOSS))).toContain('korogaru')
  })

  it('does not treat an ambiguous exact-stem collision as a dictionary hit', () => {
    // "hoshikatta" (wanted) strips to stem "hoshi", which also happens to be
    // the unrelated dictionary lemma for 星 "star" — that coincidence should
    // not be reported as a match.
    expect(dictKeysMatchingStem('hoshi', Object.keys(ROMAJI_GLOSS))).not.toContain('hoshi')
  })
})

describe('stemLookupMatchesTarget', () => {
  const ctx = {
    glossForKey: (key: string) => ROMAJI_GLOSS[key],
    aliasKeysForTarget: () => undefined,
    lemmaKeysForStem: () => Object.keys(ROMAJI_GLOSS),
  }

  it('matches inflected romaji to lemma gloss', () => {
    expect(stemLookupMatchesTarget('korogatta', 'roll', ctx)).toBe(true)
    expect(stemLookupMatchesTarget('korogattara', 'roll', ctx)).toBe(true)
  })

  it('matches via poetic alias keys on stems', () => {
    const aliasCtx = {
      ...ctx,
      aliasKeysForTarget: (t: string) => (t === 'rolling' ? new Set(['korogaru']) : undefined),
    }
    expect(stemLookupMatchesTarget('korogatta', 'rolling', aliasCtx)).toBe(true)
  })

  it('does not falsely match an unrelated word via an ambiguous stem collision', () => {
    // "hoshikatta" (欲しかった, "wanted") strips to stem "hoshi", which is
    // also the unrelated dictionary lemma for 星 "star" — must not match.
    expect(stemLookupMatchesTarget('hoshikatta', 'star', ctx)).toBe(false)
  })
})

describe('glossMatchesTarget integration', () => {
  it('resolves inflected forms through stem lookup', () => {
    expect(glossMatchesTarget('korogatta', 'roll')).toBe(true)
    expect(glossMatchesTarget('korogatta', 'rolling')).toBe(true)
    expect(glossMatchesTarget('aishiteiru', 'love')).toBe(true)
  })
})
