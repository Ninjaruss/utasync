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
