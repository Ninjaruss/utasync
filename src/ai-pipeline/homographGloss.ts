/**
 * Disambiguate JMdict homographs using token surface (kanji/kana) context.
 * Romaji alone is often ambiguous (知り→shiri is "buttocks" in JMdict, not 知る).
 */

export interface HomographRule {
  /** Token surface must match (kanji/kana in the lyric). */
  surface: RegExp
  /** When set, romaji must also match — avoids false positives on unrelated readings. */
  romaji?: RegExp
  /** Dictionary lemma keys to try, in preference order. */
  lemmaKeys: string[]
}

/** Surface + reading hints for common lyric homographs. */
export const HOMOGRAPH_RULES: HomographRule[] = [
  { surface: /知/, romaji: /^shiri?$/, lemmaKeys: ['shiru', 'shi'] },
  { surface: /思/, romaji: /^omo/, lemmaKeys: ['omou', 'omoi', 'omo'] },
  { surface: /触/, romaji: /^fure/, lemmaKeys: ['fureru', 'fure'] },
  { surface: /救/, romaji: /^suk/, lemmaKeys: ['tasukeru', 'sukuu', 'suku'] },
  { surface: /気付|気づ|気づく|気付く/, romaji: /^ki(?:du|zu)k/, lemmaKeys: ['kizuku', 'kidzuku', 'kizuku'] },
  { surface: /色/, romaji: /^iro/, lemmaKeys: ['iro'] },
  { surface: /増/, romaji: /^fue/, lemmaKeys: ['fueru', 'fu'] },
  { surface: /収ま/, romaji: /^osama/, lemmaKeys: ['osamaru', 'osama'] },
  { surface: /分かち|分かつ|分か/, romaji: /^waka/, lemmaKeys: ['wakachiau', 'wakatsu', 'wakaru'] },
  { surface: /離/, romaji: /^hana/, lemmaKeys: ['hanareru', 'hanare'] },
  { surface: /もが/, romaji: /^moga/, lemmaKeys: ['mogaku', 'mogaku'] },
]

export interface GlossResolver {
  glossForKey: (lemmaKey: string) => string | undefined
}

/** Preferred lemma keys when surface context resolves a homograph reading. */
export function homographLemmaKeys(surface: string | undefined, romaji: string): string[] {
  const s = surface?.trim() ?? ''
  const r = romaji.trim().toLowerCase()
  if (!s || !r) return []

  const keys: string[] = []
  for (const rule of HOMOGRAPH_RULES) {
    if (!rule.surface.test(s)) continue
    if (rule.romaji && !rule.romaji.test(r)) continue
    keys.push(...rule.lemmaKeys)
  }
  return keys
}

/** First gloss from homograph-resolved lemma keys. */
export function homographLemmaGloss(
  surface: string | undefined,
  romaji: string,
  resolve: GlossResolver,
): string | undefined {
  for (const key of homographLemmaKeys(surface, romaji)) {
    const gloss = resolve.glossForKey(key)
    if (gloss) return gloss
  }
  return undefined
}
