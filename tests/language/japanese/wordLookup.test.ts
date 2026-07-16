import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

describe('lookupWord — blank recovery for inflected + subsidiary verbs (round 10, T2)', () => {
  // Uses the real regenerated JMdict data so recovered glosses match production.
  beforeEach(() => {
    const here = dirname(fileURLToPath(import.meta.url))
    setJmdictGlossForTests(
      JSON.parse(readFileSync(join(here, '../../../public/jmdict-gloss.json'), 'utf8')),
    )
  })
  afterEach(() => resetJmdictGlossCache())

  it('(a) glosses a kanji subsidiary verb via its reading (行く → go)', async () => {
    // In 〜て行く kuromoji tags 行く as 動詞/非自立. It misses the kana-keyed
    // grammar map (only いく is listed there) and grammar suppression otherwise
    // blocks the lexical chain, so the popover showed "No definition found".
    const r = await lookupWord(tok({ surface: '行く', pos: '動詞', posDetail1: '非自立', reading: 'イク' }))
    expect(r!.glosses.join(' '), '行く should gloss to go').toContain('go')
  })

  it('(b) romanizes the dictionary form, not the inflected reading (わから → understand)', async () => {
    // わから romanizes to "wakara" (miss); the base form わかる → "wakaru" resolves.
    const r = await lookupWord(
      tok({ surface: 'わから', pos: '動詞', posDetail1: '自立', baseForm: 'わかる', reading: 'ワカラ' }),
    )
    expect(r!.glosses).toContain('understand')
  })

  it('(b) recovers other inflected content verbs to a non-blank gloss (なくし / いっ / ぶちまけ)', async () => {
    const cases = [
      tok({ surface: 'なくし', pos: '動詞', posDetail1: '自立', baseForm: 'なくす', reading: 'ナクシ' }),
      tok({ surface: 'いっ', pos: '動詞', posDetail1: '自立', baseForm: 'いう', reading: 'イッ' }),
      tok({ surface: 'ぶちまけ', pos: '動詞', posDetail1: '自立', baseForm: 'ぶちまける', reading: 'ブチマケ' }),
    ]
    for (const t of cases) {
      const r = await lookupWord(t)
      expect(r!.glosses, `${t.surface} should not be blank`).not.toEqual([])
    }
  })

  it('leaves a genuinely-undefined verb blank (base-form recovery invents nothing)', async () => {
    // Synthetic inflected verb whose base form has no JMdict gloss: the base-form
    // romanization must not fabricate a definition for it.
    const r = await lookupWord(
      tok({ surface: 'ずびし', pos: '動詞', posDetail1: '自立', baseForm: 'ずびす', reading: 'ズビシ' }),
    )
    expect(r!.glosses).toEqual([])
  })

  it('regression: still resolves katakana long-vowel loanwords (スーパー → supermarket)', async () => {
    // Base-form romanization must NOT displace the long-vowel-preserving reading
    // path: スーパー has no distinct baseForm, so its reading still romanizes to
    // "suupaa" (not the hyphenated hiragana form).
    const r = await lookupWord(tok({ surface: 'スーパー', pos: '名詞', posDetail1: '一般', reading: 'スーパー' }))
    expect(r!.glosses).toContain('supermarket')
  })

  it('regression: leaves an already-dictionary-form verb unchanged (わかる → understand)', async () => {
    const r = await lookupWord(tok({ surface: 'わかる', pos: '動詞', posDetail1: '自立', reading: 'ワカル' }))
    expect(r!.glosses).toContain('understand')
  })

  it('regression: kana subsidiary verbs stay on the grammar map (いく → going on / continuing)', async () => {
    // The subsidiary-verb recovery is kanji-scoped; kana 非自立 verbs must keep
    // their grammar-function gloss, not fall through to the lexical "go".
    const r = await lookupWord(
      tok({ surface: 'いく', pos: '動詞', posDetail1: '非自立', baseForm: 'いく', reading: 'イク' }),
    )
    expect(r!.glosses.join(' ')).toMatch(/going on|continuing/)
  })
})

describe('lookupWord — surface-specific kanji gloss (homophone collapse fix)', () => {
  afterEach(() => resetJmdictGlossCache())

  it('prefers the surface gloss over the romaji-collapsed homophone', async () => {
    // 億/置く both romanize "oku"; 状態/上体 → "joutai"; 機嫌/紀元 → "kigen".
    // Without the surface gloss the popover inherits the wrong homophone.
    setJmdictGlossForTests({
      v: 1,
      source: 'test',
      romaji: { oku: 'put', joutai: 'upper', kigen: 'era' },
      kanji: { 億: 'oku', 状態: 'joutai', 機嫌: 'kigen' },
      kanjiGloss: { 億: 'hundred million', 状態: 'state; condition', 機嫌: 'mood; temper' },
    })

    const oku = await lookupWord(tok({ surface: '億', reading: 'オク', pos: '名詞' }))
    expect(oku!.glosses).toEqual(['hundred million'])
    expect(oku!.glosses).not.toContain('put')

    const joutai = await lookupWord(tok({ surface: '状態', reading: 'ジョウタイ', pos: '名詞' }))
    expect(joutai!.glosses).toEqual(['state', 'condition'])
    expect(joutai!.glosses).not.toContain('upper')

    const kigen = await lookupWord(tok({ surface: '機嫌', reading: 'キゲン', pos: '名詞' }))
    expect(kigen!.glosses).toEqual(['mood', 'temper'])
    expect(kigen!.glosses).not.toContain('era')
  })

  it('leaves a non-colliding kanji on its romaji-path gloss (no stored override)', async () => {
    setJmdictGlossForTests({
      v: 1,
      source: 'test',
      romaji: { tsukue: 'desk' },
      kanji: { 机: 'tsukue' },
      kanjiGloss: {}, // 机 is not homophone-collided → no surface gloss stored
    })
    const result = await lookupWord(tok({ surface: '机', reading: 'ツクエ', pos: '名詞' }))
    expect(result!.glosses).toEqual(['desk'])
  })

  it('resolves the real regenerated JMdict data for every audited surface', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    setJmdictGlossForTests(
      JSON.parse(readFileSync(join(here, '../../../public/jmdict-gloss.json'), 'utf8')),
    )
    // surface, katakana reading, expected-correct substring, previously-wrong homophone gloss
    const cases: Array<[string, string, string, string]> = [
      ['億', 'オク', 'hundred', 'put'],
      ['状態', 'ジョウタイ', 'state', 'upper'],
      ['情報', 'ジョウホウ', 'information', 'upper'],
      ['機嫌', 'キゲン', 'humour', 'era'],
      ['春', 'ハル', 'spring', 'stick'],
      ['傘', 'カサ', 'umbrella', 'conical'],
    ]
    for (const [surface, reading, correct, wrong] of cases) {
      const r = await lookupWord(tok({ surface, reading, pos: '名詞' }))
      expect(r!.glosses.join(' '), `${surface} should gloss to ${correct}`).toContain(correct)
      expect(r!.glosses, `${surface} must not show ${wrong}`).not.toContain(wrong)
    }
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
