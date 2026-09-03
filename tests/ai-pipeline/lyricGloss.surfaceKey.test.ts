import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setJmdictGlossForTests } from '../../src/ai-pipeline/jmdictGloss'
import { lemmaGloss } from '../../src/ai-pipeline/lyricGloss'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The pairer resolves a token's gloss through a ROMAJI key, and that key
 * collapses homophones onto a single winner — so 状態 inherited 上体's "upper",
 * 傘 inherited "conical", 血 inherited 乳's "milk", and 荒れ inherited "me"
 * (which could then steal a pronoun's target). The surface-keyed JMdict map
 * built for the tap-lookup popover is not collapsed; `lemmaGloss` consults it
 * before falling back to the romaji key.
 *
 * Node/vitest has no fetch for /jmdict-gloss.json, so the payload must be
 * injected — without this the assertions would measure a gloss state the app
 * never has (see the audit-corpus instrument notes).
 */
describe('lemmaGloss — surface-keyed glosses beat homophone-collapsed romaji keys', () => {
  beforeAll(() => {
    setJmdictGlossForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-gloss.json'), 'utf8')))
  })

  const cases: Array<[romaji: string, surface: string, expected: string]> = [
    ['joutai', '状態', 'state'],      // was 'upper' (上体)
    ['jouhou', '情報', 'information'], // was 'upper'
    ['kasa', '傘', 'umbrella'],        // was 'conical'
    ['chi', '血', 'blood'],            // was 'milk' (乳)
    ['haru', '春', 'spring'],          // was 'stick'
    ['aki', '秋', 'autumn'],           // was the bare romaji 'aki'
    ['fuku', '服', 'clothes'],         // was 'wipe' (拭く)
    ['koko', '此処', 'here'],          // was 'nine'
    ['kata', '肩', 'shoulder'],        // was 'type'
    ['iu', '言う', 'say'],             // was 'do'
    ['sawaru', '触る', 'touch'],       // was 'be'
    ['kachi', '価値', 'value'],        // was 'win'
  ]

  for (const [romaji, surface, expected] of cases) {
    it(`${surface} (${romaji}) glosses to "${expected}"`, () => {
      expect(lemmaGloss(romaji, surface)).toBe(expected)
    })
  }

  it('still lets a curated gloss outrank the surface map', () => {
    // JMdict's romaji winner for 'boku' is the archaic "manservant"; the
    // curated table deliberately pins the pronoun sense.
    expect(lemmaGloss('boku', '僕')).toBe('i')
  })
})
