import { describe, it, expect } from 'vitest'
import {
  buildSecondLanguageSearchLinks,
  getSecondLanguageDirection,
  getSecondLanguageSearchSection,
} from '../../src/lyrics/lyricSiteLinks'

describe('lyricSiteLinks', () => {
  it('returns ja-to-en links for Japanese source songs', () => {
    const links = buildSecondLanguageSearchLinks('Renai Circulation', 'Kana Hanazawa', 'ja')
    expect(links.map((l) => l.id)).toEqual(['animelyrics', 'lyricstranslate'])
    expect(links[0].href).toContain('animelyrics.com')
    expect(links[1].href).toContain('lyricstranslate.com')
  })

  it('returns en-to-ja links for English source songs', () => {
    const links = buildSecondLanguageSearchLinks('My Eyes Only', 'Test Artist', 'en')
    expect(links.map((l) => l.id)).toEqual(['utaten', 'utanet', 'lrclib'])
    expect(links[0].href).toContain('utaten.com')
    expect(links[1].href).toContain('uta-net.com')
    expect(links[2].href).toContain('lrclib.net')
  })

  it('pre-fills UtaTen search with artist and title params', () => {
    const links = buildSecondLanguageSearchLinks('My Eyes Only', 'Test Artist', 'en')
    const utaten = links.find((l) => l.id === 'utaten')!
    expect(utaten.href).toContain('artist=Test+Artist')
    expect(utaten.href).toContain('title=My+Eyes+Only')
  })

  it('pre-fills LRCLIB search with track and artist params', () => {
    const links = buildSecondLanguageSearchLinks('My Eyes Only', 'Test Artist', 'en')
    const lrclib = links.find((l) => l.id === 'lrclib')!
    const url = new URL(lrclib.href)
    expect(url.searchParams.get('track_name')).toBe('My Eyes Only')
    expect(url.searchParams.get('artist_name')).toBe('Test Artist')
  })

  it('derives search direction from source language', () => {
    expect(getSecondLanguageDirection('ja')).toBe('ja-to-en')
    expect(getSecondLanguageDirection('en')).toBe('en-to-ja')
  })

  it('provides section copy tailored to search direction', () => {
    const jaSection = getSecondLanguageSearchSection('t', 'a', 'ja')
    expect(jaSection.title).toMatch(/english translation/i)
    expect(jaSection.pasteHint).toMatch(/english translation/i)

    const enSection = getSecondLanguageSearchSection('t', 'a', 'en')
    expect(enSection.title).toMatch(/japanese lyrics/i)
    expect(enSection.pasteHint).toMatch(/japanese lyrics/i)
  })
})
