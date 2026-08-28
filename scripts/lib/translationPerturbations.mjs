/**
 * Compose perturbations of a clean 1:1 translation the way real fan translations
 * differ. Truth is known by construction, so no hand-labeling.
 *
 * State = { lines: string[], truth: number[][] }
 *   lines    — the perturbed translation block, in order
 *   truth[i] — INDICES into `lines` belonging to original i ([] = none)
 *
 * Truth is tracked by index, not by text: two originals can legitimately share
 * identical translation text (a repeated chorus), and content-keyed truth makes
 * them bleed into each other. Use truthStrings() to get the string view for
 * scoring, where identical strings ARE interchangeable and the ambiguity is
 * harmless.
 */

const clone = (state) => ({ lines: [...state.lines], truth: state.truth.map((s) => [...s]) })

export function identity(translations) {
  return { lines: [...translations], truth: translations.map((_, i) => [i]) }
}

/**
 * Remap truth after splicing `removed` lines at `at` and inserting `inserted`.
 * `reassign` maps an old index inside the spliced region to the new indices that
 * inherit it; an old index absent from the map is dropped.
 */
function remap(truth, at, removed, inserted, reassign) {
  const delta = inserted - removed
  return truth.map((set) => {
    const out = []
    for (const idx of set) {
      if (idx < at) out.push(idx)
      else if (idx >= at + removed) out.push(idx + delta)
      else {
        const r = reassign.get(idx)
        if (r) out.push(...r)
      }
    }
    return [...new Set(out)].sort((a, b) => a - b)
  })
}

/** Fold lines[at] and lines[at+1] into one — the translator merged two thoughts. */
export function mergeAdjacent(state, at) {
  const a = state.lines[at]
  const b = state.lines[at + 1]
  if (a == null || b == null) return clone(state)
  const lines = [...state.lines.slice(0, at), `${a} ${b}`, ...state.lines.slice(at + 2)]
  const reassign = new Map([[at, [at]], [at + 1, [at]]])
  return { lines, truth: remap(state.truth, at, 2, 1, reassign) }
}

/** Index just past a clause boundary in `text`, or null when there is none. */
function clauseCut(text) {
  const m = /,\s+/.exec(text)
  return m ? m.index + m[0].length : null
}

/** Split lines[at] at a clause boundary — the translator expanded one line into two. */
export function splitLine(state, at) {
  const text = state.lines[at]
  if (text == null) return clone(state)
  const cut = clauseCut(text)
  if (cut == null) return clone(state)
  const a = text.slice(0, cut).replace(/,\s*$/, '').trim()
  const b = text.slice(cut).trim()
  const lines = [...state.lines.slice(0, at), a, b, ...state.lines.slice(at + 1)]
  return { lines, truth: remap(state.truth, at, 1, 2, new Map([[at, [at, at + 1]]])) }
}

/** Remove the translation for one original — e.g. a chorus translated only once. */
export function dropTranslationFor(state, originalIndex) {
  const targets = state.truth[originalIndex] ?? []
  if (targets.length === 0) return clone(state)
  const drop = new Set(targets)
  const lines = state.lines.filter((_, i) => !drop.has(i))
  const moved = new Map()
  let next = 0
  for (let i = 0; i < state.lines.length; i++) {
    moved.set(i, drop.has(i) ? null : next++)
  }
  const truth = state.truth.map((set) =>
    set.map((i) => moved.get(i)).filter((i) => i != null),
  )
  return { lines, truth }
}

/** Insert a line belonging to no original — header, note, credit. */
export function insertNoiseLine(state, at, text) {
  const lines = [...state.lines.slice(0, at), text, ...state.lines.slice(at)]
  const truth = state.truth.map((set) => set.map((i) => (i >= at ? i + 1 : i)))
  return { lines, truth }
}

/** Truth as STRINGS, for scoring. Identical strings are interchangeable when
 * scoring correctness, so the ambiguity that forces index-tracking above does
 * not matter here. */
export function truthStrings(state) {
  return state.truth.map((set) => set.map((i) => state.lines[i]))
}
