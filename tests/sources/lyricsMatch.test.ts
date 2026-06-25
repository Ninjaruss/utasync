import { describe, it, expect } from 'vitest'
import {
  sameArtist,
  sameTitle,
  titleSimilarity,
  artistSimilarity,
  cleanTitleForSearch,
  expandTitleSearchVariants,
  expandArtistSearchVariants,
  extractTitleSearchPhrases,
  classifyLyricScript,
  lyricScriptScoreAdjust,
  inferPreferredLyricsLanguage,
  needsLyricsMatchConfirmation,
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

  it('normalizes light/lights singular typo', () => {
    const variants = expandTitleSearchVariants('Rockn Roll Morning Lights Falls On You')
    expect(variants.some((v) => /Morning Light Falls/i.test(v))).toBe(true)
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

describe('expandArtistSearchVariants', () => {
  it('includes Japanese spellings and reversed romanized order', () => {
    const variants = expandArtistSearchVariants('Keina Suda')
    expect(variants).toContain('Suda Keina')
    expect(variants).toContain('須田景瑚')
  })

  it('matches romanized and native artist names', () => {
    expect(artistSimilarity('須田景瑚', 'Keina Suda')).toBeGreaterThanOrEqual(0.85)
    expect(sameArtist('Suda Keina', 'Keina Suda')).toBe(true)
  })
})

describe('classifyLyricScript', () => {
  it('detects native Japanese lyrics', () => {
    expect(classifyLyricScript('[00:01.00]君のままで')).toBe('native-ja')
  })

  it('detects romaji transliteration lyrics', () => {
    const romaji = '[00:01.00]Kimi no mama de\n[00:05.00]Boku wa kimi wo mitsuketa'
    expect(classifyLyricScript(romaji)).toBe('romaji')
  })
})

describe('inferPreferredLyricsLanguage', () => {
  it('prefers Japanese for J-pop artists even when app default is English', () => {
    expect(inferPreferredLyricsLanguage('Veil', 'Keina Suda', 'en')).toBe('ja')
  })

  it('prefers English for Latin-script Western titles', () => {
    expect(inferPreferredLyricsLanguage('Blinding Lights', 'The Weeknd', 'ja')).toBe('en')
  })

  it('falls back when only the title is Latin and artist is empty', () => {
    expect(inferPreferredLyricsLanguage('My Song', '', 'ja')).toBe('ja')
  })
})

describe('needsLyricsMatchConfirmation with aliases', () => {
  it('auto-accepts when LRCLIB artist is a known alias spelling', () => {
    expect(needsLyricsMatchConfirmation('Veil', 'Keina Suda', {
      track: 'Veil',
      artist: '須田景瑚',
      matchScore: 0.95,
      matchKind: 'fuzzy',
    })).toBe(false)
  })
})

describe('lyric script ranking', () => {
  it('boosts native Japanese when preferred language is Japanese', () => {
    const native = lyricScriptScoreAdjust('[00:01.00]君のままで', 'ja')
    const romaji = lyricScriptScoreAdjust('[00:01.00]Kimi no mama de boku wa', 'ja')
    expect(native).toBeGreaterThan(romaji)
  })

  it('boosts English when preferred language is English', () => {
    const english = lyricScriptScoreAdjust('[00:01.00]Hello from the other side', 'en')
    const japanese = lyricScriptScoreAdjust('[00:01.00]君のままで', 'en')
    expect(english).toBeGreaterThan(japanese)
  })
})
