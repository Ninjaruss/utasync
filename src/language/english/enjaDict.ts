/** Lazy-loaded reverse English→Japanese dictionary (built by scripts/build-enja-dict.mjs). */

export interface EnjaEntry { w: string; r: string | null }
export interface EnjaDictData {
  v: number
  source: string
  entries: Record<string, EnjaEntry[]>
}

let data: EnjaDictData | null = null
let loadPromise: Promise<EnjaDictData | null> | null = null
let lastLoadFailureAt = 0
const LOAD_RETRY_BACKOFF_MS = 60_000

export function loadEnjaDict(): Promise<EnjaDictData | null> {
  if (data) return Promise.resolve(data)
  if (loadPromise) return loadPromise
  if (lastLoadFailureAt && Date.now() - lastLoadFailureAt < LOAD_RETRY_BACKOFF_MS) return Promise.resolve(null)
  loadPromise = (async () => {
    try {
      const res = await fetch('/enja-dict.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = (await res.json()) as EnjaDictData
      data = { v: parsed.v ?? 1, source: parsed.source ?? 'jmdict-eng', entries: parsed.entries ?? {} }
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

export function enjaDictLoaded(): boolean { return data !== null }

export function getEnjaEntries(word: string): EnjaEntry[] | undefined {
  if (!data) return undefined
  const key = word.trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(data.entries, key) ? data.entries[key] : undefined
}

export function resetEnjaDictCache(): void { data = null; loadPromise = null; lastLoadFailureAt = 0 }
export function setEnjaDictForTests(payload: EnjaDictData): void { data = payload; loadPromise = Promise.resolve(payload) }
