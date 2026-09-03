import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alignableEnglishTargetPool } from '../../src/lyrics/lineAligner'
import { setJmdictGlossForTests } from '../../src/ai-pipeline/jmdictGloss'
import type { Token } from '../../src/core/types'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

const tok = (surface: string, pos: string, reading: string, posDetail1?: string): Token => ({
  surface, pos, reading, posDetail1, startIndex: 0, endIndex: surface.length,
})

/**
 * A function word may be an alignment target only in a line where some token
 * actually means it. The allowlist alone used to decide this, which handed every
 * line a free target for the embedding to land on regardless of content.
 */
describe('alignableEnglishTargetPool — function-word targets', () => {
  beforeAll(() => {
    setJmdictGlossForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-gloss.json'), 'utf8')))
  })

  const EN = ['But', 'you', 'know', 'maybe', 'a', 'little', 'of', 'that', 'too']

  it('offers "but" to a line containing だけど', () => {
    const tokens = [tok('だけど', '接続詞', 'ダケド'), tok('ちょっと', '副詞', 'チョット')]
    expect(alignableEnglishTargetPool(EN, 0, tokens).words).toContain('but')
  })

  it('withholds it from a line whose tokens mean nothing of the sort', () => {
    const tokens = [tok('星', '名詞', 'ホシ', '一般'), tok('空', '名詞', 'ソラ', '一般')]
    expect(alignableEnglishTargetPool(EN, 0, tokens).words).not.toContain('but')
  })

  it('withholds it when no tokens are supplied at all', () => {
    expect(alignableEnglishTargetPool(EN, 0).words).not.toContain('but')
  })

  it('never admits a function word outside the curated set, whatever the line', () => {
    // 1654 JMdict keys store "the" as their gloss and 1470 store "be" — mostly
    // homophone and first-word artifacts — so admitting on gloss evidence alone
    // produced 出来 → "the" and する → "the".
    const words = ['The', 'sound', 'is', 'a', 'scribble']
    const tokens = [tok('出来', '動詞', 'デキ', '自立'), tok('する', '動詞', 'スル', '自立')]
    const pool = alignableEnglishTargetPool(words, 0, tokens).words
    expect(pool).not.toContain('the')
    expect(pool).not.toContain('is')
    expect(pool).toContain('sound')
    expect(pool).toContain('scribble')
  })

  it('keeps content words and the index map aligned to the full translation', () => {
    const tokens = [tok('だけど', '接続詞', 'ダケド')]
    const { words, indexMap } = alignableEnglishTargetPool(EN, 0, tokens)
    expect(words).toContain('little')
    // 'a' and 'of' are function words nothing here means.
    expect(words).not.toContain('a')
    expect(words).not.toContain('of')
    expect(words.length).toBe(indexMap.length)
    // Every mapped index points back at the word it came from.
    words.forEach((w, i) => expect(EN[indexMap[i]].toLowerCase()).toBe(w))
  })
})
