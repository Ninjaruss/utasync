/** Lazy-loaded Japanese monolingual definitions (built by scripts/build-wordnet-defs.mjs). */
import type { Token } from '../../core/types'

export interface JaMonolingualData {
  v: number
  source: string
  entries: Record<string, string[]>
}

let data: JaMonolingualData | null = null
let loadPromise: Promise<JaMonolingualData | null> | null = null
let lastLoadFailureAt = 0
const LOAD_RETRY_BACKOFF_MS = 60_000

export function loadJaMonolingual(): Promise<JaMonolingualData | null> {
  if (data) return Promise.resolve(data)
  if (loadPromise) return loadPromise
  if (lastLoadFailureAt && Date.now() - lastLoadFailureAt < LOAD_RETRY_BACKOFF_MS) return Promise.resolve(null)
  loadPromise = (async () => {
    try {
      const res = await fetch('/wnja-def.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = (await res.json()) as JaMonolingualData
      data = { v: parsed.v ?? 1, source: parsed.source ?? 'japanese-wordnet', entries: parsed.entries ?? {} }
      lastLoadFailureAt = 0
      return data
    } catch {
      loadPromise = null
      lastLoadFailureAt = Date.now()
      return null
    }
  })()
  return loadPromise
}

export function jaMonolingualLoaded(): boolean { return data !== null }

export function getJaDefinitions(lemma: string): string[] | undefined {
  if (!data) return undefined
  // hasOwnProperty guard: the JSON-parsed entries object inherits Object.prototype.
  return Object.prototype.hasOwnProperty.call(data.entries, lemma) ? data.entries[lemma] : undefined
}

/** Definitions for a token, trying its dictionary (base) form then its surface. */
export function lookupJaDefinition(token: Token): string[] | undefined {
  return (token.baseForm ? getJaDefinitions(token.baseForm) : undefined) ?? getJaDefinitions(token.surface)
}

export function resetJaMonolingualCache(): void { data = null; loadPromise = null; lastLoadFailureAt = 0 }
export function setJaMonolingualForTests(payload: JaMonolingualData): void { data = payload; loadPromise = Promise.resolve(payload) }
