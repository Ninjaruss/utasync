import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setJmdictGlossForTests, getJmdictAltGlosses } from '../../src/ai-pipeline/jmdictGloss'
import { glossMatchStrength, lemmaGloss, ALT_GLOSS_SCORE } from '../../src/ai-pipeline/lyricGloss'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * One gloss per key means a polysemous word can only ever match one English
 * word. 前 is the worked example: JMdict's winning sense is "in front (of)" and
 * a curated entry pins the temporal "before", so a line saying "in front of you"
 * had no lexical match at all and the token fell to embedding noise ("Far").
 *
 * JMdict must be injected — node has no fetch for /jmdict-gloss.json.
 */
describe('secondary dictionary senses', () => {
  beforeAll(() => {
    setJmdictGlossForTests(JSON.parse(readFileSync(join(ROOT, 'public/jmdict-gloss.json'), 'utf8')))
  })

  it('reaches a sense the stored gloss does not carry', () => {
    // The curated primary still answers lemmaGloss...
    expect(lemmaGloss('mae', '前')).toBe('before')
    // ...and still scores a full match on its own sense.
    expect(glossMatchStrength({ romaji: 'mae', surface: '前' }, 'before')).toBe(1)
    // The other sense is now reachable, just ranked below the primary.
    expect(glossMatchStrength({ romaji: 'mae', surface: '前' }, 'front')).toBe(ALT_GLOSS_SCORE)
    expect(ALT_GLOSS_SCORE).toBeLessThan(1)
  })

  it('keeps the alt list sparse and ranked, not a synonym dump', () => {
    // Only entries meaning something beyond their stored gloss get a list, and
    // it holds one leading word per sense rather than every synonym in a sense.
    expect(getJmdictAltGlosses('mae')).toEqual(['front', 'before'])
    // Single-sense function words gain nothing.
    expect(getJmdictAltGlosses('dakedo')).toEqual([])
  })

  it('does not invent a match for an unrelated word', () => {
    expect(glossMatchStrength({ romaji: 'mae', surface: '前' }, 'guitar')).toBe(0)
    expect(glossMatchStrength({ romaji: 'mae', surface: '前' }, 'shower')).toBe(0)
  })

  it('leaves an entry whose meaning IS a function word alone', () => {
    // The alt picker prefers content words; だけど must still gloss to "but".
    expect(glossMatchStrength({ romaji: 'dakedo', surface: 'だけど' }, 'but')).toBe(1)
  })
})
