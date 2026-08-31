import type { Language } from '../core/types'
import { fetchJson, type FetchFailure, type FetchResult } from './fetchJson'
import {
  sameArtist,
  isAlternateLanguage,
  durationMatches,
  rankByDuration,
  titleSimilarity,
  artistSimilarity,
  expandTitleSearchVariants,
  expandArtistSearchVariants,
  extractTitleSearchPhrases,
  lyricScriptScoreAdjust,
  classifyLyricScript,
  inferPreferredLyricsLanguage,
} from './lyricsMatch'
import { JAPANESE_RE } from '../lyrics/bilingual'
import { versionAgreement } from './versionMarker'

const LRCLIB_EXACT_CONCURRENCY = 4
const LRCLIB_SEARCH_CONCURRENCY = 3
/** LRCLIB can take 10–20s per request — abort hung calls so the UI can recover. */
const LRCLIB_FETCH_TIMEOUT_MS = 18_000
/** Cap fuzzy search fan-out; sequential LRCLIB calls were taking many minutes. */
const MAX_SEARCH_QUERIES = 24

/**
 * Session cache for LRCLIB requests, keyed on the full URL.
 *
 * A single search fans out to ~70 requests, and every retry (a "Search again",
 * or the user correcting a typo) used to re-fire all of them from zero. Only
 * STABLE outcomes are cached: a success, or a 404 meaning the service answered
 * and has no such entry. A timeout, a 5xx or a 429 is transient and must stay
 * retryable, or "try again in a moment" would be a lie.
 */
const requestCache = new Map<string, FetchResult<unknown>>()

/** Per-lookup state: which failures we saw, and whether to stop asking. */
interface LookupSession { failures: Set<FetchFailure>; haltedBy: FetchFailure | null }
let session: LookupSession | null = null

/** Test seam — the cache is process-lifetime, so tests must be able to clear it. */
export function __resetLyricsRequestCache(): void {
  requestCache.clear()
}

async function cachedFetchJson<T>(url: string): Promise<FetchResult<T>> {
  // Once the service is refusing us or the device is offline, every further
  // request is waste and rudeness. Brake the whole fan-out rather than marching
  // through the remaining queries collecting identical refusals.
  if (session?.haltedBy) return { ok: false, reason: session.haltedBy }

  const hit = requestCache.get(url)
  if (hit) {
    if (!hit.ok) session?.failures.add(hit.reason)
    return hit as FetchResult<T>
  }
  const r = await fetchJson<T>(url, undefined, LRCLIB_FETCH_TIMEOUT_MS)
  if (r.ok || r.reason === 'not-found') requestCache.set(url, r as FetchResult<unknown>)
  if (!r.ok && session) {
    session.failures.add(r.reason)
    if (r.reason === 'rate-limited' || r.reason === 'offline') session.haltedBy = r.reason
  }
  return r
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(limit, items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const i = nextIndex++
        results[i] = await fn(items[i]!, i)
      }
    }),
  )

  return results
}

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
  const params = new URLSearchParams({ track_name: trackName, artist_name: artistName })
  const r = await cachedFetchJson<LRCLIBResult[]>(`https://lrclib.net/api/search?${params}`)
  return r.ok ? r.data : []
}

