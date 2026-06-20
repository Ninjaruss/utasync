import type { Language } from '../core/types'
import { detectLanguage } from '../lyrics/bilingual'

export interface LRCLIBResult {
  id: number
  name: string
  artistName: string
  albumName?: string
  duration?: number
  syncedLyrics: string | null
  plainLyrics: string | null
}

export async function searchLRCLIB(
  trackName: string,
  artistName: string
): Promise<LRCLIBResult[]> {
  try {
    const params = new URLSearchParams({ track_name: trackName, artist_name: artistName })
    const res = await fetch(`https://lrclib.net/api/search?${params}`)
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export async function fetchLRCFromLRCLIB(
  trackName: string,
  artistName: string
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ track_name: trackName, artist_name: artistName })
    const res = await fetch(`https://lrclib.net/api/get?${params}`)
    if (!res.ok) return null
    const data: LRCLIBResult = await res.json()
    return data.syncedLyrics ?? null
  } catch {
    return null
  }
}

export interface LyricsLookup {
  lrc: string
  synced: boolean
}

/**
 * Best-effort lyrics lookup for imperfect metadata (e.g. parsed from a YouTube
 * title). Tries the exact /get endpoint, then a fuzzy /search, then a
 * track-only search, always preferring time-synced lyrics so we can align.
 */
export type FindLyricsStage = 'exact' | 'search'

export async function findLyrics(
  trackName: string,
  artistName: string,
  onStage?: (stage: FindLyricsStage) => void,
): Promise<LyricsLookup | null> {
  onStage?.('exact')
  const exact = await fetchLRCFromLRCLIB(trackName, artistName)
  if (exact) return { lrc: exact, synced: true }

  onStage?.('search')
  const queries: Array<Record<string, string>> = [
    { track_name: trackName, artist_name: artistName },
    { q: `${artistName} ${trackName}`.trim() },
    { track_name: trackName },
  ]

  for (const q of queries) {
    const results = await searchLRCLIBRaw(q)
    const synced = results.find((r) => r.syncedLyrics)
    if (synced?.syncedLyrics) return { lrc: synced.syncedLyrics, synced: true }
    const plain = results.find((r) => r.plainLyrics)
    if (plain?.plainLyrics) return { lrc: plain.plainLyrics, synced: false }
  }

  return null
}

/**
 * Best-effort lookup of a *different-language* version of a song's lyrics — e.g.
 * an English or romaji entry to pair with Japanese. Searches LRCLIB and returns
 * the first result whose lyric script differs from `primaryLang`, preferring
 * synced lyrics. Returns null when no alternate-language entry exists.
 *
 * Only same-artist queries are used: a broad title-only search risks matching a
 * different song with the same title in the other language, which would silently
 * attach the wrong translation. When no confident match exists we return null
 * and let the user paste the second language manually.
 */
export type SecondLanguageSearchStage = 'search'

export async function findSecondLanguageLyrics(
  trackName: string,
  artistName: string,
  primaryLang: Language | 'other',
  onStage?: (stage: SecondLanguageSearchStage) => void,
): Promise<LyricsLookup | null> {
  if (!artistName.trim()) return null
  onStage?.('search')
  const queries: Array<Record<string, string>> = [
    { track_name: trackName, artist_name: artistName },
    { q: `${artistName} ${trackName}`.trim() },
  ]

  for (const q of queries) {
    const results = await searchLRCLIBRaw(q)
    for (const r of results) {
      // Guard against unrelated matches: the candidate must be by the same artist.
      if (!sameArtist(r.artistName, artistName)) continue
      const text = r.syncedLyrics ?? r.plainLyrics
      if (!text) continue
      if (detectLanguage(text) !== primaryLang) {
        return { lrc: text, synced: !!r.syncedLyrics }
      }
    }
  }
  return null
}

function sameArtist(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

async function searchLRCLIBRaw(query: Record<string, string>): Promise<LRCLIBResult[]> {
  try {
    const params = new URLSearchParams(query)
    const res = await fetch(`https://lrclib.net/api/search?${params}`)
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}
