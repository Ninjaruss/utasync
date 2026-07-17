/** Lazy-loaded English monolingual definitions (built by scripts/build-wordnet-defs.mjs). */

export interface EnDictData {
  v: number
  source: string
  entries: Record<string, string[]>
}

let data: EnDictData | null = null
let loadPromise: Promise<EnDictData | null> | null = null
let lastLoadFailureAt = 0
const LOAD_RETRY_BACKOFF_MS = 60_000

export function loadEnDict(): Promise<EnDictData | null> {
  if (data) return Promise.resolve(data)
  if (loadPromise) return loadPromise
  if (lastLoadFailureAt && Date.now() - lastLoadFailureAt < LOAD_RETRY_BACKOFF_MS) return Promise.resolve(null)
  loadPromise = (async () => {
    try {
      const res = await fetch('/en-def.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = (await res.json()) as EnDictData
      data = { v: parsed.v ?? 1, source: parsed.source ?? 'princeton-wordnet', entries: parsed.entries ?? {} }
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

export function enDictLoaded(): boolean { return data !== null }

export function getEnDefinitions(word: string): string[] | undefined {
  if (!data) return undefined
  const key = word.trim().toLowerCase()
  // hasOwnProperty guard: the JSON-parsed entries object inherits Object.prototype,
  // so a bare entries[key] for keys like "constructor"/"toString" would return an
  // inherited value instead of undefined.
  return Object.prototype.hasOwnProperty.call(data.entries, key) ? data.entries[key] : undefined
}

export function resetEnDictCache(): void { data = null; loadPromise = null; lastLoadFailureAt = 0 }
export function setEnDictForTests(payload: EnDictData): void { data = payload; loadPromise = Promise.resolve(payload) }
