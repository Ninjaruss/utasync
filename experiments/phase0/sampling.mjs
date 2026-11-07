// ADR-0003's pre-registered stratified line sample, made checkable.
//
// The ADR says the sample is "computed from the lyric sheet alone and from nothing else", which
// means a machine can recompute it — so the scorer does, and a song whose marked lines disagree
// with the rule is gate-ineligible rather than quietly scored on a different sample.
//
// The rule is defined on BLOCKS — runs of lines between blank lines — so this module must read the
// RAW sheet text. `lyricLines()` strips blank lines, which are exactly the delimiters the rule is
// built on; recomputing the rule from its output would silently read the whole sheet as one block.
//
// Indices are positions in the sheet as `lyricLines()` reads it (blank lines removed), because that
// is the index space an annotation's `lines` array uses.

// Step 5's floor. Not a new threshold: it is ADR-0003's existing "≥ 20 scored lines per song"
// (ledger L41), read here as the number of marks the rule must produce.
export const SAMPLE_MINIMUM_LINES = 20

export function sampledLineIndices(rawSheetText, minimum = SAMPLE_MINIMUM_LINES) {
  const blocks = []
  let current = null
  let total = 0
  for (const row of String(rawSheetText).split(/\r?\n/)) {
    if (!row.trim()) { current = null; continue } // a blank line ends the block (step 1)
    if (!current) blocks.push((current = []))
    current.push(total++)
  }
  const marked = new Set()
  const spare = [] // interior lines the rule does not select, in sheet order, for step 5
  for (const block of blocks) {
    marked.add(block[0]) // step 2: block-first (section entry after an instrumental)
    marked.add(block[block.length - 1]) // step 3: block-last (tails and melisma)
    for (let j = 1; j < block.length - 1; j++) {
      if ((j - 1) % 3 === 0) marked.add(block[j]) // step 4: every third interior position from the block's second line
      else spare.push(block[j])
    }
  }
  // Step 5: if the rule yields fewer than `minimum` marks, add interior lines in sheet order.
  // A sheet with fewer than `minimum` lines therefore has every line marked, which is also why
  // such a sheet can never satisfy the gate's per-song clause (ADR-0003).
  for (const i of spare) { if (marked.size >= minimum) break; marked.add(i) }
  return { total, blocks: blocks.length, marked: new Set([...marked].sort((a, b) => a - b)) }
}

// Returns null when the annotation's scored lines are what the rule selects, else one printable
// sentence. Line indices only, never text (CLAUDE.md rule 6).
//
// A line counts as scored exactly as `score.mjs` counts it: `onset != null && !excluded`. Reading
// `excluded` alone would let an annotation drop a hard line by leaving its onset null.
//
// One exemption, and only one: a song scored on EVERY line of its sheet agrees, because it is the
// original whole-song gate — a superset of the rule, and impossible to cherry-pick. Any sheet with
// an unscored line must match the rule exactly, in both directions: a rule-selected line left
// unscored drops the hard cases the rule exists to over-weight, and a scored line the rule does not
// select is a sample chosen by something other than the sheet.
export function samplingRuleDisagreement(rawSheetText, annotation, minimum = SAMPLE_MINIMUM_LINES) {
  const { marked, total } = sampledLineIndices(rawSheetText, minimum)
  const lines = annotation?.lines ?? []
  if (lines.length !== total) return `the sheet reads as ${total} line(s) but the annotation has ${lines.length}, so the sampling rule cannot be checked`
  const scored = new Set(lines.flatMap((l, i) => (l.onset != null && !l.excluded ? [i] : [])))
  if (scored.size === total) return null
  const show = (xs) => xs.slice(0, 6).map((i) => i + 1).join(', ') + (xs.length > 6 ? ', …' : '')
  const absent = [...marked].filter((i) => !scored.has(i))
  const extra = [...scored].filter((i) => !marked.has(i))
  if (!absent.length && !extra.length) return null
  const parts = []
  if (absent.length) parts.push(`${absent.length} line(s) the rule selects are not scored (line ${show(absent)})`)
  if (extra.length) parts.push(`${extra.length} scored line(s) the rule does not select (line ${show(extra)})`)
  return `scored lines disagree with ADR-0003's sampling rule: ${parts.join('; ')}`
}
