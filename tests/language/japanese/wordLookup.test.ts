import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { lookupWord, jishoSearchUrl } from '../../../src/language/japanese/wordLookup'
import { setJmdictGlossForTests, resetJmdictGlossCache } from '../../../src/ai-pipeline/jmdictGloss'
import type { Token } from '../../../src/core/types'

const tok = (patch: Partial<Token> & { surface: string }): Token => ({
  startIndex: 0,
  endIndex: patch.surface.length,
  ...patch,
})

describe('lookupWord', () => {
  beforeEach(() => {
    setJmdictGlossForTests({
      v: 1,
      source: 'test',
      romaji: { kawasu: 'to dodge; to evade', toriwake: 'especially; above all', haato: 'heart' },
      kanji: { '躱す': 'kawasu' },
    })
  })

  afterEach(() => {
    resetJmdictGlossCache()
    vi.unstubAllGlobals()
  })

  it('returns null for punctuation', async () => {
    expect(await lookupWord(tok({ surface: '、', pos: '記号' }))).toBeNull()
    expect(await lookupWord(tok({ surface: '!?' }))).toBeNull()
  })

  it('looks up a conjugated verb by its dictionary form', async () => {
    const result = await lookupWord(tok({ surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す' }))
    expect(result).not.toBeNull()
    expect(result!.headword).toBe('躱す')
    expect(result!.glosses).toEqual(['to dodge', 'to evade'])
  })

  it('falls back to the surface when there is no baseForm', async () => {
    const result = await lookupWord(tok({ surface: '躱す', reading: 'カワス', pos: '動詞' }))
    expect(result!.headword).toBe('躱す')
    expect(result!.glosses).toEqual(['to dodge', 'to evade'])
  })

  it('resolves kana-only words via their reading', async () => {
    const result = await lookupWord(tok({ surface: 'とりわけ', reading: 'トリワケ', pos: '副詞' }))
    expect(result!.glosses).toEqual(['especially', 'above all'])
    expect(result!.reading).toBe('とりわけ')
  })

  it('resolves katakana loanwords with long-vowel marks', async () => {
    const result = await lookupWord(tok({ surface: 'ハート', reading: 'ハート', pos: '名詞' }))
    expect(result!.glosses).toEqual(['heart'])
  })

  it('falls back to a kana-only surface when the token has no reading', async () => {
    const result = await lookupWord(tok({ surface: 'とりわけ', pos: '副詞' }))
    expect(result!.glosses).toEqual(['especially', 'above all'])
  })

  it('converts katakana readings to hiragana', async () => {
    const result = await lookupWord(tok({ surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す' }))
    expect(result!.reading).toBe('かわし')
  })

  it('still returns reading and POS when no gloss exists', async () => {
    const result = await lookupWord(tok({ surface: '骨頂', reading: 'コッチョウ', pos: '名詞' }))
    expect(result).not.toBeNull()
    expect(result!.glosses).toEqual([])
    expect(result!.reading).toBe('こっちょう')
    expect(result!.pos).toBe('名詞')
  })

  it('degrades gracefully when the JMdict fetch fails', async () => {
    resetJmdictGlossCache()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const result = await lookupWord(tok({ surface: '躱す', reading: 'カワス', pos: '動詞' }))
    expect(result).not.toBeNull()
    expect(result!.reading).toBe('かわす')
    expect(result!.dictionaryAvailable).toBe(false)
  })

  it('reports the dictionary as available when the gloss map is loaded', async () => {
    const result = await lookupWord(tok({ surface: '骨頂', reading: 'コッチョウ', pos: '名詞' }))
    expect(result!.dictionaryAvailable).toBe(true)
  })
})

describe('jishoSearchUrl', () => {
  it('URL-encodes the headword', () => {
    expect(jishoSearchUrl('躱す')).toBe(`https://jisho.org/search/${encodeURIComponent('躱す')}`)
  })
})

describe('lookupWord — JMdict reading fallback', () => {
  it('uses the common JMdict reading when kuromoji has none for a kanji word', async () => {
    const { setJmdictReadingsForTests, resetJmdictReadingsCache } = await import('../../../src/language/japanese/jmdictReadings')
    setJmdictReadingsForTests({ v: 1, source: 'test', readings: { 躱す: 'かわす' } })
    try {
      const result = await lookupWord(tok({ surface: '躱す', pos: '動詞' }))
      expect(result!.reading).toBe('かわす')
    } finally {
      resetJmdictReadingsCache()
    }
  })

  it('prefers the kuromoji reading over the JMdict fallback', async () => {
    const { setJmdictReadingsForTests, resetJmdictReadingsCache } = await import('../../../src/language/japanese/jmdictReadings')
    setJmdictReadingsForTests({ v: 1, source: 'test', readings: { 躱す: 'ちがう' } })
    try {
      const result = await lookupWord(tok({ surface: '躱す', reading: 'カワス', pos: '動詞' }))
      expect(result!.reading).toBe('かわす')
    } finally {
      resetJmdictReadingsCache()
    }
  })
})

describe('lookupWord — grammar tokens (particles, auxiliaries)', () => {
  it('never glosses a particle from kana homophones (は is not 端 "edge")', async () => {
    const result = await lookupWord(tok({ surface: 'は', reading: 'ハ', pos: '助詞', posDetail1: '係助詞' }))
    expect(result!.glosses.join(' ')).toMatch(/topic/)
    expect(result!.posLabel).toBe('particle')
  })

  it('glosses auxiliaries by function (た is past tense, not 田 "rice")', async () => {
    const result = await lookupWord(tok({ surface: 'た', reading: 'タ', pos: '助動詞', baseForm: 'た' }))
    expect(result!.glosses.join(' ')).toMatch(/past/)
    expect(result!.posLabel).toBe('auxiliary')
  })

  it('shows no gloss (rather than a homophone) for uncurated grammar tokens', async () => {
    setJmdictGlossForTests({ v: 1, source: 'test', romaji: { nya: 'meow' }, kanji: {} })
    const result = await lookupWord(tok({ surface: 'にゃ', reading: 'ニャ', pos: '助詞' }))
    expect(result!.glosses).toEqual([])
  })

  it('labels content-word POS in English', async () => {
    const result = await lookupWord(tok({ surface: '躱す', reading: 'カワス', pos: '動詞' }))
    expect(result!.posLabel).toBe('verb')
  })
})

describe('lookupWord — sung-reading coherence with the ruby', () => {
  // The popover must show the SAME reading the lyric ruby displays: a promoted
  // sung alternate (術→すべ ruby) tapping to じゅつ reads as a wrong popover.
  const sungTok = () => tok({
    surface: '術', reading: 'ジュツ', audioReading: 'スベ', readingConfidence: 0.9, pos: '名詞',
  })

  it('prefers a high-confidence sung reading, keeping the dictionary reading as secondary', async () => {
    const result = await lookupWord(sungTok())
    expect(result!.reading).toBe('すべ')
    expect(result!.dictionaryReading).toBe('じゅつ')
  })

  it('always promotes the sung reading in sung mode', async () => {
    const low = tok({ surface: '術', reading: 'ジュツ', audioReading: 'スベ', readingConfidence: 0.4, pos: '名詞' })
    expect((await lookupWord(low, 'sung'))!.reading).toBe('すべ')
    expect((await lookupWord(low, 'dictionary'))!.reading).toBe('じゅつ')
  })

  it('reports no secondary reading when nothing was adopted', async () => {
    const result = await lookupWord(tok({ surface: '躱す', reading: 'カワス', pos: '動詞' }))
    expect(result!.reading).toBe('かわす')
    expect(result!.dictionaryReading).toBeNull()
  })
})
