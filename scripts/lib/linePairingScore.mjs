/**
 * Score a fitted translation against truth. Sets are compared as multisets of
 * strings, which sidesteps the ambiguity of a translation line that repeats.
 *
 * line_wrong is the metric that matters most: a confidently wrong translation
 * teaches the wrong meaning, which is worse for a learner than a blank row.
 */

function sameSet(a, b) {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((v, i) => v === right[i])
}

export function scoreLinePairing(truth, assigned, inputLines, flagged, extras = []) {
  let line_correct = 0
  let line_wrong = 0
  let line_missing = 0

  const wrongRow = []
  for (let i = 0; i < truth.length; i++) {
    const t = truth[i] ?? []
    const a = assigned[i] ?? []
    if (sameSet(t, a)) {
      line_correct++
      wrongRow.push(false)
    } else if (a.length === 0) {
      line_missing++
      wrongRow.push(true)
    } else {
      line_wrong++
      wrongRow.push(true)
    }
  }

  // Only lines that SHOULD have been placed can be lost/unplaced. A header the
  // fitter correctly discarded is not a loss.
  //
  // Accepted limitation: if a noise line's text coincidentally equals a real
  // lyric line, it inflates inputCount and can over-report by one. The frozen
  // perturbation set uses distinctive noise text ("[Verse 1]", "Translated by
  // Example", "(TN: ...)"), so this cannot arise today.
  const countOf = (arr) => {
    const m = new Map()
    for (const t of arr) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  }
  const placeable = new Set(truth.flat())
  const inputCount = countOf(inputLines)
  const emittedCount = countOf(assigned.flat())
  const extrasCount = countOf(extras)

  // Two different questions, both worth watching:
  //   lines_unplaced — the fitter could not put it on a row (fitting quality)
  //   lines_lost     — it is on no row AND not in extras, i.e. the app destroyed it
  // Counted per OCCURRENCE: a repeated chorus line appears twice in the input and
  // losing one of them is a real loss even though the other still shows up.
  // max(0, ...) keeps a legitimately shared (merged) line — once in, twice out — at zero.
  let lines_unplaced = 0
  let lines_lost = 0
  for (const [line, n] of inputCount) {
    if (!placeable.has(line)) continue
    const placed = emittedCount.get(line) ?? 0
    const kept = placed + (extrasCount.get(line) ?? 0)
    lines_unplaced += Math.max(0, n - placed)
    lines_lost += Math.max(0, n - kept)
  }

  let flaggedCount = 0
  let flaggedAndWrong = 0
  let wrongCount = 0
  for (let i = 0; i < wrongRow.length; i++) {
    if (flagged[i]) flaggedCount++
    if (wrongRow[i]) wrongCount++
    if (flagged[i] && wrongRow[i]) flaggedAndWrong++
  }

  return {
    line_correct,
    line_wrong,
    line_missing,
    lines_unplaced,
    lines_lost,
    flag_precision: flaggedCount === 0 ? null : flaggedAndWrong / flaggedCount,
    flag_recall: wrongCount === 0 ? null : flaggedAndWrong / wrongCount,
  }
}

/** Split a fitted row's translation back into the strings it carries. */
export function assignedStrings(line) {
  const t = (line.translation ?? '').trim()
  if (!t) return []
  return t.split('\n').map((s) => s.trim()).filter(Boolean)
}

/**
 * Map output rows back onto originals. The union-timeline merge on the
 * 'mismatch' path can change the row count, so index-to-index is unsafe: walk
 * both lists monotonically, matching on `original` text. Rows with an empty
 * original (translation-only rows the merge inserted) belong to no original.
 *
 * Leans on mergeTimedTracks collapsing adjacent rows that share an `original`
 * (src/lyrics/bilingual.ts:209-214), so two consecutive rows never carry the same
 * original text. The monotonic cursor would mis-assign the second one if that
 * ever changed.
 */
export function mapRowsToOriginals(originals, rows) {
  const assigned = originals.map(() => [])
  const flagged = originals.map(() => false)
  let oi = 0
  for (const row of rows) {
    const text = (row.original ?? '').trim()
    if (!text) continue
    let k = oi
    while (k < originals.length && originals[k].trim() !== text) k++
    if (k >= originals.length) continue // unmatched row; leave the cursor put
    assigned[k].push(...assignedStrings(row))
    if ((row.translationConfidence ?? 1) < 0.5) flagged[k] = true
    oi = k + 1
  }
  return { assigned, flagged }
}
