/**
 * Compose perturbations of a clean 1:1 translation the way real fan
 * translations differ. Truth is known by construction, so no hand-labeling.
 *
 * State = { lines: string[], truth: string[][] }
 *   lines    — the perturbed translation block, in order
 *   truth[i] — the translation STRINGS belonging to original i ([] = none)
 *
 * Truth is tracked as strings rather than indices so a line that appears twice
 * cannot create an ambiguous mapping.
 */

export function identity(translations) {
  return { lines: [...translations], truth: translations.map((t) => [t]) }
}

function replaceInTruth(truth, olds, next) {
  const oldSet = new Set(olds)
  return truth.map((set) => {
    if (!set.some((t) => oldSet.has(t))) return [...set]
    const kept = set.filter((t) => !oldSet.has(t))
    return next == null ? kept : [...kept, ...next]
  })
}

/** Fold lines[at] and lines[at+1] into one — the translator merged two thoughts. */
export function mergeAdjacent(state, at) {
  const a = state.lines[at]
  const b = state.lines[at + 1]
  if (a == null || b == null) return { lines: [...state.lines], truth: state.truth.map((s) => [...s]) }
  const merged = `${a} ${b}`
  const lines = [...state.lines.slice(0, at), merged, ...state.lines.slice(at + 2)]
  return { lines, truth: replaceInTruth(state.truth, [a, b], [merged]) }
}

/** Index of a clause boundary in `text`, or null when there is none. */
function clauseCut(text) {
  const m = /,\s+/.exec(text)
  return m ? m.index + m[0].length : null
}

/** Split lines[at] at a clause boundary — the translator expanded one line into two. */
export function splitLine(state, at) {
  const text = state.lines[at]
  if (text == null) return { lines: [...state.lines], truth: state.truth.map((s) => [...s]) }
  const cut = clauseCut(text)
  if (cut == null) return { lines: [...state.lines], truth: state.truth.map((s) => [...s]) }
  const a = text.slice(0, cut).replace(/,\s*$/, '').trim()
  const b = text.slice(cut).trim()
  const lines = [...state.lines.slice(0, at), a, b, ...state.lines.slice(at + 1)]
  return { lines, truth: replaceInTruth(state.truth, [text], [a, b]) }
}

/** Remove the translation for one original — e.g. a chorus translated only once. */
export function dropTranslationFor(state, originalIndex) {
  const targets = state.truth[originalIndex] ?? []
  if (targets.length === 0) return { lines: [...state.lines], truth: state.truth.map((s) => [...s]) }
  const drop = new Set(targets)
  const lines = state.lines.filter((l) => !drop.has(l))
  return { lines, truth: replaceInTruth(state.truth, targets, null) }
}

/** Insert a line belonging to no original — header, note, credit. */
export function insertNoiseLine(state, at, text) {
  const lines = [...state.lines.slice(0, at), text, ...state.lines.slice(at)]
  return { lines, truth: state.truth.map((s) => [...s]) }
}
