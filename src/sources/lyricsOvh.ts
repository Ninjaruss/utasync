import type { Language } from '../core/types'
import { sameArtist, sameTitle, isAlternateLanguage } from './lyricsMatch'

export interface PlainLyricsLookup {
  lrc: string
  synced: false
}

export type LyricsOvhAttemptOutcome = 'found' | 'not-found' | 'timeout' | 'wrong-language' | 'error'

export interface LyricsOvhSearchAttempt {
  artist: string
  title: string
  outcome: LyricsOvhAttemptOutcome
  detail?: string
}

interface OvhLyricsResponse {
  lyrics?: string
  error?: string
}

interface OvhSuggestionItem {
  title: string
  artist: { name: string }
}

interface OvhSuggestResponse {
  data?: OvhSuggestionItem[]
}

/** lyrics.ovh scrapes upstream sites and often responds in 30–50s. */
const LYRICS_TIMEOUT_MS = 55_000
const SUGGEST_TIMEOUT_MS = 50_000

function encodePathSegment(value: string): string {
  return encodeURIComponent(value.trim())
}

type OvhFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'timeout' | 'http-error' | 'network'; status?: number }

async function fetchOvhJson<T>(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<OvhFetchResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...init?.headers },
    })
    if (!res.ok) return { ok: false, reason: 'http-error', status: res.status }
    return { ok: true, data: (await res.json()) as T }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, reason: 'timeout' }
    }
    return { ok: false, reason: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchOvhLyrics(
  artist: string,
  title: string,
): Promise<{ lyrics: string | null; outcome: LyricsOvhAttemptOutcome; detail?: string }> {
  const result = await fetchOvhJson<OvhLyricsResponse>(
    `https://api.lyrics.ovh/v1/${encodePathSegment(artist)}/${encodePathSegment(title)}`,
    LYRICS_TIMEOUT_MS,
  )
  if (!result.ok) {
    const detail =
      result.reason === 'timeout'
        ? `timed out after ${Math.round(LYRICS_TIMEOUT_MS / 1000)}s`
        : result.reason === 'http-error'
          ? `HTTP ${result.status ?? 'error'}`
          : 'network error'
    return {
      lyrics: null,
      outcome: result.reason === 'timeout' ? 'timeout' : 'error',
      detail,
    }
  }
  const lyrics = result.data.lyrics?.trim()
  if (!lyrics) {
    return {
      lyrics: null,
      outcome: 'not-found',
      detail: result.data.error ?? 'empty response',
    }
  }
  return { lyrics, outcome: 'found' }
}

async function suggestOvhTracks(query: string): Promise<Array<{ artist: string; title: string }>> {
  const result = await fetchOvhJson<OvhSuggestResponse>(
    `https://api.lyrics.ovh/suggest/${encodePathSegment(query)}`,
    SUGGEST_TIMEOUT_MS,
  )
  if (!result.ok || !result.data.data?.length) return []
  return result.data.data.map((item) => ({ artist: item.artist.name, title: item.title }))
}

function suggestionMatches(
  suggestion: { artist: string; title: string },
  artistName: string,
  trackName: string,
): boolean {
  return sameArtist(suggestion.artist, artistName) || sameTitle(suggestion.title, trackName)
}

function rankSuggestions(
  suggestions: Array<{ artist: string; title: string }>,
  artistName: string,
  trackName: string,
): Array<{ artist: string; title: string }> {
  return [...suggestions].sort((a, b) => {
    const score = (item: { artist: string; title: string }) => {
      let s = 0
      if (sameTitle(item.title, trackName)) s += 2
      if (sameArtist(item.artist, artistName)) s += 1
      return s
    }
    return score(b) - score(a)
  })
}

function uniqueAttempts(
  attempts: Array<{ artist: string; title: string }>,
): Array<{ artist: string; title: string }> {
  const seen = new Set<string>()
  const out: Array<{ artist: string; title: string }> = []
  for (const attempt of attempts) {
    const key = `${attempt.artist}\0${attempt.title}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(attempt)
  }
  return out
}

/**
 * Plain-text lyrics from Genius, AZLyrics, and other sources aggregated by
 * lyrics.ovh. Useful when LRCLIB only has the primary-language entry.
 */
export async function findSecondLanguageInLyricsOvh(
  trackName: string,
  artistName: string,
  primaryLang: Language | 'other',
  onAttempt?: (attempt: LyricsOvhSearchAttempt) => void,
): Promise<PlainLyricsLookup | null> {
  if (!artistName.trim() || !trackName.trim()) return null

  const trimmedArtist = artistName.trim()
  const trimmedTitle = trackName.trim()

  const suggestQueries = [
    `${trimmedArtist} ${trimmedTitle}`.trim(),
    trimmedTitle,
  ].filter((q, i, arr) => q && arr.indexOf(q) === i)

  const suggestions: Array<{ artist: string; title: string }> = []
  for (const query of suggestQueries.slice(0, 3)) {
    const found = await suggestOvhTracks(query)
    for (const item of found) {
      if (suggestionMatches(item, trimmedArtist, trimmedTitle)) {
        suggestions.push(item)
      }
    }
  }

  const attempts = uniqueAttempts([
    { artist: trimmedArtist, title: trimmedTitle },
    ...rankSuggestions(suggestions, trimmedArtist, trimmedTitle).slice(0, 8),
  ])

  for (const { artist, title } of attempts) {
    const { lyrics, outcome, detail } = await fetchOvhLyrics(artist, title)
    if (!lyrics) {
      onAttempt?.({ artist, title, outcome, detail })
      continue
    }
    if (!isAlternateLanguage(lyrics, primaryLang)) {
      onAttempt?.({ artist, title, outcome: 'wrong-language', detail: 'same script as primary' })
      continue
    }
    onAttempt?.({ artist, title, outcome: 'found' })
    return { lrc: lyrics, synced: false }
  }

  return null
}
