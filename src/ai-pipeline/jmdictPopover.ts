/**
 * Lazy-loaded, reading-disambiguated JMdict definition map for the tap-lookup
 * popover (built by scripts/build-jmdict-gloss.mjs → public/jmdict-popover.json).
 *
 * Distinct from jmdict-gloss.json's `romaji` map, which stores a single alignable
 * word per lemma for the word PAIRER's embedding step. That truncation ("past" →
 * "the"), romaji homophone collapse (居 → 置く), and sparse coverage make it a poor
 * human-readable dictionary. This artifact instead keys full first-sense
 * definitions by kanji/kana headword, with one entry per homograph reading, so the
 * popover can show "past; bygone days" and disambiguate 辛い (からい spicy /
 * つらい painful). Loaded only when a word is tapped — the pairer never reads it.
 */

/** One homograph sense: hiragana reading, coarse POS tag, and the full gloss. */
export interface PopoverSense {
  r: string
  pos?: string
  g: string
}

export interface JmdictPopoverData {
  v: number
  source: string
  entries: Record<string, PopoverSense[]>
}

let data: JmdictPopoverData | null = null
let loadPromise: Promise<JmdictPopoverData | null> | null = null
let lastLoadFailureAt = 0

// A tap while offline would otherwise re-fetch the multi-MB JSON on every lookup.
const LOAD_RETRY_BACKOFF_MS = 60_000

/** Loads public/jmdict-popover.json once; returns null on fetch failure. */
export function loadJmdictPopover(): Promise<JmdictPopoverData | null> {
  if (data) return Promise.resolve(data)
  if (loadPromise) return loadPromise
  if (lastLoadFailureAt && Date.now() - lastLoadFailureAt < LOAD_RETRY_BACKOFF_MS) {
    return Promise.resolve(null)
  }

  loadPromise = (async () => {
    try {
      const res = await fetch('/jmdict-popover.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = (await res.json()) as JmdictPopoverData
      data = {
        v: parsed.v ?? 1,
        source: parsed.source ?? 'jmdict',
        entries: parsed.entries ?? {},
      }
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

export function jmdictPopoverLoaded(): boolean {
  return data !== null
}

/**
 * Full first-sense definition for a headword. Homographs (multiple entries under
 * one surface) are disambiguated by the token's hiragana reading, then falling
 * back to the first (highest-scored) sense.
 */
export function getPopoverGloss(headword: string, reading?: string | null): string | undefined {
  const senses = data?.entries[headword.trim()]
  if (!senses || senses.length === 0) return undefined
  if (senses.length === 1) return senses[0]!.g
  if (reading) {
    const match = senses.find((s) => s.r === reading)
    if (match) return match.g
  }
  return senses[0]!.g
}

/** For tests — reset module state. */
export function resetJmdictPopoverCache(): void {
  data = null
  loadPromise = null
  lastLoadFailureAt = 0
}

/** Inject popover data without fetch (tests). */
export function setJmdictPopoverForTests(payload: JmdictPopoverData): void {
  data = payload
  loadPromise = Promise.resolve(payload)
}
