import type { Language } from '../core/types'

export interface LyricSiteLink {
  id: string
  label: string
  href: string
}

export type SecondLanguageDirection = 'ja-to-en' | 'en-to-ja'

export interface SecondLanguageSearchSection {
  title: string
  subtitle: string
  pasteHint: string
  links: LyricSiteLink[]
}

function buildSearchQuery(title: string, artist: string, suffix?: string): string {
  const parts = [artist.trim(), title.trim()].filter(Boolean)
  const base = parts.join(' ')
  return suffix ? `${base} ${suffix}`.trim() : base
}

/** Which second-language direction the user is looking for. */
export function getSecondLanguageDirection(sourceLanguage: Language): SecondLanguageDirection {
  return sourceLanguage === 'ja' ? 'ja-to-en' : 'en-to-ja'
}

function buildJaToEnLinks(title: string, artist: string): LyricSiteLink[] {
  const query = buildSearchQuery(title, artist)
  const enc = encodeURIComponent

  return [
    {
      id: 'animelyrics',
      label: 'Animelyrics',
      href: `https://www.animelyrics.com/index.php?action=search&search=${enc(query)}`,
    },
    {
      id: 'lyricstranslate',
      label: 'LyricsTranslate (JA → EN)',
      href: `https://lyricstranslate.com/en/site-search?search=${enc(buildSearchQuery(title, artist, 'english translation'))}`,
    },
  ]
}

function buildEnToJaLinks(title: string, artist: string): LyricSiteLink[] {
  const query = buildSearchQuery(title, artist)
  const enc = encodeURIComponent
  const utatenParams = new URLSearchParams()
  if (artist.trim()) utatenParams.set('artist', artist.trim())
  if (title.trim()) utatenParams.set('title', title.trim())
  const utatenHref = utatenParams.toString()
    ? `https://utaten.com/search?${utatenParams}`
    : 'https://utaten.com/search'

  return [
    {
      id: 'utaten',
      label: 'UtaTen (furigana)',
      href: utatenHref,
    },
    {
      id: 'utanet',
      label: 'Uta-Net',
      href: `https://www.uta-net.com/user/search/index.html?Keyword=${enc(query)}&Aselect=1&Bselect=4`,
    },
    {
      id: 'lrclib',
      label: 'LRCLIB',
      href: title.trim() || artist.trim()
        ? `https://lrclib.net/search?track_name=${enc(title.trim())}&artist_name=${enc(artist.trim())}`
        : 'https://lrclib.net/search',
    },
  ]
}

/** Pre-filled search URLs for the opposite-language lyrics the user needs. */
export function buildSecondLanguageSearchLinks(
  title: string,
  artist: string,
  sourceLanguage: Language = 'ja',
): LyricSiteLink[] {
  return getSecondLanguageDirection(sourceLanguage) === 'ja-to-en'
    ? buildJaToEnLinks(title, artist)
    : buildEnToJaLinks(title, artist)
}

/** Section copy and ordered links for the "find lyrics online" panel. */
export function getSecondLanguageSearchSection(
  title: string,
  artist: string,
  sourceLanguage: Language,
): SecondLanguageSearchSection {
  const direction = getSecondLanguageDirection(sourceLanguage)
  const links = buildSecondLanguageSearchLinks(title, artist, sourceLanguage)

  if (direction === 'ja-to-en') {
    return {
      title: 'Find English translation',
      subtitle: 'Open a site below, then copy the English lines to paste here.',
      pasteHint: 'Paste English translation lines or an LRC block, one line per row…',
      links,
    }
  }

  return {
    title: 'Find Japanese lyrics',
    subtitle: 'Open a site below, then copy the Japanese lines (furigana is fine) to paste here.',
    pasteHint: 'Paste Japanese lyrics or an LRC block, one line per row…',
    links,
  }
}
