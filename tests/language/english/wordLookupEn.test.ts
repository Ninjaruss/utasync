import { describe, it, expect, afterEach } from 'vitest'
import { normalizeEnglishWord, hasLatinLetter, stemCandidates, lookupEnglishWord } from '../../../src/language/english/wordLookupEn'
import { setEnjaDictForTests, resetEnjaDictCache } from '../../../src/language/english/enjaDict'

afterEach(() => resetEnjaDictCache())

describe('normalizeEnglishWord / hasLatinLetter', () => {
  it('lowercases and strips surrounding punctuation', () => {
    expect(normalizeEnglishWord('“Spring,”')).toBe('spring')
    expect(normalizeEnglishWord('run!')).toBe('run')
  })
  it('detects whether a raw token has any latin letter', () => {
    expect(hasLatinLetter('spring')).toBe(true)
    expect(hasLatinLetter('…')).toBe(false)
    expect(hasLatinLetter('123')).toBe(false)
  })
})

describe('stemCandidates', () => {
  it('offers base-form candidates for common suffixes', () => {
    expect(stemCandidates('springs')).toContain('spring')
    expect(stemCandidates('making')).toContain('make')
    expect(stemCandidates('liked')).toContain('like')
    expect(stemCandidates('quickly')).toContain('quick')
    expect(stemCandidates("dog's")).toContain('dog')
  })
})

describe('lookupEnglishWord (translation direction)', () => {
  it('returns null for a token with no latin letters', async () => {
    setEnjaDictForTests({ v: 1, source: 't', entries: {} })
    expect(await lookupEnglishWord('…')).toBeNull()
  })

  it('returns Japanese equivalents for an exact match', async () => {
    setEnjaDictForTests({ v: 1, source: 't', entries: { spring: [{ w: '春', r: 'はる' }] } })
    const r = await lookupEnglishWord('Spring')
    expect(r).toMatchObject({ headword: 'spring', definitionLang: 'ja' })
    expect(r!.equivalents).toEqual([{ ja: '春', reading: 'はる' }])
  })

  it('falls back to a stemmed match when the exact form misses', async () => {
    setEnjaDictForTests({ v: 1, source: 't', entries: { umbrella: [{ w: '傘', r: 'かさ' }] } })
    const r = await lookupEnglishWord('umbrellas')
    expect(r!.equivalents).toEqual([{ ja: '傘', reading: 'かさ' }])
  })

  it('reports no equivalents (but dictionaryAvailable) for an unknown word', async () => {
    setEnjaDictForTests({ v: 1, source: 't', entries: {} })
    const r = await lookupEnglishWord('xyzzy')
    expect(r!.equivalents).toEqual([])
    expect(r!.dictionaryAvailable).toBe(true)
  })
})
