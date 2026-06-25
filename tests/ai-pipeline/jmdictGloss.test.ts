import { describe, it, expect, beforeEach } from 'vitest'
import { glossMatchesSource, glossMatchesTarget, lemmaGloss, ensureGlossLexicon } from '../../src/ai-pipeline/lyricGloss'
import { resetJmdictGlossCache, setJmdictGlossForTests } from '../../src/ai-pipeline/jmdictGloss'

const JMdictFixture = {
  v: 1,
  source: 'test',
  romaji: {
    sukue: 'save',
    mogaku: 'struggle',
    korogaru: 'roll',
    shiru: 'know',
    shiri: 'buttocks',
    fureru: 'touch',
    fure: 'proclamation',
    tasukeru: 'save',
    tasukeru2: 'help',
    iro: 'colour',
    omou: 'think',
    omoi: 'heavy',
    omoide: 'memories',
    futo: 'suddenly',
    kizuku: 'build',
    kidzuku: 'notice',
    fueru: 'increase',
    hanareru: 'be',
    osamaru: 'die',
  },
  kanji: {
    救: 'tasukeru',
    触れ: 'fure',
    色: 'iro',
  },
}

describe('JMdict gloss integration', () => {
  beforeEach(async () => {
    resetJmdictGlossCache()
    setJmdictGlossForTests(JMdictFixture)
    await ensureGlossLexicon()
  })

  it('falls back to JMdict when curated map has no entry', async () => {
    expect(lemmaGloss('sukue')).toBe('save')
    expect(glossMatchesTarget('mogaku', 'struggle')).toBe(true)
  })

  it('curated ROMAJI_GLOSS overrides JMdict for the same romaji key', async () => {
    // Curated maps korogaru → rolling (poetic AKFG lyrics), not JMdict's "roll".
    expect(lemmaGloss('korogaru')).toBe('roll')
    expect(glossMatchesTarget('korogaru', 'rolling')).toBe(true)
  })

  it('resolves homographs using surface context instead of raw romaji', () => {
    expect(lemmaGloss('shiri', '知り')).toBe('know')
    expect(lemmaGloss('shiri', '尻')).toBe('buttocks')
  })

  it('resolves inflected forms via stem lookup into JMdict lemmas', () => {
    expect(glossMatchesSource({ romaji: 'furenai', surface: '触れない' }, 'untouchable')).toBe(true)
    expect(glossMatchesSource({ romaji: 'shiritakuhanai', surface: '知りたくはない' }, 'know')).toBe(true)
    expect(glossMatchesSource({ romaji: 'sukuenai', surface: '救えない' }, 'unsalvageable')).toBe(true)
    expect(glossMatchesSource({ romaji: 'sukuenai', surface: '救えない' }, 'near-unsalvageable')).toBe(true)
  })

  it('normalizes JMdict UK spellings against US lyric vocabulary', () => {
    expect(glossMatchesSource({ romaji: 'iro', surface: '色' }, 'color')).toBe(true)
  })

  it('uses JMdict kidzuku for 気付く surface over wrong kizuku gloss', () => {
    expect(glossMatchesSource({ romaji: 'kizuku', surface: '気付く' }, 'notice')).toBe(true)
  })
})
