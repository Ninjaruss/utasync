import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lookupWord } from '../../../src/language/japanese/wordLookup'
import { setJmdictGlossForTests, resetJmdictGlossCache } from '../../../src/ai-pipeline/jmdictGloss'
import { setJmdictPopoverForTests, resetJmdictPopoverCache } from '../../../src/ai-pipeline/jmdictPopover'
import { setJmdictReadingsForTests } from '../../../src/language/japanese/jmdictReadings'
import type { Token } from '../../../src/core/types'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

const tok = (patch: Partial<Token> & { surface: string }): Token => ({
  startIndex: 0, endIndex: patch.surface.length, ...patch,
})

/**
 * Runs against the REAL shipped dictionaries, because these defects were in the
 * data as much as the resolver — a hand-written fixture would have passed while
 * the app stayed wrong.
 *
 * A surface routinely means different things as different word classes, and the
 * popover used to show the entry's first sense regardless of how the word was
 * used in the line.
 */
describe('tap lookup — part-of-speech disambiguation', () => {
  beforeAll(() => {
    setJmdictGlossForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-gloss.json'), 'utf8')))
    setJmdictPopoverForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-popover.json'), 'utf8')))
    setJmdictReadingsForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-readings.json'), 'utf8')))
  })
  afterEach(() => { /* keep the shipped payloads for the whole file */ })

  const first = async (t: Token) => (await lookupWord(t))!.glosses[0]?.toLowerCase() ?? ''

  it('reads an interjection as one, not as the particle spelled the same', async () => {
    // ねえ is keyed common only as ね, so the colloquial negative ない owned the
    // ねえ spelling entirely: the popover said "nonexistent".
    expect(await first(tok({ surface: 'ねえ', pos: '感動詞', reading: 'ネエ' }))).toContain('hey')
    expect(await first(tok({ surface: 'ああ', pos: '感動詞', reading: 'アア' }))).toContain('ah')
    expect(await first(tok({ surface: 'さよなら', pos: '感動詞', reading: 'サヨナラ' }))).toContain('goodbye')
  })

  it('reads an adverb as one, not as the counter or noun', async () => {
    expect(await first(tok({ surface: 'いっぱい', pos: '副詞', posDetail1: '一般', reading: 'イッパイ' }))).toContain('fully')
    expect(await first(tok({ surface: 'ひとり', pos: '副詞', posDetail1: '一般', reading: 'ヒトリ' }))).toContain('by oneself')
  })

  it('reads a conjunction as one', async () => {
    expect(await first(tok({ surface: 'ただ', pos: '接続詞', reading: 'タダ' }))).toContain('but')
  })

  it('reads a na-adjective stem adjectivally, not as the noun', async () => {
    // kuromoji tags these 名詞-形容動詞語幹; the noun senses are "flattery",
    // "change", "inevitable death", "idiot".
    expect(await first(tok({ surface: '上手', pos: '名詞', posDetail1: '形容動詞語幹', reading: 'ジョウズ' }))).toContain('skillful')
    expect(await first(tok({ surface: '変', pos: '名詞', posDetail1: '形容動詞語幹', reading: 'ヘン' }))).toContain('strange')
    expect(await first(tok({ surface: '馬鹿', pos: '名詞', posDetail1: '形容動詞語幹', reading: 'バカ' }))).toContain('stupid')
  })

  it('leaves plain nouns on JMdict ordering rather than forcing the noun class', async () => {
    // Forcing 'n' skipped past the entry's leading sense to a rarer one:
    // 金輪際 "ever" → "deepest bottom of the earth", 日々 "daily" → "days".
    expect(await first(tok({ surface: '金輪際', pos: '名詞', posDetail1: '一般', reading: 'コンリンザイ' }))).toContain('ever')
    expect(await first(tok({ surface: '日々', pos: '名詞', posDetail1: '副詞可能', reading: 'ヒビ' }))).toContain('daily')
  })

  it('keeps the causative auxiliary from losing its spelling to a homophone verb', async () => {
    // せる had no common kana form, so 競る "to compete" owned the key.
    expect(await first(tok({ surface: 'せる', pos: '動詞', posDetail1: '接尾', reading: 'セル' }))).toContain('causative')
  })

  it('still lets the reading decide between homographs', async () => {
    // Reading outranks POS: both are 形容詞, and only the reading separates them.
    expect(await first(tok({ surface: '辛い', pos: '形容詞', posDetail1: '自立', reading: 'カライ' }))).toContain('spicy')
    expect(await first(tok({ surface: '辛い', pos: '形容詞', posDetail1: '自立', reading: 'ツライ' }))).toContain('painful')
  })

  it('gives a full definition where the pairer gloss was one truncated word', async () => {
    expect(await first(tok({ surface: 'それどころか', pos: '接続詞', reading: 'ソレドコロカ' }))).toContain('on the contrary')
    expect(await first(tok({ surface: 'ぶちまけ', pos: '動詞', posDetail1: '自立', baseForm: 'ぶちまける', reading: 'ブチマケ' }))).toContain('dump')
  })
})

/**
 * kuromoji tags a dependent word 非自立 whether it is a grammar particle or an
 * ordinary content word, and the popover blanked all of them — a blunt guard
 * against kana homophones (は glossing as 端 "edge"). Requiring an exact word
 * class is the precise version of that guard.
 */
