/**
 * Strip common verb/adjective inflection suffixes and retry lemma gloss lookup.
 * Covers inflected romaji (korogatta, aishiteiru) without listing every form.
 */

import { homographLemmaKeys } from './homographGloss'

/** Longest first — one or two strips per candidate chain. */
const INFLECTION_SUFFIXES = [
  'shitemiseru', 'temiseru', 'shiteiru', 'shiteita', 'kutatte', 'nakute', 'naide', 'nakatta',
  'takuhawanai', 'takuhanai', 'hawanai', 'ketai',
  'teita', 'deita', 'otteita', 'ndeita', 'iteita',
  'teiru', 'deiru', 'teku', 'deku', 'teru', 'deru',
  'itai', 'chatta', 'jatta', 'mashita', 'deshita', 'masen', 'masu',
  'katta', 'gatta', 'satta', 'natta', 'itta', 'matta', 'shita', 'rareta',
  'kattara', 'gattara', 'sattara', 'nattara', 'ittara', 'mattara', 'shitara',
  'ttara', 'attara', 'itara', 'etara',
  'shite', 'site', 'tte', 'tta', 'ita', 'eta', 'uta', 'ota',
  'rareru', 'areru', 'sareru', 'tatte', 'tara', 'reba',
  'hanai', 'wanai', 'tenai', 'renai', 'enai', 'kunai', 'chinai', 'senai',
  'tai', 'nai', 'kanai', 'kute',
  'te', 'de', 'ta', 'da', 'ku',
].sort((a, b) => b.length - a.length)

const MIN_STEM_LEN = 2

/** Two-char stems that are usually suffix fragments, not lemmas. */
const BLOCKED_SHORT_STEMS = new Set(['te', 'de', 'ku', 'ta', 'da'])

function isValidStem(stem: string): boolean {
  if (stem.length < MIN_STEM_LEN) return false
  if (stem.length === 2 && BLOCKED_SHORT_STEMS.has(stem)) return false
  return true
}

/** Romaji stems after removing up to `maxPasses` inflection suffixes. */
export function inflectionStemCandidates(romaji: string, maxPasses = 3): string[] {
  const base = romaji.trim().toLowerCase()
  if (!base) return []

  const stems = new Set<string>()
  let frontier = [base]

  for (let pass = 0; pass < maxPasses && frontier.length > 0; pass++) {
    const next: string[] = []
    for (const current of frontier) {
      for (const suffix of INFLECTION_SUFFIXES) {
        if (!current.endsWith(suffix)) continue
        const stem = current.slice(0, current.length - suffix.length)
        if (!isValidStem(stem) || stems.has(stem)) continue
        stems.add(stem)
        next.push(stem)
      }
    }
    frontier = next
  }

  // Nasal-onbin stems: つぐん/滲ん/叫ん romanize with a final "n" whose lemma
  // ends in mu/bu/nu (口をつぐん → tsugumu). Restore those lemma candidates.
  for (const s of [base, ...stems]) {
    if (!s.endsWith('n') || s.length < 3) continue
    for (const tail of ['mu', 'bu', 'nu']) {
      const lemma = s.slice(0, -1) + tail
      if (!stems.has(lemma)) stems.add(lemma)
    }
  }

  return [...stems]
}

/**
 * Stems that are themselves valid dictionary lemmas but also arise as
 * inflection stems of an unrelated word (e.g. "hoshi" is both 星 "star" and
 * the stem of 欲しかった "wanted" once the "katta" suffix is stripped). An
 * exact stem === key hit alone is not enough confidence for these — exclude
 * them from the direct-match shortcut below so a coincidental stem collision
 * can't force a 1.0 "exact match" score against the wrong word.
 */
const AMBIGUOUS_EXACT_STEMS = new Set(['hoshi'])

/**
 * Dictionary keys plausibly sharing a lemma with `stem` (e.g. koroga → korogaru).
 * Keeps a tight length gap so unrelated prefixes do not match.
 */
export function dictKeysMatchingStem(stem: string, keys: Iterable<string>): string[] {
  const matches: string[] = []
  for (const key of keys) {
    if (AMBIGUOUS_EXACT_STEMS.has(key)) continue
    if (key === stem) {
      matches.push(key)
      continue
    }
    if (key.startsWith(stem) && key.length - stem.length <= 3) {
      matches.push(key)
      continue
    }
    if (stem.startsWith(key) && stem.length - key.length <= 2) {
      matches.push(key)
    }
  }
  return matches
}

export interface StemLookupContext {
  glossForKey: (lemmaKey: string) => string | undefined
  aliasKeysForTarget: (targetWord: string) => ReadonlySet<string> | undefined
  lemmaKeysForStem: (stem: string) => Iterable<string>
  /** When set, also try homograph-resolved lemma keys for each stem. */
  homographKeysForStem?: (stem: string) => Iterable<string>
}

/** True when any inflection-stripped stem hits a lemma gloss or alias for `targetWord`. */
export function stemLookupMatchesTarget(
  romaji: string,
  targetWord: string,
  ctx: StemLookupContext,
  surface?: string,
): boolean {
  const t = targetWord.trim().toLowerCase()
  if (!t) return false

  const aliasKeys = ctx.aliasKeysForTarget(t)

  const tryKey = (key: string): boolean => {
    if (AMBIGUOUS_EXACT_STEMS.has(key)) return false
    const gloss = ctx.glossForKey(key)
    if (gloss === t) return true
    if (aliasKeys?.has(key)) return true
    return false
  }

  const tryStem = (stem: string): boolean => {
    if (tryKey(stem)) return true
    for (const key of ctx.homographKeysForStem?.(stem) ?? []) {
      if (tryKey(key)) return true
    }
    if (surface) {
      for (const key of homographLemmaKeys(surface, stem)) {
        if (tryKey(key)) return true
      }
    }
    for (const key of dictKeysMatchingStem(stem, ctx.lemmaKeysForStem(stem))) {
      if (tryKey(key)) return true
    }
    return false
  }

  for (const stem of inflectionStemCandidates(romaji)) {
    if (tryStem(stem)) return true
  }

  return false
}
