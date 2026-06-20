import type { Language } from '../core/types'
import {
  sameArtist,
  isAlternateLanguage,
  durationMatches,
  rankByDuration,
} from './lyricsMatch'

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
 * LRCLIB-only lookup of a *different-language* version of a song's lyrics.
 * Prefer synced lyrics and, when provided, results whose duration matches
 * within ±2 seconds. Returns null when no alternate-language LRCLIB entry exists.
 */
export async function findSecondLanguageInLRCLIB(
  trackName: string,
  artistName: string,
  primaryLang: Language | 'other',
  durationSec?: number,
): Promise<LyricsLookup | null> {
  if (!artistName.trim()) return null
  const queries: Array<Record<string, string>> = [
    { track_name: trackName, artist_name: artistName },
    { q: `${artistName} ${trackName}`.trim() },
    { track_name: trackName },
  ]

  for (const q of queries) {
    const results = rankByDuration(await searchLRCLIBRaw(q), durationSec)
    for (const r of results) {
      if (!sameArtist(r.artistName, artistName)) continue
      if (!durationMatches(r.duration, durationSec)) continue
      const text = r.syncedLyrics ?? r.plainLyrics
      if (!text || !isAlternateLanguage(text, primaryLang)) continue
      return { lrc: text, synced: !!r.syncedLyrics }
    }
  }
  return null
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