describe('tap lookup — words that used to come back blank', () => {
  beforeAll(() => {
    setJmdictGlossForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-gloss.json'), 'utf8')))
    setJmdictPopoverForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-popover.json'), 'utf8')))
    setJmdictReadingsForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-readings.json'), 'utf8')))
  })

  const first = async (t: Token) => (await lookupWord(t))!.glosses[0]?.toLowerCase() ?? ''

  it('answers a dependent-tagged content word', async () => {
    expect(await first(tok({ surface: 'いい', pos: '形容詞', posDetail1: '非自立', reading: 'イイ' }))).toContain('good')
    expect(await first(tok({ surface: 'つづけ', pos: '動詞', posDetail1: '非自立', baseForm: 'つづける', reading: 'ツヅケ' }))).toContain('continue')
    expect(await first(tok({ surface: 'みせる', pos: '動詞', posDetail1: '非自立', reading: 'ミセル' }))).toContain('show')
  })

  it('answers particles the grammar glossary had no entry for', async () => {
    expect(await first(tok({ surface: 'さえ', pos: '助詞', posDetail1: '係助詞', reading: 'サエ' }))).toContain('even')
    expect(await first(tok({ surface: 'なんて', pos: '助詞', posDetail1: '副助詞', reading: 'ナンテ' }))).toContain('like')
  })

  it('undoes a potential form JMdict does not list as an entry', async () => {
    // JMdict has 出す and 廻る but no 出せる / 廻れる, and kuromoji reports the
    // potential AS the base form, so the lookup asked for a word the dictionary
    // has never contained.
    expect(await first(tok({ surface: '出せ', pos: '動詞', posDetail1: '自立', baseForm: '出せる', reading: 'ダセ' }))).toContain('take out')
    expect(await first(tok({ surface: '廻れ', pos: '動詞', posDetail1: '自立', baseForm: '廻れる', reading: 'マワレ' }))).toContain('go around')
  })

  it('does not rewrite a verb that IS a dictionary entry in its own right', async () => {
    // 見せる and 続ける end in -eru but are real entries; deinflecting them to
    // 見す / 続く would be wrong, so the plain-form fallback runs only after a
    // direct hit fails.
    expect(await first(tok({ surface: '見せる', pos: '動詞', posDetail1: '自立', reading: 'ミセル' }))).toContain('show')
    expect(await first(tok({ surface: '続ける', pos: '動詞', posDetail1: '自立', reading: 'ツヅケル' }))).toContain('continue')
  })

  it('prefers a curated grammar gloss over a misleading dictionary noun sense', async () => {
    // Left to the dictionary these resolved to "some" and "thing (thought or
    // spoken)" — worse than showing nothing.
    expect(await first(tok({ surface: 'ん', pos: '名詞', posDetail1: '非自立', reading: 'ン' }))).toContain('nominalizer')
    expect(await first(tok({ surface: 'よう', pos: '名詞', posDetail1: '非自立', reading: 'ヨウ' }))).toContain('seems')
  })

  it('still refuses to give a bare particle a lexical meaning', async () => {
    // The homophone the old blanket guard existed to prevent: は must never
    // resolve to 端 "edge".
    const ha = await first(tok({ surface: 'は', pos: '助詞', posDetail1: '係助詞', reading: 'ハ' }))
    expect(ha).not.toContain('edge')
    expect(ha).toContain('topic')
  })
})

/**
 * Committing to one definition made every disambiguation call user-visible:
 * pick wrong and the reader had no way to reach the sense they wanted. Listing
 * the senses defuses that — the right one is on screen either way.
 */
describe('tap lookup — every sense, best match first', () => {
  beforeAll(() => {
    setJmdictGlossForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-gloss.json'), 'utf8')))
    setJmdictPopoverForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-popover.json'), 'utf8')))
    setJmdictReadingsForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-readings.json'), 'utf8')))
  })

  it('leads with the tapped word class and keeps the others', async () => {
    const r = (await lookupWord(tok({ surface: 'いっぱい', pos: '副詞', posDetail1: '一般', reading: 'イッパイ' })))!
    expect(r.senses.length).toBeGreaterThan(1)
    expect(r.senses[0].posLabel).toBe('adverb')
    expect(r.senses[0].glosses[0]).toContain('fully')
    // The counter sense is still reachable rather than being the only one shown.
    expect(r.senses.some((s) => s.glosses.join(' ').includes('one cup'))).toBe(true)
  })

  it('keeps glosses in step with the first sense', async () => {
    const r = (await lookupWord(tok({ surface: 'ただ', pos: '接続詞', reading: 'タダ' })))!
    expect(r.glosses).toEqual(r.senses[0].glosses)
  })

  it('labels every sense the dictionary supplies, including the leading one', async () => {
    // 前 is a plain noun and expresses no class preference, so the leading sense
    // must take its label from the dictionary rather than the token.
    const r = (await lookupWord(tok({ surface: '前', pos: '名詞', posDetail1: '一般', reading: 'マエ' })))!
    expect(r.senses[0].posLabel).toBe('noun')
    expect(r.senses.every((s) => s.glosses.length > 0)).toBe(true)
  })

  it('does not list the same sense twice when sources word it differently', async () => {
    // The sparse kanji map has 空 "sky"; the popover has "sky; the air; the
    // heavens". They are one sense, and listing both showed the word twice.
    const r = (await lookupWord(tok({ surface: '空', pos: '名詞', posDetail1: '一般', reading: 'ソラ' })))!
    const leads = r.senses.map((s) => s.glosses[0].toLowerCase())
    expect(new Set(leads).size).toBe(leads.length)
  })

  it('never offers a grammar word an unrelated homograph sense', async () => {
    // は shares its kana with 歯 "tooth" and 端 "edge", which no reading can
    // separate — the alternatives list is off for grammar words entirely.
    const r = (await lookupWord(tok({ surface: 'は', pos: '助詞', posDetail1: '係助詞', reading: 'ハ' })))!
    expect(r.senses).toHaveLength(1)
    expect(r.senses[0].glosses.join(' ')).toContain('topic')
    expect(JSON.stringify(r.senses)).not.toContain('tooth')
  })
})
