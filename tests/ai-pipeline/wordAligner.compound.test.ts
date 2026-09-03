import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAlignmentUnits } from '../../src/ai-pipeline/wordAligner'
import { setJmdictGlossForTests } from '../../src/ai-pipeline/jmdictGloss'
import type { Token } from '../../src/core/types'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

const tok = (surface: string, pos: string, reading: string, posDetail1?: string): Token => ({
  surface, pos, reading, posDetail1, startIndex: 0, endIndex: surface.length,
})

/**
 * The bound-suffix merge asks the dictionary whether the concatenation is a real
 * word, so JMdict must be injected — node has no fetch for /jmdict-gloss.json,
 * and without this the rule silently never fires and the test would be measuring
 * a state the app never has.
 */
describe('buildAlignmentUnits — bound suffix nouns (JMdict loaded)', () => {
  beforeAll(() => {
    setJmdictGlossForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-gloss.json'), 'utf8')))
  })

  it('merges 殴り+書き into the compound JMdict lists', () => {
    const units = buildAlignmentUnits([
      tok('殴り', '動詞', 'ナグリ', '自立'),
      tok('書き', '名詞', 'ガキ', '接尾'),
    ])
    expect(units).toHaveLength(1)
    expect(units[0].tokenIndices).toEqual([0, 1])
    expect(units[0].embedText).toBe('殴り書き')
    // The point of merging: the compound glosses to "scribble", which reaches
    // the translation's "scribbling" through the gerund rule. Split, the bound
    // 書き romanized to "gaki" and glossed to "brat".
    expect(units[0].glossText).toBe('nagurigaki')
  })

  it('leaves a bound suffix alone when the compound is not a listed word', () => {
    const units = buildAlignmentUnits([
      tok('星', '名詞', 'ホシ', '一般'),
      tok('書き', '名詞', 'ガキ', '接尾'),
    ])
    expect(units).toHaveLength(2)
  })
})
