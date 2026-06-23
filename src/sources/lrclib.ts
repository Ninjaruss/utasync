import type { Language } from '../core/types'
import {
  sameArtist,
  isAlternateLanguage,
  durationMatches,
  rankByDuration,
  titleSimilarity,
  artistSimilarity,
  expandTitleSearchVariants,
  extractTitleSearchPhrases,
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

export interface LyricsLookupMatch {
  track: string
  artist: string
  /** 0–1 combined title/artist score against the search query. */
  matchScore: number
  matchKind: 'exact' | 'fuzzy'
}

export interface LyricsLookup {
  lrc: string
  synced: boolean
  match?: LyricsLookupMatch
}

function lookupFromResult(
  result: LRCLIBResult,
  lrc: string,
  synced: boolean,
  trackName: string,
  artistName: string,
  matchKind: LyricsLookupMatch['matchKind'],
): LyricsLookup {
  return {
    lrc,
    synced,
    match: {
      track: result.name,
      artist: result.artistName,
      matchScore: lyricsMatchScore(result, trackName, artistName),
      matchKind,
    },
  }
}

async function fetchLRCLIBExact(
  trackName: string,
  artistName: string,
): Promise<LyricsLookup | null> {
  try {
    const params = new URLSearchParams({ track_name: trackName, artist_name: artistName })
    const res = await fetch(`https://lrclib.net/api/get?${params}`)
    if (!res.ok) return null
    const data: LRCLIBResult = await res.json()
    const lrc = data.syncedLyrics ?? data.plainLyrics
    if (!lrc) return null
    return lookupFromResult(data, lrc, !!data.syncedLyrics, trackName, artistName, 'exact')
  } catch {
    return null
  }
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
  targetDurationSec?: number,
): Promise<LyricsLookup | null> {
  onStage?.('exact')
  const exact = await fetchLRCLIBExact(trackName, artistName)
  if (exact) return exact

  onStage?.('search')
  const titleVariants = expandTitleSearchVariants(trackName)
  const queries: Array<Record<string, string>> = []
  const seenQueryKeys = new Set<string>()

  const addQuery = (q: Record<string, string>) => {
    const key = JSON.stringify(q)
    if (seenQueryKeys.has(key)) return
    seenQueryKeys.add(key)
    queries.push(q)
  }

  for (const variant of titleVariants) {
    addQuery({ track_name: variant, artist_name: artistName })
    addQuery({ q: `${artistName} ${variant}`.trim() })
    addQuery({ track_name: variant })
  }

  for (const phrase of extractTitleSearchPhrases(trackName)) {
    addQuery({ q: `${artistName} ${phrase}`.trim() })
    addQuery({ q: phrase })
  }

  let bestSynced: { lookup: LyricsLookup; score: number } | null = null
  let bestPlain: { lookup: LyricsLookup; score: number } | null = null

  for (const q of queries) {
    const results = await searchLRCLIBRaw(q)
    for (const r of results) {
      const score = lyricsMatchScore(r, trackName, artistName, targetDurationSec)
      if (score < 0.55) continue
      if (r.syncedLyrics && (!bestSynced || score > bestSynced.score)) {
        bestSynced = {
          score,
          lookup: lookupFromResult(r, r.syncedLyrics, true, trackName, artistName, 'fuzzy'),
        }
      } else if (r.plainLyrics && (!bestPlain || score > bestPlain.score)) {
        bestPlain = {
          score,
          lookup: lookupFromResult(r, r.plainLyrics, false, trackName, artistName, 'fuzzy'),
        }
      }
    }
    if (bestSynced && bestSynced.score >= 0.9) break
  }

  if (bestSynced) return bestSynced.lookup
  if (bestPlain) return bestPlain.lookup
  return null
}

function lyricsMatchScore(
  result: LRCLIBResult,
  trackName: string,
  artistName: string,
  targetDurationSec?: number,
): number {
  const titleScore = titleSimilarity(result.name, trackName)
  const artistScore = artistSimilarity(result.artistName, artistName)
  let score = titleScore * 0.65 + artistScore * 0.35
  if (targetDurationSec != null && result.duration != null) {
    const diff = Math.abs(result.duration - targetDurationSec)
    if (diff <= 2) score += 0.15
    else if (diff <= 8) score += 0.05
    else score -= Math.min(0.25, diff * 0.01)
  }
  return Math.max(0, Math.min(1, score))
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
