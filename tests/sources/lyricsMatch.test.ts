import { describe, it, expect } from 'vitest'
import {
  sameArtist,
  sameTitle,
  titleSimilarity,
  artistSimilarity,
  cleanTitleForSearch,
  expandTitleSearchVariants,
  extractTitleSearchPhrases,
} from '../../src/sources/lyricsMatch'

describe('titleSimilarity', () => {
  it('treats small typos as similar', () => {
    expect(titleSimilarity('Blinding Lights', 'Blinding Lghts')).toBeGreaterThan(0.8)
    expect(sameTitle('Blinding Lights', 'Blinding Lghts')).toBe(true)
  })

  it('matches rock n roll morning light with onto/on typo', () => {
    const score = titleSimilarity(
      "Rockn' Roll, Morning Light Falls on You",
      'Rock n Roll Morning Light Falls Onto You',
    )
    expect(score).toBeGreaterThan(0.8)
    expect(sameTitle(
      "Rockn' Roll, Morning Light Falls on You",
      'Rock n Roll Morning Light Falls Onto You',
    )).toBe(true)
  })

  it('strips noise for search queries', () => {
    expect(cleanTitleForSearch('My Song (Official Video)')).toBe('My Song')
    expect(cleanTitleForSearch('Track feat. Guest - Official Audio')).toBe('Track')
  })
})

describe('expandTitleSearchVariants', () => {
  it('expands rock n roll and onto/on typos', () => {
    const variants = expandTitleSearchVariants('Rock n Roll Morning Light Falls Onto You')
    expect(variants).toContain('Rock and Roll Morning Light Falls Onto You')
    expect(variants).toContain("Rockn' Roll Morning Light Falls Onto You")
    expect(variants.some((v) => /Falls on You/i.test(v))).toBe(true)
  })
})

describe('extractTitleSearchPhrases', () => {
  it('includes distinctive substring queries for long typo titles', () => {
    const phrases = extractTitleSearchPhrases('Rock n Roll Morning Light Falls Onto You')
    expect(phrases).toContain('Morning Light Falls')
  })
})

describe('sameArtist with multi-artist collabs', () => {
  it('matches collab credits listed in a different order', () => {
    expect(sameArtist('Jay Chou & JJ Lin', 'JJ Lin & Jay Chou')).toBe(true)
  })

  it('matches when one side adds a featured artist', () => {
    expect(sameArtist('Calvin Harris feat. Rihanna', 'Calvin Harris')).toBe(true)
  })

  it('matches "x" and "vs" collab separators regardless of order', () => {
    expect(sameArtist('Artist A x Artist B', 'Artist B x Artist A')).toBe(true)
    expect(artistSimilarity('Artist A vs Artist B', 'Artist B vs Artist A')).toBeGreaterThanOrEqual(0.85)
  })

  it('still rejects unrelated artists', () => {
    expect(sameArtist('Jay Chou & JJ Lin', 'Taylor Swift & Ed Sheeran')).toBe(false)
  })
})
