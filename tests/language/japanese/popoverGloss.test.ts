import { describe, it, expect, afterEach } from 'vitest'
import { lookupWord } from '../../../src/language/japanese/wordLookup'
import { setJmdictGlossForTests, resetJmdictGlossCache } from '../../../src/ai-pipeline/jmdictGloss'
import { setJmdictPopoverForTests, resetJmdictPopoverCache } from '../../../src/ai-pipeline/jmdictPopover'
import type { Token } from '../../../src/core/types'

const tok = (patch: Partial<Token> & { surface: string }): Token => ({
  startIndex: 0,
  endIndex: patch.surface.length,
  ...patch,
})

/**
 * The tap-lookup popover reuses the word-pairer's single-word romaji gloss map as
 * a fallback, which truncates ("past" → "the"), collapses homographs, and misses
 * common words. A dedicated reading-disambiguated popover dictionary fixes these.
 */
describe('lookupWord — dedicated popover dictionary', () => {
  afterEach(() => {
    resetJmdictGlossCache()
    resetJmdictPopoverCache()
  })

  it('shows the full first-sense definition, not the truncated first word', async () => {
    // The romaji map stores only "the" for 過去 (firstGloss of "the past").
    setJmdictGlossForTests({ v: 1, source: 'test', romaji: { kako: 'the' }, kanji: { 過去: 'kako' } })
    setJmdictPopoverForTests({
      v: 1, source: 'test',
      entries: { 過去: [{ r: 'かこ', pos: 'n', g: 'past; bygone days' }] },
    })
    const r = await lookupWord(tok({ surface: '過去', reading: 'カコ', pos: '名詞' }))
    expect(r!.glosses).toEqual(['past', 'bygone days'])
    expect(r!.glosses).not.toContain('the')
  })

  it('glosses an inflected verb through its dictionary-form entry (離れ → leave)', async () => {
    setJmdictGlossForTests({ v: 1, source: 'test', romaji: {}, kanji: {} })
    setJmdictPopoverForTests({
      v: 1, source: 'test',
      entries: { 離れる: [{ r: 'はなれる', pos: 'v', g: 'to leave; to be separated' }] },
    })
    const r = await lookupWord(tok({ surface: '離れ', reading: 'ハナレ', pos: '動詞', baseForm: '離れる' }))
    expect(r!.glosses.join(' ')).toContain('leave')
    expect(r!.glosses.join(' ')).not.toBe('be')
  })

  it('fills a common word the romaji map leaves blank (欲しい → wanted)', async () => {
    setJmdictGlossForTests({ v: 1, source: 'test', romaji: {}, kanji: {} })
    setJmdictPopoverForTests({
      v: 1, source: 'test',
      entries: { 欲しい: [{ r: 'ほしい', pos: 'adj', g: 'wanted; desired' }] },
    })
    const r = await lookupWord(tok({ surface: '欲しい', reading: 'ホシイ', pos: '形容詞', baseForm: '欲しい' }))
    expect(r!.glosses).toEqual(['wanted', 'desired'])
  })

  it('disambiguates a same-surface homograph by the token reading (辛い: つらい → painful)', async () => {
    setJmdictGlossForTests({ v: 1, source: 'test', romaji: {}, kanji: {} })
    setJmdictPopoverForTests({
      v: 1, source: 'test',
      entries: {
        辛い: [
          { r: 'からい', pos: 'adj', g: 'spicy; hot' },
          { r: 'つらい', pos: 'adj', g: 'painful; heartbreaking' },
        ],
      },
    })
    const painful = await lookupWord(tok({ surface: '辛い', reading: 'ツライ', pos: '形容詞', baseForm: '辛い' }))
    expect(painful!.glosses.join(' ')).toContain('painful')
    expect(painful!.glosses).not.toContain('spicy')

    const spicy = await lookupWord(tok({ surface: '辛い', reading: 'カライ', pos: '形容詞', baseForm: '辛い' }))
    expect(spicy!.glosses.join(' ')).toContain('spicy')
  })

  it('falls back to the existing gloss chain when the popover has no entry', async () => {
    // No popover entry for 躱す → the romaji-map path still resolves it.
    setJmdictGlossForTests({ v: 1, source: 'test', romaji: { kawasu: 'to dodge; to evade' }, kanji: { 躱す: 'kawasu' } })
    setJmdictPopoverForTests({ v: 1, source: 'test', entries: {} })
    const r = await lookupWord(tok({ surface: '躱す', reading: 'カワス', pos: '動詞' }))
    expect(r!.glosses).toEqual(['to dodge', 'to evade'])
  })

  it('does not gloss grammar tokens from the popover (は stays a particle)', async () => {
    setJmdictGlossForTests({ v: 1, source: 'test', romaji: {}, kanji: {} })
    setJmdictPopoverForTests({ v: 1, source: 'test', entries: { は: [{ r: 'は', pos: 'n', g: 'edge; tip' }] } })
    const r = await lookupWord(tok({ surface: 'は', reading: 'ハ', pos: '助詞', posDetail1: '係助詞' }))
    expect(r!.glosses.join(' ')).not.toContain('edge')
    expect(r!.glosses.join(' ')).toMatch(/topic/)
  })

  it('recovers a kanji grammar-tagged content word from the popover (度 非自立 → time)', async () => {
    // In 〜度に kuromoji tags 度 as 名詞/非自立, routing it to the grammar path,
    // which suppressed the lexical gloss and left the popover blank.
    setJmdictGlossForTests({ v: 1, source: 'test', romaji: {}, kanji: {} })
    setJmdictPopoverForTests({ v: 1, source: 'test', entries: { 度: [{ r: 'たび', g: 'time; occasion' }] } })
    const r = await lookupWord(tok({ surface: '度', reading: 'タビ', pos: '名詞', posDetail1: '非自立', baseForm: '度' }))
    expect(r!.glosses.join(' ')).toContain('time')
  })

  it('recovers an auxiliary adjective with kanji from the popover (欲しい → wanting)', async () => {
    // In 〜て欲しい kuromoji tags 欲しい as a non-independent adjective.
    setJmdictGlossForTests({ v: 1, source: 'test', romaji: {}, kanji: {} })
    setJmdictPopoverForTests({ v: 1, source: 'test', entries: { 欲しい: [{ r: 'ほしい', g: 'wanting; desired' }] } })
    const r = await lookupWord(tok({ surface: '欲しい', reading: 'ホシイ', pos: '形容詞', posDetail1: '非自立', baseForm: '欲しい' }))
    expect(r!.glosses.join(' ')).toContain('wanting')
  })

  it('never lexicalizes a kana grammar token, even with a matching popover entry', async () => {
    // Real data never keys kana surfaces, but the recovery must be guarded on
    // kanji at runtime so an uncurated kana particle can't inherit a lexical gloss.
    setJmdictGlossForTests({ v: 1, source: 'test', romaji: {}, kanji: {} })
    setJmdictPopoverForTests({ v: 1, source: 'test', entries: { にゃ: [{ r: 'にゃ', g: 'meow' }] } })
    const r = await lookupWord(tok({ surface: 'にゃ', reading: 'ニャ', pos: '助詞' }))
    expect(r!.glosses).toEqual([])
  })
})
