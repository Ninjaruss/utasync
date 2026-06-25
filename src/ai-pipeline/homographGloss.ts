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
  // Surface-gated so homophones keep their own sense (鳴る=ring, ずれ=gap, も=also).
  { surface: /笑/, romaji: /^wara/, lemmaKeys: ['warau'] },
  { surface: /連れ/, romaji: /^(?:tsu|zu)re/, lemmaKeys: ['tsureru'] },
  { surface: /持/, romaji: /^mo/, lemmaKeys: ['motsu'] },
]

/** Direct surface→gloss override for homophone-conflated lemmas where the romaji
 * key alone resolves to the wrong sense (e.g. JMdict naru→"bear"). Surface-gated by
 * the kanji so homophones keep their own sense (鳴る=ring, 生る=bear). */
export interface SurfaceGlossRule {
  surface: RegExp
  romaji?: RegExp
  gloss: string
}

export const SURFACE_GLOSS_RULES: SurfaceGlossRule[] = [
  { surface: /成/, romaji: /^nar/, gloss: 'become' },
]

export function surfaceDirectGloss(surface: string | undefined, romaji: string): string | undefined {
  const s = surface?.trim() ?? ''
  const r = romaji.trim().toLowerCase()
  if (!s || !r) return undefined
  for (const rule of SURFACE_GLOSS_RULES) {
    if (!rule.surface.test(s)) continue
    if (rule.romaji && !rule.romaji.test(r)) continue
    return rule.gloss
  }
  return undefined
}

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