export async function fetchLRCFromLRCLIB(
  trackName: string,
  artistName: string
): Promise<string | null> {
  const params = new URLSearchParams({ track_name: trackName, artist_name: artistName })
  const r = await cachedFetchJson<LRCLIBResult>(`https://lrclib.net/api/get?${params}`)
  return r.ok ? (r.data.syncedLyrics ?? null) : null
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
    const r = await cachedFetchJson<LRCLIBResult>(`https://lrclib.net/api/get?${params}`)
    if (!r.ok) return null
    const data = r.data
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

/** Why a lookup ended the way it did — so the UI can stop guessing. */
export type LookupOutcome = 'found' | 'no-entry' | 'offline' | 'rate-limited' | 'error'

export interface LyricsLookupResult {
  lookup: LyricsLookup | null
  outcome: LookupOutcome
}

function outcomeFrom(found: boolean, failures: Set<FetchFailure>): LookupOutcome {
  if (found) return 'found'
  if (failures.has('rate-limited')) return 'rate-limited'
  if (failures.has('offline')) return 'offline'
  // 'not-found' is the service answering honestly; anything else is us failing
  // to ask properly, which is a different thing to tell the user.
  const onlyNotFound = [...failures].every((f) => f === 'not-found')
  return onlyNotFound ? 'no-entry' : 'error'
}

type ScoredLyricsCandidate = {
  lookup: LyricsLookup
  score: number
  synced: boolean
}

function effectiveLyricsScore(score: number, lrc: string, preferredLanguage: Language): number {
  // Strong metadata matches should not lose to a weaker hit in another script.
  const weight = score >= 0.92 ? 0.25 : 1
  return score + lyricScriptScoreAdjust(lrc, preferredLanguage) * weight
}

function pickBestCandidate(
  candidates: ScoredLyricsCandidate[],
  preferredLanguage: Language,
): ScoredLyricsCandidate | null {
  if (candidates.length === 0) return null
  return [...candidates].sort(
    (a, b) => effectiveLyricsScore(b.score, b.lookup.lrc, preferredLanguage)
      - effectiveLyricsScore(a.score, a.lookup.lrc, preferredLanguage),
  )[0]
}

function shouldAcceptEarly(
  candidate: ScoredLyricsCandidate,
  preferredLanguage: Language,
): boolean {
  if (candidate.score < 0.85) return false
  if (candidate.score >= 0.94) return true
  const script = classifyLyricScript(candidate.lookup.lrc)
  if (preferredLanguage === 'ja') {
    return script === 'native-ja'
  }
  if (script === 'native-ja' || script === 'romaji') return false
  return candidate.score >= 0.85
}

function buildSearchQueries(
  titleVariants: string[],
  artistVariants: string[],
  trackName: string,
  artistName: string,
): Array<Record<string, string>> {
  const queries: Array<Record<string, string>> = []
  const seenQueryKeys = new Set<string>()

  const addQuery = (q: Record<string, string>) => {
    if (queries.length >= MAX_SEARCH_QUERIES) return
    const key = JSON.stringify(q)
    if (seenQueryKeys.has(key)) return
    seenQueryKeys.add(key)
    queries.push(q)
  }

  const primaryArtist = artistName.trim() || artistVariants[0] || ''
  const primaryTitle = titleVariants[0] ?? trackName.trim()
  const cleanedTitle = titleVariants.find((v) => v !== primaryTitle) ?? primaryTitle
  const searchArtists = [
    primaryArtist,
    ...artistVariants.filter((a) => a !== primaryArtist),
  ].slice(0, 3)
  const searchTitles = [primaryTitle, cleanedTitle].filter((t, i, arr) => t && arr.indexOf(t) === i)
  const phrases = extractTitleSearchPhrases(trackName, 3, 6)

  // Distinctive phrase + artist first — best for typo titles (AKFG rock song, etc.).
  for (const phrase of phrases.slice(0, 4)) {
    if (primaryArtist) addQuery({ q: `${primaryArtist} ${phrase}`.trim() })
  }
  for (const artist of searchArtists) {
    for (const title of searchTitles) {
      addQuery({ track_name: title, artist_name: artist })
    }
  }
  for (const phrase of phrases.slice(0, 3)) {
    addQuery({ q: phrase })
  }
  for (const artist of searchArtists.slice(0, 2)) {
    for (const title of searchTitles) {
      addQuery({ q: `${artist} ${title}`.trim() })
    }
    for (const variant of titleVariants.slice(0, 3)) {
      if (variant === primaryTitle || variant === cleanedTitle) continue
      addQuery({ track_name: variant, artist_name: artist })
    }
  }

  if (!artistName.trim()) {
    for (const phrase of phrases) addQuery({ q: phrase })
  }

  return queries
}

/** Process LRCLIB search queries concurrently; stops launching new ones once `shouldStop` is true. */
async function runPrioritizedSearch(
  queries: Array<Record<string, string>>,
  onResults: (results: LRCLIBResult[]) => void,
  shouldStop: () => boolean,
): Promise<void> {
  if (queries.length === 0 || shouldStop()) return
  let nextIndex = 0
  const workerCount = Math.min(LRCLIB_SEARCH_CONCURRENCY, queries.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < queries.length && !shouldStop()) {
        const i = nextIndex++
        const results = await searchLRCLIBRaw(queries[i]!)
        if (shouldStop()) return
        onResults(results)
      }
    }),
  )
}

export async function findLyrics(
  trackName: string,
  artistName: string,
  onStage?: (stage: FindLyricsStage) => void,
  targetDurationSec?: number,
  preferredLanguageHint?: Language,
): Promise<LyricsLookupResult> {
  const outer = session
  const mine: LookupSession = { failures: new Set(), haltedBy: null }
  session = mine
  try {
    const lookup = await findLyricsInner(
      trackName, artistName, onStage, targetDurationSec, preferredLanguageHint,
    )
    return { lookup, outcome: outcomeFrom(!!lookup, mine.failures) }
  } finally {
    session = outer
  }
}

