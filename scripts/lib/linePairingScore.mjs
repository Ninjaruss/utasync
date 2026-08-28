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

export function scoreLinePairing(truth, assigned, inputLines, flagged) {
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

  // Only lines that SHOULD have been placed can be lost. A header the fitter
  // correctly discarded is not a loss.
  const placeable = new Set(truth.flat())
  const emitted = new Set(assigned.flat())
  let lines_lost = 0
  for (const line of new Set(inputLines)) {
    if (placeable.has(line) && !emitted.has(line)) lines_lost++
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
    lines_lost,
    flag_precision: flaggedCount === 0 ? null : flaggedAndWrong / flaggedCount,
    flag_recall: wrongCount === 0 ? null : flaggedAndWrong / wrongCount,
  }
}
