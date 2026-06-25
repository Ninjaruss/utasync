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

  const spelling = SPELLING_VARIANTS[base]
  if (spelling) out.add(spelling)
  for (const [uk, us] of Object.entries(SPELLING_VARIANTS)) {
    if (base === us) out.add(uk)
  }

  return [...out]
}

/** Normalize a JMdict gloss for comparison with lyric translation vocabulary. */
export function normalizeLemmaGloss(gloss: string): string {
  return SPELLING_VARIANTS[gloss.trim().toLowerCase()] ?? gloss.trim().toLowerCase()
}
