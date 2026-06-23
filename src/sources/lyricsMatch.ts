import type { Language } from '../core/types'
import { detectLanguage } from '../lyrics/bilingual'

function normalizeArtistKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/g, '')
}

function normalizeTitleKey(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/g, '')
}

function levenshteinRatio(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const rows = a.length + 1
  const cols = b.length + 1
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i++) matrix[i][0] = i
  for (let j = 0; j < cols; j++) matrix[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }
  const distance = matrix[a.length][b.length]
  return 1 - distance / Math.max(a.length, b.length)
}

const ARTIST_SPLIT_RE = /\s*(?:,|&|\/|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bx\b|\bvs\.?\b)\s*/i

/** Split a collab credit ("A & B", "A feat. B", "A x B") into individual artist names. */
function splitArtistNames(s: string): string[] {
  return s
    .split(ARTIST_SPLIT_RE)
    .map((n) => n.trim())
    .filter(Boolean)
}

function fuzzyKeyMatch(a: string, b: string): number {
  const na = normalizeArtistKey(a)
  const nb = normalizeArtistKey(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.92

  const partsA = splitArtistNames(a)
  const partsB = splitArtistNames(b)
  if (partsA.length > 1 || partsB.length > 1) {
    let best = 0
    for (const pa of partsA) {
      for (const pb of partsB) {
        const npa = normalizeArtistKey(pa)
        const npb = normalizeArtistKey(pb)
        if (!npa || !npb) continue
        if (npa === npb) best = Math.max(best, 1)
        else if (npa.includes(npb) || npb.includes(npa)) best = Math.max(best, 0.92)
        else best = Math.max(best, levenshteinRatio(npa, npb))
      }
    }
    if (best > 0) return best
  }

  return levenshteinRatio(na, nb)
}

/** Normalize artist names for fuzzy comparison (Latin + CJK). */
export function sameArtist(a: string, b: string): boolean {
  return fuzzyKeyMatch(a, b) >= 0.85
}

/** Normalize song titles for fuzzy comparison (Latin + CJK). */
export function sameTitle(a: string, b: string): boolean {
  const na = normalizeTitleKey(a)
  const nb = normalizeTitleKey(b)
  if (!na || !nb) return false
  if (na === nb || na.includes(nb) || nb.includes(na)) return true
  return levenshteinRatio(na, nb) >= 0.82
}

/** 0–1 score for how closely a candidate title matches the query. */
export function titleSimilarity(candidate: string, query: string): number {
  const nc = normalizeTitleKey(candidate)
  const nq = normalizeTitleKey(query)
  if (!nc || !nq) return 0
  if (nc === nq) return 1
  if (nc.includes(nq) || nq.includes(nc)) return 0.95
  return levenshteinRatio(nc, nq)
}

/** 0–1 score for how closely a candidate artist matches the query. */
export function artistSimilarity(candidate: string, query: string): number {
  if (!query.trim()) return 0.5
  return fuzzyKeyMatch(candidate, query)
}

/** Strip common suffixes/noise before LRCLIB search queries. */
export function cleanTitleForSearch(title: string): string {
  return title
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s*(feat\.?|ft\.?|featuring)\s+.*/i, '')
    .replace(/\s*-\s*(official\s+)?(video|audio|mv|lyric\s*video).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const TITLE_QUERY_STOP_WORDS = new Set([
  'a', 'an', 'the', 'on', 'to', 'of', 'in', 'at', 'and', 'or', 'n', 'ft', 'feat', 'vs',
])

/** Common spelling / punctuation variants for LRCLIB track_name queries. */
export function expandTitleSearchVariants(title: string): string[] {
  const variants = new Set<string>()
  const add = (s: string) => {
    const t = s.trim()
    if (t) variants.add(t)
  }

  add(title)
  add(cleanTitleForSearch(title))
  add(title.replace(/\bonto\b/gi, 'on'))
  add(cleanTitleForSearch(title.replace(/\bonto\b/gi, 'on')))

  const rockAndRoll = title.replace(/\brock\s+n\s+roll\b/gi, 'Rock and Roll')
  add(rockAndRoll)
  add(cleanTitleForSearch(rockAndRoll))

  const rocknRoll = title.replace(/\brock\s+n\s+roll\b/gi, "Rockn' Roll")
  add(rocknRoll)
  add(cleanTitleForSearch(rocknRoll))

  return [...variants]
}

/**
 * Shorter LRCLIB `q` phrases when the full title is too wrong for track_name search.
 * LRCLIB often matches on distinctive 3–5 word slices even when the full title misses.
 */
export function extractTitleSearchPhrases(title: string, minWords = 3, maxPhrases = 12): string[] {
  const words = cleanTitleForSearch(title)
    .replace(/[^a-zA-Z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return []
  if (words.length < minWords) return [words.join(' ')]

  const phrases: string[] = []
  for (let size = Math.min(5, words.length); size >= minWords; size--) {
    for (let i = 0; i <= words.length - size; i++) {
      const slice = words.slice(i, i + size)
      const distinctive = slice.filter((w) => !TITLE_QUERY_STOP_WORDS.has(w.toLowerCase()))
      if (distinctive.length >= Math.max(2, minWords - 1)) {
        phrases.push(slice.join(' '))
      }
    }
  }

  const phraseScore = (phrase: string): number => {
    const tokens = phrase.split(/\s+/)
    const distinctive = tokens.filter((w) => !TITLE_QUERY_STOP_WORDS.has(w.toLowerCase())).length
    const allDistinctive = distinctive === tokens.length ? 6 : 0
    const sizeBonus = distinctive >= 3 && distinctive <= 4 ? 8 : 0
    return distinctive * 10 + sizeBonus + allDistinctive + phrase.length * 0.05
  }

  const ranked = [...phrases].sort((a, b) => phraseScore(b) - phraseScore(a))
  const triples = ranked.filter((p) => p.split(/\s+/).length === 3)
  const merged = [...triples, ...ranked]

  const seen = new Set<string>()
  return merged
    .filter((p) => {
      const key = p.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, maxPhrases)
}

/** True when lyric text is in a different script than the primary language. */
export function isAlternateLanguage(text: string, primaryLang: Language | 'other'): boolean {
  const lang = detectLanguage(text)
  if (primaryLang === 'ja') return lang !== 'ja'
  return lang === 'ja'
}

export function durationMatches(
  candidate: number | undefined,
  target: number | undefined,
  toleranceSec = 2,
): boolean {
  if (target == null || candidate == null) return true
  return Math.abs(candidate - target) <= toleranceSec
}

export function rankByDuration<T extends { duration?: number }>(
  items: T[],
  targetSec?: number,
): T[] {
  if (targetSec == null) return items
  return [...items].sort((a, b) => {
    const da = a.duration != null ? Math.abs(a.duration - targetSec) : Infinity
    const db = b.duration != null ? Math.abs(b.duration - targetSec) : Infinity
    return da - db
  })
}

/** True when LRCLIB result metadata closely matches what the user searched for. */
export function metadataLooksConsistent(
  queriedTitle: string,
  queriedArtist: string,
  foundTrack: string,
  foundArtist: string,
): boolean {
  return sameTitle(foundTrack, queriedTitle)
    && (queriedArtist.trim() === '' || sameArtist(foundArtist, queriedArtist))
}

/**
 * Fuzzy LRCLIB matches (or weak metadata agreement) need an explicit user
 * confirm before applying lyrics — reduces wrong-song false positives.
 */
export function needsLyricsMatchConfirmation(
  queriedTitle: string,
  queriedArtist: string,
  match: { track: string; artist: string; matchScore: number; matchKind: 'exact' | 'fuzzy' } | undefined,
): boolean {
  if (!match) return false
  if (match.matchScore >= 0.92 && metadataLooksConsistent(queriedTitle, queriedArtist, match.track, match.artist)) {
    return false
  }
  if (match.matchKind === 'exact' && metadataLooksConsistent(queriedTitle, queriedArtist, match.track, match.artist)) {
    return false
  }
  return true
}
