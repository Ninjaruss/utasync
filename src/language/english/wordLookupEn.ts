import { loadEnjaDict, getEnjaEntries, enjaDictLoaded } from './enjaDict'
import { loadEnDict, getEnDefinitions, enDictLoaded } from './enDict'

export interface EnEquivalent { ja: string; reading: string | null }
export interface EnWordLookupResult {
  /** The normalized English word (display headword). */
  headword: string
  /** Language of the returned definition content. */
  definitionLang: 'ja' | 'en'
  /** Japanese equivalents — populated when definitionLang === 'ja'. */
  equivalents: EnEquivalent[]
  /** English definitions — populated when definitionLang === 'en' (later task). */
  definitions: string[]
  /** False when the underlying dictionary failed to load (offline). */
  dictionaryAvailable: boolean
}

export function hasLatinLetter(raw: string): boolean {
  return /[a-z]/i.test(raw)
}

export function normalizeEnglishWord(raw: string): string {
  return raw
    .replace(/[‘’‛]/g, "'")
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/g, '')
}

/** Best-effort base-form candidates (exact form first). Not a full lemmatizer. */
export function stemCandidates(word: string): string[] {
  const c = [word]
  if (word.endsWith("'s")) c.push(word.slice(0, -2))
  if (word.endsWith('ies') && word.length > 4) c.push(word.slice(0, -3) + 'y')
  if (word.endsWith('es') && word.length > 4) c.push(word.slice(0, -2))
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) c.push(word.slice(0, -1))
  if (word.endsWith('ed') && word.length > 4) { c.push(word.slice(0, -2)); c.push(word.slice(0, -1)) }
  if (word.endsWith('ing') && word.length > 5) {
    const stem = word.slice(0, -3)
    c.push(stem)
    c.push(stem + 'e')
    // CVC doubling: "running" -> "runn" -> "run" (drop the doubled final consonant).
    if (stem.length > 1 && stem[stem.length - 1] === stem[stem.length - 2]) c.push(stem.slice(0, -1))
  }
  if (word.endsWith('ly') && word.length > 4) c.push(word.slice(0, -2))
  return [...new Set(c)]
}

/**
 * Look up an English translation word. Immersion off → Japanese equivalents
 * (reverse JMdict). Immersion on → English definitions (later task). Null for a
 * token with no latin letters (punctuation) so the popover unmounts.
 */
export async function lookupEnglishWord(
  raw: string,
  opts: { immersion?: boolean } = {},
): Promise<EnWordLookupResult | null> {
  if (!hasLatinLetter(raw)) return null
  const headword = normalizeEnglishWord(raw)
  if (!headword) return null

  if (opts.immersion) {
    await loadEnDict()
    let defs: string[] | undefined
    for (const cand of stemCandidates(headword)) {
      defs = getEnDefinitions(cand)
      if (defs) break
    }
    return {
      headword,
      definitionLang: 'en',
      equivalents: [],
      definitions: defs ?? [],
      dictionaryAvailable: enDictLoaded(),
    }
  }

  await loadEnjaDict()
  let hit: { w: string; r: string | null }[] | undefined
  for (const cand of stemCandidates(headword)) {
    hit = getEnjaEntries(cand)
    if (hit) break
  }
  return {
    headword,
    definitionLang: 'ja',
    equivalents: (hit ?? []).map((e) => ({ ja: e.w, reading: e.r })),
    definitions: [],
    dictionaryAvailable: enjaDictLoaded(),
  }
}

export function jishoSearchUrl(query: string): string {
  return `https://jisho.org/search/${encodeURIComponent(query)}`
}
