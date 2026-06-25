/** US/UK spelling pairs for cross-lingual gloss matching. */
const SPELLING_VARIANTS: Record<string, string> = {
  colour: 'color',
  colours: 'colors',
  coloured: 'colored',
  favour: 'favor',
  favourite: 'favorite',
  honour: 'honor',
  behaviour: 'behavior',
  centre: 'center',
  metre: 'meter',
  grey: 'gray',
}

/**
 * English word variants to try when matching a translation target to a JA gloss.
 * Handles hyphenated compounds (near-unsalvageable → unsalvageable) and UK/US spellings.
 */
export function englishGlossVariants(word: string): string[] {
  const base = word.trim().toLowerCase()
  if (!base) return []

  const out = new Set<string>([base])

  if (base.includes('-')) {
    for (const part of base.split('-')) {
      if (part.length >= 3) out.add(part)
    }
  }

  if (base.startsWith('un') && base.length > 4) {
    out.add(base.slice(2))
  }

  // Inflected translation targets (gerunds, plurals, past tense) should still match
  // a base-form JA gloss: taking→take, wars→war, started→start.
  for (const lemma of inflectedBaseForms(base)) out.add(lemma)

  const spelling = SPELLING_VARIANTS[base]
  if (spelling) out.add(spelling)
  for (const [uk, us] of Object.entries(SPELLING_VARIANTS)) {
    if (base === us) out.add(uk)
  }

  return [...out]
}

/** Conservative English de-inflection — adds candidate base forms (never removes
 * the original), so it only widens gloss matches and can't drop a correct one. */
function inflectedBaseForms(base: string): string[] {
  const out: string[] = []
  const endsDoubled = /([bcdfgklmnprt])\1$/

  if (base.endsWith('ing') && base.length >= 5) {
    const stem = base.slice(0, -3)
    out.push(stem, `${stem}e`) // running→run(n), making→mak→make, taking→tak→take
    if (endsDoubled.test(stem)) out.push(stem.slice(0, -1)) // running→run
  } else if (base.endsWith('ed') && base.length >= 4) {
    const stem = base.slice(0, -2)
    out.push(stem, base.slice(0, -1)) // started→start, lived→live
    if (endsDoubled.test(stem)) out.push(stem.slice(0, -1)) // stopped→stop
  } else if (base.endsWith('ies') && base.length >= 4) {
    out.push(`${base.slice(0, -3)}y`) // carries→carry
  } else if (base.endsWith('es') && base.length >= 4) {
    out.push(base.slice(0, -2), base.slice(0, -1)) // exposes→expose, wishes→wish
  } else if (base.endsWith('s') && !base.endsWith('ss') && base.length >= 3) {
    out.push(base.slice(0, -1)) // wars→war, rocks→rock
  }
  return out
}

/** Normalize a JMdict gloss for comparison with lyric translation vocabulary. */
export function normalizeLemmaGloss(gloss: string): string {
  return SPELLING_VARIANTS[gloss.trim().toLowerCase()] ?? gloss.trim().toLowerCase()
}