async function findLyricsInner(
  trackName: string,
  artistName: string,
  onStage?: (stage: FindLyricsStage) => void,
  targetDurationSec?: number,
  preferredLanguageHint?: Language,
): Promise<LyricsLookup | null> {
  const preferredLanguage = preferredLanguageHint
    ?? inferPreferredLyricsLanguage(trackName, artistName)
  const preferNativeJa = preferredLanguage === 'ja'
  const titleVariants = expandTitleSearchVariants(trackName)
  const artistVariants = expandArtistSearchVariants(artistName)
  const candidates: ScoredLyricsCandidate[] = []

  const considerResult = (
    result: LRCLIBResult,
    lrc: string,
    synced: boolean,
    matchKind: LyricsLookupMatch['matchKind'],
  ) => {
    const score = lyricsMatchScore(result, trackName, artistName, targetDurationSec)
    if (score < 0.55) return
    candidates.push({
      score,
      synced,
      lookup: lookupFromResult(result, lrc, synced, trackName, artistName, matchKind),
    })
  }

  onStage?.('exact')
  const primaryExact = await fetchLRCLIBExact(trackName, artistName)
  if (primaryExact) {
    candidates.push({
      lookup: primaryExact,
      score: primaryExact.match?.matchScore ?? 1,
      synced: primaryExact.synced,
    })
    const earlyPrimary = pickBestCandidate(candidates.filter((c) => c.synced), preferredLanguage)
      ?? pickBestCandidate(candidates, preferredLanguage)
    if (earlyPrimary && shouldAcceptEarly(earlyPrimary, preferredLanguage)) {
      return earlyPrimary.lookup
    }
  }

  // Fan out title/artist variants in parallel (capped concurrency).
  const exactPairs = artistVariants.flatMap((artist) =>
    titleVariants.slice(0, 4).map((title) => ({ artist, title })),
  )
  const exactResults = await mapConcurrent(
    exactPairs,
    LRCLIB_EXACT_CONCURRENCY,
    ({ artist, title }) => fetchLRCLIBExact(title, artist),
  )
  exactResults.forEach((exact, i) => {
    if (!exact) return
    const { artist, title } = exactPairs[i]
    const score = exact.match?.matchScore ?? lyricsMatchScore(
      { id: 0, name: exact.match?.track ?? title, artistName: exact.match?.artist ?? artist, syncedLyrics: exact.synced ? exact.lrc : null, plainLyrics: exact.synced ? null : exact.lrc },
      trackName,
      artistName,
      targetDurationSec,
    )
    candidates.push({ lookup: exact, score, synced: exact.synced })
  })

  const earlyExact = pickBestCandidate(candidates.filter((c) => c.synced), preferredLanguage)
    ?? pickBestCandidate(candidates, preferredLanguage)
  if (earlyExact && shouldAcceptEarly(earlyExact, preferredLanguage)) {
    return earlyExact.lookup
  }

  onStage?.('search')
  const discoveredArtists = new Set(artistVariants)
  const searchQueries = buildSearchQueries(titleVariants, artistVariants, trackName, artistName)

  const ingestResults = (results: LRCLIBResult[]) => {
    for (const r of results) {
      if (r.artistName?.trim() && artistSimilarity(r.artistName, artistName) >= 0.85) {
        discoveredArtists.add(r.artistName.trim())
      }
      if (r.syncedLyrics) {
        considerResult(r, r.syncedLyrics, true, 'fuzzy')
      } else if (r.plainLyrics) {
        considerResult(r, r.plainLyrics, false, 'fuzzy')
      }
    }
  }

  const shouldStopSearch = () => {
    // Stop on success OR on refusal. The original only stopped on success, so a
    // rate-limited client still marched through every remaining query.
    if (session?.haltedBy) return true
    const bestSynced = pickBestCandidate(candidates.filter((c) => c.synced), preferredLanguage)
    return !!(bestSynced && shouldAcceptEarly(bestSynced, preferredLanguage))
  }

  await runPrioritizedSearch(searchQueries, ingestResults, shouldStopSearch)

  if (preferNativeJa && !shouldStopSearch()) {
    const japaneseArtists = [...discoveredArtists].filter(
      (a) => JAPANESE_RE.test(a) && !artistVariants.includes(a),
    )
    if (japaneseArtists.length > 0) {
      const jaQueries = buildSearchQueries(titleVariants, japaneseArtists, trackName, artistName)
      await runPrioritizedSearch(jaQueries, ingestResults, shouldStopSearch)
    }
  }

  const bestSynced = pickBestCandidate(candidates.filter((c) => c.synced), preferredLanguage)
  if (bestSynced) return bestSynced.lookup
  const bestPlain = pickBestCandidate(candidates.filter((c) => !c.synced), preferredLanguage)
  if (bestPlain) return bestPlain.lookup
  return null
}

export function lyricsMatchScore(
  result: LRCLIBResult,
  trackName: string,
  artistName: string,
  targetDurationSec?: number,
): number {
  const titleScore = titleSimilarity(result.name, trackName)
  const artistScore = artistSimilarity(result.artistName, artistName)
  let score = titleScore * 0.65 + artistScore * 0.35
  // Which recording this is, not just which song. Neutral (0) when neither title
  // declares a version, so the common case scores exactly as it did before.
  score += versionAgreement(trackName, result.name)
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
  const params = new URLSearchParams(query)
  const r = await cachedFetchJson<LRCLIBResult[]>(`https://lrclib.net/api/search?${params}`)
  return r.ok ? r.data : []
}
