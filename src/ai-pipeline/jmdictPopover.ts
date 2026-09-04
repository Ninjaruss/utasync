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
/**
 * Definition for a tapped word, disambiguated by reading AND part of speech.
 *
 * A single surface routinely means different things as different word classes,
 * and picking the entry's first sense showed whichever came first regardless of
 * how the word was used in the line: ねえ as an interjection ("hey") got the
 * particle "right?; isn't it?", 一杯 as an adverb ("fully") got the counter "one
 * cup", ただ as a conjunction ("but") got the adjective "ordinary". `posClass` is
 * the tapped token's kuromoji class, mapped onto JMdict's.
 *
 * Reading still wins over part of speech — a 辛い ruby reading からい must not
 * show つらい's "painful" whatever the POS says. Within one reading, POS decides.
 */
export function getPopoverGloss(
  headword: string,
  reading?: string | null,
  posClass?: string | null,
): string | undefined {
  const senses = data?.entries[headword.trim()]
  if (!senses || senses.length === 0) return undefined

  const byReading = reading ? senses.filter((s) => s.r === reading) : []
  // Reading-matched senses when the reading pins some, else everything.
  const pool = byReading.length > 0 ? byReading : senses

  if (posClass) {
    const match = pool.find((s) => s.pos === posClass)
    if (match) return match.g
  }
  return pool[0]!.g
}

/**
 * Definition ONLY when the dictionary has a sense of exactly this word class —
 * never a fallback to the entry's first sense.
 *
 * The grammar path uses this to answer words kuromoji tags 非自立 (dependent)
 * that are nonetheless ordinary content words: いい "good", みたい "-like",
 * 続ける "to continue". Blanking them was a blunt guard against the kana
 * homophone problem (は glossing as 端 "edge"), which came from the romaji chain.
 * Requiring an exact class match is a precise guard instead: a 助詞 は can only
 * ever match a particle sense, never a noun one, so it cannot inherit a lexical
 * meaning. Where no sense of that class exists the popover still shows nothing
 * rather than something wrong.
 */
export function getPopoverGlossForPos(
  headword: string,
  reading: string | null | undefined,
  posClass: string,
): string | undefined {
  const senses = data?.entries[headword.trim()]
  if (!senses || senses.length === 0) return undefined
  const byReading = reading ? senses.filter((s) => s.r === reading) : []
  const pool = byReading.length > 0 ? byReading : senses
  return pool.find((s) => s.pos === posClass)?.g
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
