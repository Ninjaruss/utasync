/**
 * The FROZEN perturbation set for the line-pairing scorecard.
 *
 * Frozen because each perturbation invents new English strings, and those must
 * exist in tests/ai-pipeline/fixtures/embeddings-cache.json — which throws on a
 * miss in CI. Adding one means regenerating the cache.
 *
 * Indices are fixed rules, never random. Lives here rather than in
 * audit-line-pairing.mjs because that script runs main() on import.
 */
import {
  mergeAdjacent, splitLine, dropTranslationFor, insertNoiseLine,
} from './translationPerturbations.mjs'

/** Drop the translation of every repeated original after its first occurrence. */
export function dropRepeats(state, originals) {
  const seen = new Set()
  let out = state
  for (let i = 0; i < originals.length; i++) {
    const key = originals[i].trim()
    if (!key) continue
    if (seen.has(key)) out = dropTranslationFor(out, i)
    else seen.add(key)
  }
  return out
}

export const PERTURBATIONS = [
  { name: 'identity', apply: (s) => s },
  { name: 'merge-adjacent', apply: (s) => mergeAdjacent(mergeAdjacent(s, 2), 8) },
  { name: 'split-line', apply: (s) => splitLine(splitLine(s, 3), 10) },
  { name: 'drop-repeat', apply: (s, originals) => dropRepeats(s, originals) },
  { name: 'title-prefix', apply: (s) => insertNoiseLine(s, 0, 'Song Title - Artist Name') },
  { name: 'translator-note', apply: (s) => insertNoiseLine(s, 5, '(TN: this line is a pun)') },
  { name: 'section-headers', apply: (s) => insertNoiseLine(insertNoiseLine(s, 0, '[Verse 1]'), 9, '[Chorus]') },
  { name: 'trailing-credit', apply: (s) => insertNoiseLine(s, s.lines.length, 'Translated by Example') },
  {
    name: 'composite',
    apply: (s, originals) => insertNoiseLine(
      dropRepeats(mergeAdjacent(splitLine(s, 3), 8), originals),
      0,
      'Song Title - Artist Name',
    ),
  },
]
