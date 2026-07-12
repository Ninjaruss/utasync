/**
 * Lazy-loaded JMdict romaji→English gloss map (built by scripts/build-jmdict-gloss.mjs).
 * Curated entries in lyricGloss.ts always override these.
 */

import { yieldToMainThread } from '../core/idle'

export interface JmdictGlossData {
  v: number
  source: string
  romaji: Record<string, string>
  kanji: Record<string, string>
}

let data: JmdictGlossData | null = null
let loadPromise: Promise<JmdictGlossData | null> | null = null
let lastLoadFailureAt = 0
let prefixIndexBuilt = false
let prefixIndexPromise: Promise<void> | null = null

// Offline word taps would otherwise re-fetch the multi-MB JSON on every lookup.
const LOAD_RETRY_BACKOFF_MS = 60_000

const prefixIndex = new Map<string, string[]>()

const PREFIX_INDEX_CHUNK = 8000

function addKeyToPrefixIndex(key: string): void {
  for (let len = 2; len <= Math.min(3, key.length); len++) {
    const prefix = key.slice(0, len)
    let bucket = prefixIndex.get(prefix)
    if (!bucket) {
      bucket = []
      prefixIndex.set(prefix, bucket)
    }
    bucket.push(key)
  }
}

async function buildPrefixIndex(): Promise<void> {
  if (prefixIndexBuilt || !data?.romaji) return
  const keys = Object.keys(data.romaji)
  for (let i = 0; i < keys.length; i += PREFIX_INDEX_CHUNK) {
    const end = Math.min(i + PREFIX_INDEX_CHUNK, keys.length)
    for (let j = i; j < end; j++) addKeyToPrefixIndex(keys[j]!)
    await yieldToMainThread()
  }
  prefixIndexBuilt = true
}

function ensurePrefixIndex(): Promise<void> {
  if (prefixIndexBuilt) return Promise.resolve()
  // Don't cache a build attempt until the gloss data has actually loaded,
  // or a failed load would pin a no-op promise for the rest of the session.
  if (!data) return Promise.resolve()
  if (!prefixIndexPromise) prefixIndexPromise = buildPrefixIndex()
  return prefixIndexPromise
}

/** Loads public/jmdict-gloss.json once; returns null on fetch failure. */
export function loadJmdictGloss(): Promise<JmdictGlossData | null> {
  if (data) return Promise.resolve(data)
  if (loadPromise) return loadPromise
  if (lastLoadFailureAt && Date.now() - lastLoadFailureAt < LOAD_RETRY_BACKOFF_MS) {
    return Promise.resolve(null)
  }

  loadPromise = (async () => {
    try {
      const res = await fetch('/jmdict-gloss.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = (await res.json()) as JmdictGlossData
      data = {
        v: parsed.v ?? 1,
        source: parsed.source ?? 'jmdict',
        romaji: parsed.romaji ?? {},
        kanji: parsed.kanji ?? {},
      }
      lastLoadFailureAt = 0
      return data
    } catch {
      loadPromise = null
      prefixIndexPromise = null
      lastLoadFailureAt = Date.now()
      return null
    }
  })()

  return loadPromise
}

/** Builds the prefix index in idle slices — call before stem-heavy gloss lookup. */
export function prepareJmdictStemIndex(): Promise<void> {
  return loadJmdictGloss().then(() => ensurePrefixIndex())
}

export function jmdictGlossLoaded(): boolean {
  return data !== null
}

export function getJmdictRomajiGloss(romaji: string): string | undefined {
  return data?.romaji[romaji.trim().toLowerCase()]
}

export function getJmdictKanjiRomaji(surface: string): string | undefined {
  return data?.kanji[surface.trim()]
}

export function allJmdictLemmaKeys(): string[] {
  return data ? Object.keys(data.romaji) : []
}

/** Candidate JMdict keys for inflection stem lookup — avoids scanning the full lexicon. */
export function jmdictLemmaKeysForStem(stem: string): string[] {
  if (!prefixIndexBuilt) return []
  const s = stem.trim().toLowerCase()
  if (s.length < 2) return []

  const seen = new Set<string>()
  const result: string[] = []
  const prefixes = new Set<string>([s.slice(0, 2)])
  if (s.length >= 3) prefixes.add(s.slice(0, 3))

  for (const prefix of prefixes) {
    for (const key of prefixIndex.get(prefix) ?? []) {
      if (seen.has(key)) continue
      seen.add(key)
      result.push(key)
    }
  }
  return result
}

/** For tests — reset module state. */
export function resetJmdictGlossCache(): void {
  data = null
  loadPromise = null
  lastLoadFailureAt = 0
  prefixIndexBuilt = false
  prefixIndexPromise = null
  prefixIndex.clear()
}

/** Inject gloss data without fetch (tests). */
export function setJmdictGlossForTests(payload: JmdictGlossData): void {
  data = payload
  loadPromise = Promise.resolve(payload)
  prefixIndexBuilt = false
  prefixIndexPromise = null
  prefixIndex.clear()
  void buildPrefixIndex()
}
