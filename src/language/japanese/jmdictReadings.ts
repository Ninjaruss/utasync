/**
 * Lazy-loaded JMdict reading inventory (built by scripts/build-jmdict-gloss.mjs
 * into public/jmdict-readings.json). Maps a kanji surface to every reading JMdict
 * lists for it, split into common and uncommon.
 *
 * This is a lexicon, not a context model: it says which readings are LEGITIMATE
 * for a word, never which one a given line uses. The reading reconciler combines
 * it with the sung audio — the audio picks the reading, JMdict vouches for it.
 */

import { katakanaToHiragana } from './phonetics'
import type { Token } from '../../core/types'

export interface JmdictReadingsData {
  v: number
  source: string
  /** Surface → "common1,common2|uncommon1,uncommon2" (hiragana). No pipe when
   * every reading is common; leading pipe when none are. */
  readings: Record<string, string>
}

export interface ReadingInventory {
  common: string[]
  uncommon: string[]
}

const KANJI_RE = /[㐀-鿿]/

let data: JmdictReadingsData | null = null
let loadPromise: Promise<JmdictReadingsData | null> | null = null

/** Loads public/jmdict-readings.json once; returns null on fetch failure. */
export function loadJmdictReadings(): Promise<JmdictReadingsData | null> {
  if (data) return Promise.resolve(data)
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      const res = await fetch('/jmdict-readings.json')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = (await res.json()) as JmdictReadingsData
      data = {
        v: parsed.v ?? 1,
        source: parsed.source ?? 'jmdict',
        readings: parsed.readings ?? {},
      }
      return data
    } catch {
      loadPromise = null
      return null
    }
  })()

  return loadPromise
}

export function jmdictReadingsLoaded(): boolean {
  return data !== null
}

export function readingInventory(surface: string): ReadingInventory | undefined {
  const raw = data?.readings[surface.trim()]
  if (raw === undefined) return undefined
  const [commonPart, uncommonPart] = raw.split('|', 2)
  const split = (part: string | undefined): string[] => (part ? part.split(',').filter(Boolean) : [])
  return { common: split(commonPart), uncommon: split(uncommonPart) }
}

function allReadings(surface: string): string[] {
  const inv = readingInventory(surface)
  return inv ? [...inv.common, ...inv.uncommon] : []
}

/** Comparable hiragana (katakana lowered, long mark dropped). */
function comparable(kana: string): string {
  return katakanaToHiragana(kana).normalize('NFKC').replace(/ー/g, '')
}

/** Trailing kana (okurigana) of a surface. */
function trailingKana(surface: string): string {
  let tail = ''
  for (const ch of [...surface].reverse()) {
    if (KANJI_RE.test(ch)) break
    tail = ch + tail
  }
  return tail
}

/**
 * Hiragana readings the token's FULL surface could legitimately have per JMdict.
 * Exact-surface entries contribute as-is; baseForm (dictionary form) entries are
 * adapted to the inflected surface by swapping the okurigana tail: 彷徨っ with
 * baseForm 彷徨う and JMdict さまよう → さまよ + っ.
 */
export function candidateTokenReadings(token: Token): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (r: string) => {
    const c = comparable(r)
    if (c && !seen.has(c)) { seen.add(c); out.push(r) }
  }

  for (const r of allReadings(token.surface)) push(r)

  const base = token.baseForm
  if (base && base !== token.surface) {
    const baseTail = trailingKana(base)
    const surfaceTail = trailingKana(token.surface)
    const baseStem = base.slice(0, base.length - baseTail.length)
    const surfaceStem = token.surface.slice(0, token.surface.length - surfaceTail.length)
    // Only adapt when the non-okurigana parts agree — otherwise the baseForm
    // belongs to a different word and its readings say nothing about this token.
    if (baseStem && baseStem === surfaceStem) {
      const baseTailComparable = comparable(baseTail)
      for (const r of allReadings(base)) {
        const rc = comparable(r)
        if (!baseTailComparable) {
          push(rc + surfaceTail)
        } else if (rc.endsWith(baseTailComparable) && rc.length > baseTailComparable.length) {
          push(rc.slice(0, rc.length - baseTailComparable.length) + surfaceTail)
        }
      }
    }
  }
  return out
}

/** True when `kana` (hiragana or katakana) is a JMdict-listed reading for the
 * token's surface (directly or adapted from its dictionary form). False on
 * unknown surfaces — this validator vouches, it never guesses. */
export function isValidJmdictReading(token: Token, kana: string): boolean {
  const target = comparable(kana)
  if (!target) return false
  return candidateTokenReadings(token).some((r) => comparable(r) === target)
}

/** The validator when the inventory is loaded, else undefined — lets sync call
 * sites (resolveLineReadings) use JMdict opportunistically without awaiting. */
export function getJmdictReadingValidator(): ((token: Token, kana: string) => boolean) | undefined {
  return data ? isValidJmdictReading : undefined
}

/** For tests — reset module state. */
export function resetJmdictReadingsCache(): void {
  data = null
  loadPromise = null
}

/** Inject inventory data without fetch (tests). */
export function setJmdictReadingsForTests(payload: JmdictReadingsData): void {
  data = payload
  loadPromise = Promise.resolve(payload)
}
