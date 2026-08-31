# Translation Fitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a pasted translation that is not line-for-line attach correctly, visibly, and measurably — instead of silently dropping lines and blanking rows.

**Architecture:** Build a perturbation harness first (truth known by construction, because the perturbation is synthetic), baseline it on clean `main`, then extend the existing Needleman-Wunsch DP in `src/lyrics/lineAligner.ts` rather than replacing the five-route cascade. New data is additive and optional, so no DB migration.

**Tech Stack:** TypeScript, React 19, Vite 8, Vitest 4 (jsdom), `@huggingface/transformers` (multilingual MiniLM embeddings via `src/ai-pipeline/textEmbedder.ts`), Dexie/IndexedDB, plain `.mjs` Node scripts run with `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-08-27-translation-fitting-design.md`

## Global Constraints

- **The embedding cache throws on a miss.** `scripts/lib/cachedEmbedder.mjs:48-52` throws when `fallback` is absent (CI). Any change that causes a *new string* to be embedded breaks `tests/ai-pipeline/corpus-pairing.test.ts` until the cache is regenerated. Regenerate with `npx tsx scripts/audit-corpus.mjs --pairing --write-embed-cache` (needs a one-time local model download) and commit `tests/ai-pipeline/fixtures/embeddings-cache.json` **in the same commit as the change that caused the miss**. This bites in Task 2 and Task 8.
- **Freeze the perturbation set before generating the cache** (Task 2). Adding a perturbation later means another regen.
- **`pair_unpaired` / `pair_magnet` / `pair_wrong` must not move.** No groups form on 1:1 input, so `tests/ai-pipeline/corpus-pairing.test.ts` must come out byte-identical. If it moves, stop and diagnose — do not re-snapshot.
- **No DB schema migration and no `PIPELINE_VERSION` bump.** Every new field is optional; absence must mean exactly today's behavior.
- **Deterministic:** no `Math.random`, no `Date.now()` in scripts or fixtures. Perturbation indices are chosen by fixed rule, not randomly.
- **`lines_lost` ratchets at 0** from Task 5 onward. A pasted translation line may never vanish.
  Note the metric was SPLIT during Task 5 (controller ruling): `lines_unplaced` counts lines the
  fitter could not put on a row (a fitting-quality signal, expected non-zero), while `lines_lost`
  counts lines present in neither the rows nor `extras` — i.e. destroyed. Only the latter ratchets
  at 0. `lines_lost <= lines_unplaced` always. The original single metric measured placement, not
  loss, so Task 5's gate could never have moved.
- **The suite is load-sensitive.** Before calling any failure a regression, re-run that file alone: `npx vitest run <path>`.
- **Full suite:** `npm test`. **Lint:** `npm run lint`. Both must pass before each commit.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `scripts/lib/translationPerturbations.mjs` | Pure, composable perturbations over `{lines, truth}` state. No I/O. |
| `scripts/lib/linePairingScore.mjs` | Pure scoring of assigned-vs-truth. No I/O. |
| `scripts/audit-line-pairing.mjs` | The scorecard: loads corpus, perturbs, runs the real fitter, prints/writes rows. |
| `tests/lyrics/translationPerturbations.test.ts` | Unit tests for the perturbation algebra. |
| `tests/lyrics/linePairingScore.test.ts` | Unit tests for the metrics. |
| `tests/lyrics/linePairing.ratchet.test.ts` | CI lock against the committed baseline. |
| `tests/ai-pipeline/fixtures/line-pairing-baseline.json` | The baseline. |
| `src/lyrics/translationNoise.ts` | Translation-side header/title/credit detectors (mirrors the primary-side ones). |
| `src/lyrics/translationGroups.ts` | Group helpers: build groups from DP buckets, read groups for display. |
| `src/lyrics/TranslationRepairPopover.tsx` | In-context repair for a flagged row. |

**Modified:**

| File | Change |
| --- | --- |
| `src/core/types/index.ts` | `TimedLine.translationGroup`, `.translationConfidence`; `LyricsData.unplacedTranslations`, `.translationSource`, `.translationPairing` |
| `src/lyrics/lineAligner.ts` | `G` move, skip penalty, confidence emission, extras threading, group output |
| `src/lyrics/bilingual.ts` | Group-aware attach helpers |
| `src/lyrics/SecondLanguagePanel.tsx` | Optimistic apply, wrong-song gate, real extras, progress |
| `src/lyrics/LyricDisplay.tsx` | Bracketed group rendering, flag underline |
| `src/ai-pipeline/wordAligner.ts` | Pair a group as one unit, distribute indices back per row |
| `src/lyrics/EditMode.tsx` | Re-home `AlignmentEditor` under the More menu |

---

## Phase 0 — Instrument

### Task 1: Perturbation algebra

**Files:**
- Create: `scripts/lib/translationPerturbations.mjs`
- Test: `tests/lyrics/translationPerturbations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `identity(translations: string[]) => State` where `State = { lines: string[]; truth: number[][] }`
  - `mergeAdjacent(state: State, at: number) => State`
  - `splitLine(state: State, at: number) => State`
  - `dropTranslationFor(state: State, originalIndex: number) => State`
  - `insertNoiseLine(state: State, at: number, text: string) => State`
  - `truthStrings(state: State) => string[][]`

`truth[i]` is the set of **indices into `lines`** belonging to original `i`; empty means that original legitimately has no translation.

**Truth is tracked by index, not by text.** Two originals can legitimately share identical translation text — a repeated chorus — and content-keyed truth makes them bleed into each other: dropping one original's line would delete the other's identical line and blank its truth. `truthStrings(state)` gives the string view for scoring, where identical strings genuinely ARE interchangeable and the ambiguity is harmless. (Controller ruling, Task 1 fix round 1.)

- [ ] **Step 1: Write the failing test**

```ts
// tests/lyrics/translationPerturbations.test.ts
import { describe, it, expect } from 'vitest'
import {
  identity, mergeAdjacent, splitLine, dropTranslationFor, insertNoiseLine,
} from '../../scripts/lib/translationPerturbations.mjs'

const T = ['alpha one', 'beta two', 'gamma three, delta four', 'epsilon five']

describe('identity', () => {
  it('maps each original to its own line', () => {
    const s = identity(T)
    expect(s.lines).toEqual(T)
    expect(s.truth).toEqual([['alpha one'], ['beta two'], ['gamma three, delta four'], ['epsilon five']])
  })
})

describe('mergeAdjacent', () => {
  it('folds two lines into one and maps both originals to it', () => {
    const s = mergeAdjacent(identity(T), 0)
    expect(s.lines).toEqual(['alpha one beta two', 'gamma three, delta four', 'epsilon five'])
    expect(s.truth[0]).toEqual(['alpha one beta two'])
    expect(s.truth[1]).toEqual(['alpha one beta two'])
    expect(s.truth[2]).toEqual(['gamma three, delta four'])
  })
})

describe('splitLine', () => {
  it('splits at a clause boundary and maps one original to both halves', () => {
    const s = splitLine(identity(T), 2)
    expect(s.lines).toEqual(['alpha one', 'beta two', 'gamma three', 'delta four', 'epsilon five'])
    expect(s.truth[2]).toEqual(['gamma three', 'delta four'])
    expect(s.truth[3]).toEqual(['epsilon five'])
  })

  it('is a no-op when the line has no clause boundary', () => {
    const s = splitLine(identity(T), 0)
    expect(s.lines).toEqual(T)
  })
})

describe('dropTranslationFor', () => {
  it('removes the line and leaves that original with no truth', () => {
    const s = dropTranslationFor(identity(T), 1)
    expect(s.lines).toEqual(['alpha one', 'gamma three, delta four', 'epsilon five'])
    expect(s.truth[1]).toEqual([])
    expect(s.truth[2]).toEqual(['gamma three, delta four'])
  })
})

describe('insertNoiseLine', () => {
  it('inserts a line that belongs to no original', () => {
    const s = insertNoiseLine(identity(T), 0, '[Chorus]')
    expect(s.lines[0]).toBe('[Chorus]')
    expect(s.truth.flat()).not.toContain('[Chorus]')
    expect(s.truth[0]).toEqual(['alpha one'])
  })
})

describe('composition', () => {
  it('composes without corrupting truth', () => {
    const s = insertNoiseLine(mergeAdjacent(identity(T), 0), 0, 'Song Title')
    expect(s.lines).toEqual(['Song Title', 'alpha one beta two', 'gamma three, delta four', 'epsilon five'])
    expect(s.truth[0]).toEqual(['alpha one beta two'])
    expect(s.truth[1]).toEqual(['alpha one beta two'])
    expect(s.truth[3]).toEqual(['epsilon five'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/translationPerturbations.test.ts`
Expected: FAIL — cannot resolve `scripts/lib/translationPerturbations.mjs`.

- [ ] **Step 3: Implement**

```js
// scripts/lib/translationPerturbations.mjs
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lyrics/translationPerturbations.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/translationPerturbations.mjs tests/lyrics/translationPerturbations.test.ts
git commit -m "test: perturbation algebra for translation fitting, truth by construction"
```

---

### Task 2: Scoring + the scorecard script

**Files:**
- Create: `scripts/lib/linePairingScore.mjs`, `scripts/lib/linePairingCorpus.mjs`, `scripts/audit-line-pairing.mjs`
- Test: `tests/lyrics/linePairingScore.test.ts`
- Modify: `tests/ai-pipeline/fixtures/embeddings-cache.json` (regenerated)

**Interfaces:**
- Consumes: `identity`, `mergeAdjacent`, `splitLine`, `dropTranslationFor`, `insertNoiseLine`, `truthStrings` from Task 1; `createCachedEmbedTexts` from `scripts/lib/cachedEmbedder.mjs`; `smartAttachSecondLanguage` from `src/lyrics/lineAligner.ts`.
- Produces: `scoreLinePairing(truth: string[][], assigned: string[][], inputLines: string[], flagged: boolean[]) => Metrics` where `Metrics = { line_correct, line_wrong, line_missing, lines_lost, flag_precision, flag_recall }`.

**The perturbation set is frozen here.** Adding one later requires another embedding-cache regen.

**Controller ruling F3:** `PERTURBATIONS` and `dropRepeats` live in `scripts/lib/linePairingCorpus.mjs`, NOT in the audit script. The audit script calls `main()` at module top level (mirroring `audit-corpus.mjs`), so Task 3's ratchet could not import the perturbation set from it without executing the whole audit as a side effect.

**Controller ruling F1:** the scorecard builds a **timed** primary, not an untimed one. Verified at `src/lyrics/lineAligner.ts:969-972`: an untimed primary returns `content` directly and never reaches `finalizeTimedAttach`, so an untimed scorecard could never observe Task 5's fix. Timed is also the realistic case — users attach a translation to an already-aligned song. Because the `'mismatch'` path's union merge can change the row count, output rows are mapped back to originals by walking both lists monotonically on `line.original`, never by index.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lyrics/linePairingScore.test.ts
import { describe, it, expect } from 'vitest'
import { scoreLinePairing, mapRowsToOriginals } from '../../scripts/lib/linePairingScore.mjs'

describe('scoreLinePairing', () => {
  it('counts an exact match as correct', () => {
    const m = scoreLinePairing([['a'], ['b']], [['a'], ['b']], ['a', 'b'], [false, false])
    expect(m.line_correct).toBe(2)
    expect(m.line_wrong).toBe(0)
    expect(m.line_missing).toBe(0)
    expect(m.lines_lost).toBe(0)
  })

  it('counts a non-empty wrong assignment as wrong, not missing', () => {
    const m = scoreLinePairing([['a'], ['b']], [['b'], ['a']], ['a', 'b'], [false, false])
    expect(m.line_wrong).toBe(2)
    expect(m.line_missing).toBe(0)
  })

  it('counts an empty assignment against non-empty truth as missing', () => {
    const m = scoreLinePairing([['a'], ['b']], [['a'], []], ['a', 'b'], [false, false])
    expect(m.line_correct).toBe(1)
    expect(m.line_missing).toBe(1)
  })

  it('an original with no truth and no assignment is correct', () => {
    const m = scoreLinePairing([['a'], []], [['a'], []], ['a'], [false, false])
    expect(m.line_correct).toBe(2)
  })

  it('counts input lines appearing nowhere in the output as lost', () => {
    const m = scoreLinePairing([['a'], ['b']], [['a'], []], ['a', 'b'], [false, false])
    expect(m.lines_lost).toBe(1)
  })

  it('a noise line that is correctly placed nowhere is not lost', () => {
    // '[Chorus]' belongs to no original; the fitter dropped it. That is correct,
    // so it must not count as lost — only lines with truth can be lost.
    const m = scoreLinePairing([['a']], [['a']], ['a', '[Chorus]'], [false])
    expect(m.lines_lost).toBe(0)
  })

  it('scores flag precision and recall against actual wrongness', () => {
    // row 0 correct+unflagged, row 1 wrong+flagged, row 2 wrong+unflagged
    const m = scoreLinePairing(
      [['a'], ['b'], ['c']],
      [['a'], ['x'], ['y']],
      ['a', 'b', 'c'],
      [false, true, false],
    )
    expect(m.flag_precision).toBe(1)    // 1 flagged, 1 of them wrong
    expect(m.flag_recall).toBeCloseTo(0.5) // 2 wrong, 1 caught
  })

  it('reports precision and recall as null when there is nothing to score', () => {
    const m = scoreLinePairing([['a']], [['a']], ['a'], [false])
    expect(m.flag_precision).toBeNull()  // nothing flagged
    expect(m.flag_recall).toBeNull()     // nothing wrong
  })

  it('counts a lost occurrence of a REPEATED line', () => {
    // Same text as two separate input lines; the fitter placed only one.
    const m = scoreLinePairing(
      [['refrain'], ['verse'], ['refrain']],
      [['refrain'], ['verse'], []],
      ['refrain', 'verse', 'refrain'],
      [false, false, false],
    )
    expect(m.lines_lost).toBe(1)
  })

  it('does not count a shared (merged) line as lost', () => {
    // ONE input line legitimately covering two rows: output repeats it, input had it once.
    const m = scoreLinePairing(
      [['both'], ['both']], [['both'], ['both']], ['both'], [false, false],
    )
    expect(m.lines_lost).toBe(0)
  })

  it('counts every lost occurrence when a line repeats three times', () => {
    const m = scoreLinePairing(
      [['x'], ['x'], ['x']], [['x'], [], []], ['x', 'x', 'x'], [false, false, false],
    )
    expect(m.lines_lost).toBe(2)
  })
})

describe('mapRowsToOriginals', () => {
  const row = (original: string, translation: string, translationConfidence?: number) =>
    ({ startTime: 0, endTime: 1, original, translation, translationConfidence })

  it('maps rows to originals positionally', () => {
    const { assigned } = mapRowsToOriginals(['a', 'b'], [row('a', 'x'), row('b', 'y')])
    expect(assigned).toEqual([['x'], ['y']])
  })

  it('distinguishes two non-adjacent originals with identical text', () => {
    const { assigned } = mapRowsToOriginals(
      ['same', 'other', 'same'],
      [row('same', 'first'), row('other', 'mid'), row('same', 'third')],
    )
    expect(assigned).toEqual([['first'], ['mid'], ['third']])
  })

  it('skips rows with an empty original', () => {
    const { assigned } = mapRowsToOriginals(
      ['a', 'b'], [row('a', 'x'), row('', 'orphan'), row('b', 'y')],
    )
    expect(assigned).toEqual([['x'], ['y']])
  })

  it('ignores a row matching no original without losing the cursor', () => {
    const { assigned } = mapRowsToOriginals(
      ['a', 'b'], [row('a', 'x'), row('ghost', 'no'), row('b', 'y')],
    )
    expect(assigned).toEqual([['x'], ['y']])
  })

  it('splits a multi-line translation into its parts', () => {
    const { assigned } = mapRowsToOriginals(['a'], [row('a', 'one\ntwo')])
    expect(assigned).toEqual([['one', 'two']])
  })

  it('flags a row below the confidence threshold', () => {
    const { flagged } = mapRowsToOriginals(['a', 'b'], [row('a', 'x', 0.2), row('b', 'y', 0.9)])
    expect(flagged).toEqual([true, false])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/linePairingScore.test.ts`
Expected: FAIL — cannot resolve `scripts/lib/linePairingScore.mjs`.

- [ ] **Step 3: Implement the scorer**

```js
// scripts/lib/linePairingScore.mjs
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
  //
  // Counted per OCCURRENCE, not by set membership: a repeated chorus line appears
  // twice in the input, and losing one of them is a real loss even though the other
  // still shows up. Set-based comparison reported 0 for exactly that case, which
  // would have made the Task 5 `lines_lost == 0` ratchet a false guarantee.
  //
  // A line legitimately shared across rows (the merge case) appears ONCE in the
  // input but twice in the output, so max(0, ...) correctly yields no loss.
  //
  // Limitation: a noise line whose text coincides with a real lyric line inflates
  // inputCount and can over-report by one. The frozen perturbation set uses
  // distinctive noise text, so this cannot arise today.
  const countOf = (arr) => {
    const m = new Map()
    for (const t of arr) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  }
  const placeable = new Set(truth.flat())
  const inputCount = countOf(inputLines)
  const emittedCount = countOf(assigned.flat())
  let lines_lost = 0
  for (const [line, n] of inputCount) {
    if (!placeable.has(line)) continue
    lines_lost += Math.max(0, n - (emittedCount.get(line) ?? 0))
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

/** Split a fitted row's translation back into the strings it carries. */
export function assignedStrings(line) {
  const t = (line.translation ?? '').trim()
  if (!t) return []
  return t.split('\n').map((s) => s.trim()).filter(Boolean)
}

/**
 * Map output rows back onto originals. The union-timeline merge on the 'mismatch'
 * path can change the row count, so index-to-index is unsafe: walk both lists
 * monotonically, matching on `original` text. Rows with an empty original
 * (translation-only rows the merge inserted) belong to no original.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lyrics/linePairingScore.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the frozen perturbation set (ruling F3)**

Side-effect-free, so both the audit script and Task 3's ratchet can import it.

```js
// scripts/lib/linePairingCorpus.mjs
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
```

Note `dropRepeats` walks originals in ascending order and calls `dropTranslationFor`
repeatedly. After the Task 1 ruling, truth is index-based and `dropTranslationFor`
re-maps every surviving index on each call, so successive calls compose correctly.

- [ ] **Step 6: Write the scorecard script**

```js
// scripts/audit-line-pairing.mjs
/**
 * Line-pairing scorecard. Perturbs the ENGLISH side of each clean 1:1 corpus
 * fixture the way real fan translations differ, then scores what the fitter
 * recovers. Truth is known by construction.
 *
 * The committed fixtures are all exactly line-parallel (veil 48/48, akfg 30/30,
 * guitar 47/47), so the existing pairing ratchet only ever exercises the case
 * that already works. This is the instrument for the case that does not.
 *
 * Run:
 *   npx tsx scripts/audit-line-pairing.mjs
 *   npx tsx scripts/audit-line-pairing.mjs --write-baseline
 *   npx tsx scripts/audit-line-pairing.mjs --check-baseline
 *
 * Lower is better for line_wrong / line_missing / lines_lost; higher for
 * line_correct / flag_precision / flag_recall.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createCachedEmbedTexts } from './lib/cachedEmbedder.mjs'
import { scoreLinePairing, mapRowsToOriginals } from './lib/linePairingScore.mjs'
import { identity, truthStrings } from './lib/translationPerturbations.mjs'
import { PERTURBATIONS } from './lib/linePairingCorpus.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const FIXTURES = join(root, 'tests/ai-pipeline/fixtures')
const BASELINE = join(FIXTURES, 'line-pairing-baseline.json')

const WRITE_BASELINE = process.argv.includes('--write-baseline')
const CHECK_BASELINE = process.argv.includes('--check-baseline')
const WRITE_EMBED_CACHE = process.argv.includes('--write-embed-cache')

function readLines(path) {
  return readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
}

async function main() {
  const corpus = JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8'))
  const { smartAttachSecondLanguage } = await import(
    pathToFileURL(join(root, 'src/lyrics/lineAligner.ts')).href
  )

  let fallback = null
  if (WRITE_EMBED_CACHE) {
    // NOT src/ai-pipeline/textEmbedder.ts — that requires a browser Worker and
    // throws "Worker is not defined" under Node. scripts/lib/nodeEmbedder.mjs is
    // the same model without the worker, and audit-corpus.mjs:131 already uses it
    // this way. Getting this wrong fails SILENTLY: smartAttachSecondLanguage
    // swallows embedding errors (lineAligner.ts:867) into an index-pairing
    // fallback, so the cache never grows and the scorecard measures structural
    // fallback instead of semantic alignment. (Controller ruling, Task 2.)
    const mod = await import(pathToFileURL(join(root, 'scripts/lib/nodeEmbedder.mjs')).href)
    fallback = mod.embedTexts
  }
  const { embedTexts, flush } = createCachedEmbedTexts({
    cachePath: join(FIXTURES, 'embeddings-cache.json'),
    fallback,
  })

  const songs = corpus.songs.filter((s) => s.en)
  const rows = []

  for (const song of songs) {
    const originals = readLines(join(FIXTURES, song.lyrics))
    const translations = readLines(join(FIXTURES, song.en))

    for (const p of PERTURBATIONS) {
      const state = p.apply(identity(translations), originals)
      // TIMED primary (ruling F1): the realistic case, and the only one that
      // reaches finalizeTimedAttach, where the extras-dropping bug lives.
      // Timestamps are synthetic but ordered and non-zero.
      const primary = originals.map((original, i) => ({
        startTime: i * 2, endTime: i * 2 + 2, original, translation: '',
      }))

      const result = await smartAttachSecondLanguage(
        primary,
        state.lines.join('\n'),
        embedTexts,
      )
      const { assigned, flagged } = mapRowsToOriginals(originals, result.lines)
      const m = scoreLinePairing(truthStrings(state), assigned, state.lines, flagged)

      rows.push({ song: song.name, perturbation: p.name, n: originals.length, ...m })
    }
  }

  const fmt = (v) => (v == null ? '-' : typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v))
  for (const r of rows) {
    console.log(
      `${r.song.padEnd(24)} ${r.perturbation.padEnd(16)} ` +
      `ok ${fmt(r.line_correct).padStart(3)}  wrong ${fmt(r.line_wrong).padStart(3)}  ` +
      `missing ${fmt(r.line_missing).padStart(3)}  lost ${fmt(r.lines_lost).padStart(3)}  ` +
      `flagP ${fmt(r.flag_precision).padStart(5)}  flagR ${fmt(r.flag_recall).padStart(5)}`,
    )
  }

  if (WRITE_EMBED_CACHE && flush()) console.log('\nEmbedding cache written.')

  if (WRITE_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(rows, null, 2) + '\n')
    console.log(`\nBaseline written to ${BASELINE}`)
  }

  if (CHECK_BASELINE) {
    if (!existsSync(BASELINE)) throw new Error('No baseline; run --write-baseline first.')
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
    const key = (r) => `${r.song}::${r.perturbation}`
    const byKey = new Map(base.map((r) => [key(r), r]))
    let failed = false
    for (const r of rows) {
      const b = byKey.get(key(r))
      if (!b) { console.error(`NEW ROW ${key(r)}`); failed = true; continue }
      for (const metric of ['line_wrong', 'line_missing', 'lines_lost']) {
        if (r[metric] > b[metric]) {
          console.error(`REGRESSION ${key(r)} ${metric}: ${b[metric]} -> ${r[metric]}`)
          failed = true
        }
      }
      if (r.line_correct < b.line_correct) {
        console.error(`REGRESSION ${key(r)} line_correct: ${b.line_correct} -> ${r.line_correct}`)
        failed = true
      }
    }
    if (failed) process.exit(1)
    console.log('\nBaseline OK.')
  }
}

main()
```

- [ ] **Step 7: Regenerate the embedding cache (one-time model download)**

Run: `npx tsx scripts/audit-line-pairing.mjs --write-embed-cache`
Expected: the perturbed strings are embedded and `embeddings-cache.json` grows. Confirm the old corpus test still passes on the enlarged cache:
Run: `npx vitest run tests/ai-pipeline/corpus-pairing.test.ts`
Expected: PASS, and its numbers unchanged (the cache only gained entries).

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/linePairingScore.mjs scripts/lib/linePairingCorpus.mjs scripts/audit-line-pairing.mjs \
        tests/lyrics/linePairingScore.test.ts tests/ai-pipeline/fixtures/embeddings-cache.json
git commit -m "test: line-pairing scorecard over perturbed translations"
```

---

### Task 3: Baseline and ratchet

**Files:**
- Create: `tests/ai-pipeline/fixtures/line-pairing-baseline.json`, `tests/lyrics/linePairing.ratchet.test.ts`

**Interfaces:**
- Consumes: `scripts/audit-line-pairing.mjs` (`PERTURBATIONS`), `scoreLinePairing`, the perturbation algebra.
- Produces: the committed baseline every later phase is measured against.

- [ ] **Step 1: Capture the baseline on clean main**

Run: `npx tsx scripts/audit-line-pairing.mjs --write-baseline`

Read the printed table before committing. **This is the deliverable of Phase 0** — it is the first honest measurement of how the fitter behaves on realistic input. Expect `identity` to look good and the others not to. Record anything surprising in the commit message.

- [ ] **Step 2: Write the ratchet test (ruling F2)**

The ratchet RE-RUNS the measurement through the committed embedding cache and compares fresh
numbers to the baseline — mirroring `tests/ai-pipeline/corpus-pairing.test.ts`. It must not merely
assert over the baseline file's own contents: a test that reads a number and compares it to itself
asserts nothing.

```ts
// tests/lyrics/linePairing.ratchet.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { smartAttachSecondLanguage } from '../../src/lyrics/lineAligner'
import { identity, truthStrings } from '../../scripts/lib/translationPerturbations.mjs'
import { PERTURBATIONS } from '../../scripts/lib/linePairingCorpus.mjs'
import { scoreLinePairing, mapRowsToOriginals } from '../../scripts/lib/linePairingScore.mjs'
import { createCachedEmbedTexts } from '../../scripts/lib/cachedEmbedder.mjs'
import type { TimedLine } from '../../src/core/types'

/**
 * CI guard for line-pairing accuracy on perturbed (non-1:1) translations.
 * Uses the committed embedding cache so it is deterministic and needs no model
 * download — a cache miss throws rather than silently embedding.
 * Re-snapshot ONLY with a findings note:
 *   npx tsx scripts/audit-line-pairing.mjs --write-baseline
 */
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, '../ai-pipeline/fixtures')

interface Row {
  song: string
  perturbation: string
  line_correct: number
  line_wrong: number
  line_missing: number
  lines_lost: number
}

const readLines = (p: string) =>
  readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)

describe('line-pairing ratchet', () => {
  const baseline: Row[] = JSON.parse(
    readFileSync(join(FIXTURES, 'line-pairing-baseline.json'), 'utf8'),
  )
  const corpus = JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8'))
  const songs = corpus.songs.filter((s: { en?: string }) => s.en)
  const measured = new Map<string, Row>()

  beforeAll(async () => {
    const { embedTexts } = createCachedEmbedTexts({
      cachePath: join(FIXTURES, 'embeddings-cache.json'),
    })
    for (const song of songs) {
      const originals = readLines(join(FIXTURES, song.lyrics))
      const translations = readLines(join(FIXTURES, song.en))
      for (const p of PERTURBATIONS) {
        const state = p.apply(identity(translations), originals)
        const primary: TimedLine[] = originals.map((original, i) => ({
          startTime: i * 2, endTime: i * 2 + 2, original, translation: '',
        }))
        const result = await smartAttachSecondLanguage(
          primary, state.lines.join('\n'), embedTexts,
        )
        const { assigned, flagged } = mapRowsToOriginals(originals, result.lines)
        const m = scoreLinePairing(truthStrings(state), assigned, state.lines, flagged)
        measured.set(`${song.name}::${p.name}`, { song: song.name, perturbation: p.name, ...m })
      }
    }
  }, 120_000)

  it('measures every baseline row', () => {
    expect(baseline.length).toBeGreaterThan(0)
    for (const b of baseline) {
      expect(measured.has(`${b.song}::${b.perturbation}`), `${b.song}/${b.perturbation}`).toBe(true)
    }
  })

  it('never regresses against the committed baseline', () => {
    for (const b of baseline) {
      const m = measured.get(`${b.song}::${b.perturbation}`)!
      const where = `${b.song}/${b.perturbation}`
      expect(m.line_wrong, `${where} line_wrong`).toBeLessThanOrEqual(b.line_wrong)
      expect(m.line_missing, `${where} line_missing`).toBeLessThanOrEqual(b.line_missing)
      expect(m.lines_lost, `${where} lines_lost`).toBeLessThanOrEqual(b.lines_lost)
      expect(m.line_correct, `${where} line_correct`).toBeGreaterThanOrEqual(b.line_correct)
    }
  })
})
```

- [ ] **Step 3: Run the ratchet**

Run: `npx vitest run tests/lyrics/linePairing.ratchet.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. Re-run any failure in isolation before treating it as real.

- [ ] **Step 5: Commit**

```bash
git add tests/ai-pipeline/fixtures/line-pairing-baseline.json tests/lyrics/linePairing.ratchet.test.ts
git commit -m "test: baseline line-pairing accuracy on perturbed translations

First measurement of the fitter on non-1:1 input. See the table in
docs/superpowers/specs/2026-08-27-translation-fitting-design.md."
```

---

## Phase 1 — Model and plumbing

### Task 4: Optional model fields

**Files:**
- Modify: `src/core/types/index.ts:71-81` (TimedLine), `src/core/types/index.ts:105` (LyricsData)
- Test: `tests/core/translationModel.test.ts` (create)

**Interfaces:**
- Produces: `TimedLine.translationGroup?: number`, `TimedLine.translationConfidence?: number`, `LyricsData.unplacedTranslations?`, `.translationSource?`, `.translationPairing?`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/translationModel.test.ts
import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import type { TimedLine, LyricsData } from '../../src/core/types'

describe('translation model fields', () => {
  it('a line without the new fields is unchanged', () => {
    const line: TimedLine = { startTime: 0, endTime: 1, original: 'a', translation: 'b' }
    expect(line.translationGroup).toBeUndefined()
    expect(line.translationConfidence).toBeUndefined()
  })

  it('round-trips groups and confidence through structured clone', async () => {
    const lines: TimedLine[] = [
      { startTime: 0, endTime: 1, original: 'a', translation: 'x', translationGroup: 1, translationConfidence: 0.9 },
      { startTime: 1, endTime: 2, original: 'b', translation: 'x', translationGroup: 1, translationConfidence: 0.4 },
    ]
    const data: LyricsData = {
      lines,
      sourceLanguage: 'ja',
      translationLanguage: 'en',
      alignmentMode: 'manual',
      translationSource: 'x',
      unplacedTranslations: [{ text: 'orphan', afterLineIndex: 1 }],
      translationPairing: { method: 'semantic', meanConfidence: 0.65, flaggedLineCount: 1, version: 1 },
    }
    const clone = structuredClone(data)
    expect(clone.lines[0].translationGroup).toBe(1)
    expect(clone.lines[1].translationGroup).toBe(1)
    expect(clone.unplacedTranslations?.[0]).toEqual({ text: 'orphan', afterLineIndex: 1 })
    expect(clone.translationPairing?.version).toBe(1)
    void Dexie
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/translationModel.test.ts`
Expected: FAIL — TypeScript errors, `translationGroup` does not exist on `TimedLine`.

- [ ] **Step 3: Add the fields**

In `src/core/types/index.ts`, extend `TimedLine` (after `grammarAnnotations`):

```ts
  /** Rows sharing an id share ONE translation, rendered once and bracketed
   * across them (a translator folded two sung lines into one thought).
   * Every row in a group carries the SAME `translation` string, so consumers
   * that ignore this field degrade to repeating it — never to a blank row.
   * Absent ⇒ this row is its own group (legacy behavior). */
  translationGroup?: number
  /** 0–1 confidence in this row's translation pairing. Absent ⇒ unflagged. */
  translationConfidence?: number
```

And extend `LyricsData` (after `sheetLinesSnapshot`):

```ts
  /** Pasted translation lines the fitter could not place, with the row they were
   * expected after — so repair can show them in context, not as a nameless tail. */
  unplacedTranslations?: { text: string; afterLineIndex: number }[]
  /** The raw pasted translation block, retained so a later fitter improvement can
   * re-fit without asking the user to paste again. `translationPairing.version`
   * is inert without this. */
  translationSource?: string
  /** Summary of the last translation fit. `version` is a CONTENT version for the
   * pairing, independent of the DB schema and of alignmentPipelineVersion. */
  translationPairing?: {
    method: 'index' | 'slots' | 'semantic' | 'timeline' | 'mismatch'
    meanConfidence: number
    flaggedLineCount: number
    version: number
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/translationModel.test.ts` and `npx tsc -b`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/types/index.ts tests/core/translationModel.test.ts
git commit -m "feat: optional translation group, confidence and provenance fields"
```

---

### Task 5: Stop losing lines

**Files:**
- Modify: `src/lyrics/lineAligner.ts:786-812` (`finalizeTimedAttach`)
- Test: `tests/lyrics/lineAligner.extras.test.ts` (create)

**Interfaces:**
- Consumes: `SmartAttachResult` (`src/lyrics/lineAligner.ts:624`).
- Produces: `finalizeTimedAttach` now propagates `content.extras` and a real `mismatchedBlocks` instead of hardcoding both empty.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lyrics/lineAligner.extras.test.ts
import { describe, it, expect } from 'vitest'
import { smartAttachSecondLanguage } from '../../src/lyrics/lineAligner'
import type { TimedLine } from '../../src/core/types'

const embed = async (texts: string[]) =>
  texts.map((t) => {
    // Deterministic pseudo-embedding: unit vector keyed on length + first char.
    const v = new Array(8).fill(0)
    v[t.length % 8] = 1
    return v
  })

describe('extras are never silently dropped', () => {
  it('reports unplaced translation lines on a TIMED primary', async () => {
    const primary: TimedLine[] = [
      { startTime: 1, endTime: 2, original: 'アルファ', translation: '' },
      { startTime: 2, endTime: 3, original: 'ベータ', translation: '' },
    ]
    // Four translation lines for two rows: at least two cannot be placed 1:1.
    const secondary = 'one\ntwo\nthree\nfour'
    const result = await smartAttachSecondLanguage(primary, secondary, embed)

    const emitted = result.lines.flatMap((l) => (l.translation ?? '').split('\n').filter(Boolean))
    const all = [...emitted, ...(result.extras ?? [])]
    for (const line of ['one', 'two', 'three', 'four']) {
      expect(all, `"${line}" must survive somewhere`).toContain(line)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/lineAligner.extras.test.ts`
Expected: FAIL — at least one input line appears in neither the rows nor `extras`, because `finalizeTimedAttach` returns `extras: []`.

- [ ] **Step 3: Fix `finalizeTimedAttach`**

Replace the return block at `src/lyrics/lineAligner.ts:806-811`:

```ts
  return {
    lines,
    // Propagate rather than hardcode: smartAttachSecondLanguageFromLines already
    // computed these correctly, and blanking them here is what made unplaced
    // translation lines vanish without telling anyone.
    mismatchedBlocks: content.mismatchedBlocks,
    method: usedTimeline && content.method === 'mismatch' ? 'timeline' : content.method,
    extras: content.extras ?? [],
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lyrics/lineAligner.extras.test.ts`
Expected: PASS.

Run: `npx vitest run tests/ai-pipeline/corpus-pairing.test.ts tests/lyrics/`
Expected: PASS. **If `corpus-pairing` numbers move, stop** — no groups exist yet, so they must not.

- [ ] **Step 5: Re-measure and confirm `lines_lost` improved**

**Controller ruling (Task 5):** this step is only meaningful after the metric split. The scorer
originally never received `result.extras`, so a line rescued into extras still counted as lost and
this gate could not move. `scoreLinePairing` now takes `extras` as a final parameter and reports two
numbers: `lines_unplaced` (not on any row) and `lines_lost` (in neither rows nor extras).

Run: `npx tsx scripts/audit-line-pairing.mjs`
Expected: `lines_lost` drops from 4 to 0 — that is this task's fix becoming visible — while
`lines_unplaced` still shows 4. Re-snapshot:
Run: `npx tsx scripts/audit-line-pairing.mjs --write-baseline`

Also expected: `tests/lyrics/lineAligner.test.ts` and `tests/lyrics/akfg-user-paste.test.ts` each
hardcode `expect(result.mismatchedBlocks).toEqual([])`, which was only true because
`finalizeTimedAttach` blanked the field. Update ONLY that expectation in each, leaving every
substantive assertion untouched.

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/lineAligner.ts tests/lyrics/lineAligner.extras.test.ts \
        tests/ai-pipeline/fixtures/line-pairing-baseline.json
git commit -m "fix: stop silently discarding unplaced translation lines

finalizeTimedAttach hardcoded extras and mismatchedBlocks to empty one frame
after the DP computed them correctly."
```

---

### Task 6: Per-row confidence

**Files:**
- Modify: `src/lyrics/lineAligner.ts:524-622` (`autoAlignLines`), `:763-779` (`semanticAlignToPrimaryLines`), `:818-910`
- Test: `tests/lyrics/lineAligner.confidence.test.ts` (create)

**Interfaces:**
- Consumes: the DP in `autoAlignLines`.
- Produces: `autoAlignLines` returns `{ aligned: string[]; extras: string[]; confidence: number[] }`; `semanticAlignToPrimaryLines` returns the same shape mapped onto primary rows; `SmartAttachResult` gains `confidence?: number[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lyrics/lineAligner.confidence.test.ts
import { describe, it, expect } from 'vitest'
import { autoAlignLines } from '../../src/lyrics/lineAligner'

/** Embeds so that 'match-N' aligns with 'MATCH-N' and nothing else. */
const embed = async (texts: string[]) =>
  texts.map((t) => {
    const v = new Array(16).fill(0)
    const m = /match-(\d+)/i.exec(t)
    v[m ? Number(m[1]) % 16 : 15] = 1
    return v
  })

describe('autoAlignLines confidence', () => {
  it('scores a clean pairing high and a forced one low', async () => {
    const originals = ['match-1', 'match-2', 'match-3']
    const translations = ['MATCH-1', 'MATCH-2', 'nothing like it']
    const { confidence } = await autoAlignLines(originals, translations, embed)

    expect(confidence).toHaveLength(3)
    expect(confidence[0]).toBeGreaterThan(0.7)
    expect(confidence[1]).toBeGreaterThan(0.7)
    expect(confidence[2]).toBeLessThan(0.5)
  })

  it('gives an unpaired original zero confidence', async () => {
    const { aligned, confidence } = await autoAlignLines(
      ['match-1', 'match-2'], ['MATCH-1'], embed,
    )
    expect(aligned[1]).toBe('')
    expect(confidence[1]).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/lineAligner.confidence.test.ts`
Expected: FAIL — `confidence` is undefined.

- [ ] **Step 3: Emit confidence from the DP**

In `autoAlignLines`, alongside the existing `buckets` accumulation in the traceback (around `src/lyrics/lineAligner.ts:592-621`), record the score of the move taken for each original. Add before the traceback loop:

```ts
  const rowScore: number[] = new Array(n).fill(0)
```

In the traceback, when the move is `'D'`, record the pair score; when `'M'`, record the merged score; leave `'U'` rows at 0:

```ts
    if (b === 'D') {
      buckets[i - 1].unshift(translations[j - 1])
      rowScore[i - 1] = scoreAt(i - 1, j - 1)
      usedTrans.add(j - 1)
      i--
      j--
    } else if (b === 'M') {
      buckets[i - 1].unshift(translations[j - 1])
      buckets[i - 1].unshift(translations[j - 2])
      rowScore[i - 1] = pairScore(i - 1, `${translations[j - 2]}\n${translations[j - 1]}`, mergedVecs[j - 2])
      usedTrans.add(j - 1)
      usedTrans.add(j - 2)
      i--
      j -= 2
    } else if (b === 'U') {
```

Then normalize into 0–1 and return it. Scores are `0.7 * cosine + 0.3 * lexical`, so they already sit in roughly [-1, 1]; clamp:

```ts
  const aligned = buckets.map((parts) => parts.join('\n'))
  const extras = translations.filter((_, idx) => !usedTrans.has(idx))
  const confidence = rowScore.map((s, idx) =>
    buckets[idx].length === 0 ? 0 : Math.max(0, Math.min(1, s)),
  )
  return { aligned, extras, confidence }
```

Thread it through `semanticAlignToPrimaryLines`:

```ts
  const { aligned: partial, extras, confidence: partialConf } = await autoAlignLines(texts, translations, embedFn)
  const aligned = primary.map(() => '')
  const confidence = primary.map(() => 0)
  for (let k = 0; k < indices.length; k++) {
    aligned[indices[k]] = partial[k] ?? ''
    confidence[indices[k]] = partialConf[k] ?? 0
  }
  return { aligned, extras, confidence }
```

Add `confidence?: number[]` to `SmartAttachResult` (`src/lyrics/lineAligner.ts:624`) and populate it on the `'semantic'` return path. For the `'index'` and `'slots'` paths, which are accepted only after passing a trust gate, return `confidence: primary.map(() => 1)`.

Also update the two other `autoAlignLines` call sites in `smartAttachSecondLanguageFromLines` (the slot-level call around `:875`) to destructure the new field.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lyrics/lineAligner.confidence.test.ts tests/lyrics/ tests/ai-pipeline/corpus-pairing.test.ts`
Expected: PASS, `corpus-pairing` unmoved.

- [ ] **Step 5: Persist confidence onto the lines**

In `applyTranslations` (`src/lyrics/lineAligner.ts:393`), accept an optional confidence array and stamp `translationConfidence` per row. Then re-run the scorecard so `flag_precision` / `flag_recall` become non-null:

Run: `npx tsx scripts/audit-line-pairing.mjs --write-baseline`

**Read those two numbers.** They are the Phase 4 go/no-go from the spec. If precision and recall are poor, note it in the commit message — Phase 4's design changes.

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/lineAligner.ts tests/lyrics/lineAligner.confidence.test.ts \
        tests/ai-pipeline/fixtures/line-pairing-baseline.json
git commit -m "feat: emit per-row translation pairing confidence"
```

---

## Phase 2 — The DP

### Task 7: The `G` move and the skip penalty

**Files:**
- Modify: `src/lyrics/lineAligner.ts:524-622` (`autoAlignLines`)
- Modify: `tests/ai-pipeline/fixtures/embeddings-cache.json` (regenerated — see Global Constraints)
- Test: `tests/lyrics/lineAligner.groupMove.test.ts` (create)

**Interfaces:**
- Consumes: `autoAlignLines` from Task 6 (returns `{ aligned, extras, confidence }`).
- Produces: `autoAlignLines` additionally returns `groups: number[]` — `groups[i]` is the group id of original `i`; originals sharing an id share one translation. Ids are dense from 0.

These ship together: the free skip exists only to compensate for the missing move. See the spec, section 2.2.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lyrics/lineAligner.groupMove.test.ts
import { describe, it, expect } from 'vitest'
import { autoAlignLines } from '../../src/lyrics/lineAligner'

/**
 * Embeds so that the CONCATENATION of 'part-a' and 'part-b' matches
 * 'WHOLE', while neither half matches it well alone.
 */
const embed = async (texts: string[]) =>
  texts.map((t) => {
    const v = new Array(4).fill(0)
    const hasA = t.includes('part-a')
    const hasB = t.includes('part-b')
    if (hasA && hasB) { v[0] = 1 }            // the merged pair
    else if (hasA) { v[1] = 1 }
    else if (hasB) { v[2] = 1 }
    else if (t.includes('WHOLE')) { v[0] = 1 } // matches only the merged pair
    else { v[3] = 1 }
    return v
  })

describe('G move — two originals to one translation', () => {
  it('groups two originals onto one translation', async () => {
    const { aligned, groups, extras } = await autoAlignLines(
      ['part-a', 'part-b', 'other'],
      ['WHOLE covering both of them', 'unrelated tail'],
      embed,
    )
    expect(groups[0]).toBe(groups[1])
    expect(groups[2]).not.toBe(groups[0])
    expect(aligned[0]).toBe('WHOLE covering both of them')
    expect(aligned[1]).toBe('WHOLE covering both of them')
    expect(extras).toEqual([])
  })

  it('does NOT let a short translation swallow two long originals', async () => {
    const longA = 'part-a ' + 'x'.repeat(40)
    const longB = 'part-b ' + 'y'.repeat(40)
    const { groups } = await autoAlignLines([longA, longB], ['WHOLE'], embed)
    expect(groups[0]).not.toBe(groups[1])
  })

  it('prefers pairing one and blanking the other when that scores better', async () => {
    // 'part-a' matches translation 0 exactly; 'zzz' matches nothing.
    const { aligned, groups } = await autoAlignLines(
      ['part-a', 'zzz'],
      ['part-a exact'],
      async (texts) => texts.map((t) => {
        const v = new Array(4).fill(0)
        v[t.includes('part-a') ? 1 : 3] = 1
        return v
      }),
    )
    expect(groups[0]).not.toBe(groups[1])
    expect(aligned[1]).toBe('')
  })
})

describe('skip penalty', () => {
  it('does not collapse into long unpaired runs when counts diverge', async () => {
    const originals = Array.from({ length: 10 }, (_, i) => `match-${i}`)
    const translations = Array.from({ length: 6 }, (_, i) => `MATCH-${i}`)
    const embedN = async (texts: string[]) =>
      texts.map((t) => {
        const v = new Array(16).fill(0)
        const m = /match-(\d+)/i.exec(t)
        v[m ? Number(m[1]) : 15] = 1
        return v
      })
    const { aligned } = await autoAlignLines(originals, translations, embedN)
    const paired = aligned.filter(Boolean).length
    expect(paired, 'every translation should find its original').toBe(6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/lineAligner.groupMove.test.ts`
Expected: FAIL — `groups` is undefined.

- [ ] **Step 3: Add the `G` move**

In `autoAlignLines`, pre-embed adjacent ORIGINAL pairs alongside the existing merged-translation pairs. Extend the embed call (`src/lyrics/lineAligner.ts:534-539`):

```ts
  const mergedTexts =
    m >= 2 ? translations.slice(0, -1).map((t, j) => `${t}\n${translations[j + 1]}`) : []
  // Mirror of mergedTexts for the G move: adjacent ORIGINAL pairs, so a single
  // translation can be scored against two source lines taken together.
  const groupedOriginals =
    n >= 2 ? originals.slice(0, -1).map((o, i) => `${o}\n${originals[i + 1]}`) : []
  const vecs = await embedFn([...originals, ...translations, ...mergedTexts, ...groupedOriginals])
  const origVecs = vecs.slice(0, n)
  const transVecs = vecs.slice(n, n + m)
  const mergedVecs = vecs.slice(n + m, n + m + mergedTexts.length)
  const groupedVecs = vecs.slice(n + m + mergedTexts.length)
```

Add the gate and the move. After the existing `canMergeOnto`:

```ts
  /** A translation must be substantial before it may span two originals —
   * mirror of canMergeOnto, which guards the M move from the other side. */
  const MIN_TRANSLATION_GLYPHS_FOR_GROUP = 24
  const canGroupUnder = (j: number): boolean =>
    partGlyphLength(translations[j]) >= MIN_TRANSLATION_GLYPHS_FOR_GROUP
```

Inside the DP loop, after the `'M'` branch:

```ts
      // G: two originals share one translation (the translator folded two sung
      // lines into one thought). Must beat D+U, so blanking a row still wins
      // whenever that is the better reading.
      if (i >= 2 && canGroupUnder(j - 1)) {
        const groupedVec = groupedVecs[i - 2]
        let grouped = dp[i - 2][j - 1]
          + vecSim(groupedVec, transVecs[j - 1]) * 0.7
          + latinHintScore(`${originals[i - 2]} ${originals[i - 1]}`, translations[j - 1]) * 0.3
        const splitAlternative = dp[i - 2][j - 1] + scoreAt(i - 1, j - 1) - skipPenalty
        if (grouped > best && grouped > splitAlternative) {
          best = grouped
          move = 'G'
        }
      }
```

Change the skip penalty (`src/lyrics/lineAligner.ts:555`):

```ts
  // Constant, not free-when-diverged. The old rule (0 when |n-m| > 1) existed
  // to let the DP express a folded translation by skipping originals, because
  // no move represented it. The G move represents it now, so a real cost is
  // correct — free skips made the DP abandon whole regions at 46-vs-40.
  const skipPenalty = 0.85
```

Handle `'G'` in the traceback and build the group ids:

```ts
  const groups: number[] = new Array(n).fill(-1)
  let nextGroup = 0
  // ... inside the traceback, before 'U':
    } else if (b === 'G') {
      buckets[i - 1].unshift(translations[j - 1])
      buckets[i - 2].unshift(translations[j - 1])
      rowScore[i - 1] = best
      rowScore[i - 2] = best
      groups[i - 1] = nextGroup
      groups[i - 2] = nextGroup
      nextGroup++
      usedTrans.add(j - 1)
      i -= 2
      j--
    } else if (b === 'U') {
```

After the traceback, assign singleton ids to everything ungrouped and return:

```ts
  for (let k = 0; k < n; k++) {
    if (groups[k] === -1) groups[k] = nextGroup++
  }
  return { aligned, extras, confidence, groups }
```

Note `rowScore[i-1] = best` uses the accumulated DP value; if the confidence test from Task 6 regresses, record the move's own score instead by recomputing it here rather than reusing `best`.

- [ ] **Step 4: Stamp the group ids onto the rows**

`autoAlignLines` now returns `groups`, but nothing writes it to the model yet —
Task 9's display reads `TimedLine.translationGroup`, so without this step the
bracket can never render.

Extend `applyTranslations` (`src/lyrics/lineAligner.ts:393`), which Task 6
already extended to take confidence, so it also takes groups:

```ts
function applyTranslations(
  primary: TimedLine[],
  merged: string[],
  confidence?: number[],
  groups?: number[],
): TimedLine[] {
  return primary.map((line, i) => {
    const next: TimedLine = { ...line, translation: merged[i] ?? '' }
    if (confidence) next.translationConfidence = confidence[i] ?? 0
    // Only stamp a group id where the row genuinely shares its translation with
    // a neighbour. A singleton id on every row would be noise, and absence is
    // already defined as "this row is its own group".
    if (groups) {
      const id = groups[i]
      const shared = groups.some((g, k) => k !== i && g === id)
      if (shared) next.translationGroup = id
    }
    return next
  })
}
```

Thread `groups` from the `'semantic'` return path in
`smartAttachSecondLanguageFromLines` into that call, alongside `confidence`.
`semanticAlignToPrimaryLines` must map `groups` onto primary-row indices the
same way it maps `aligned` and `confidence` (rows skipped by
`pairablePrimaryLines` get their own id).

Add to the Task 7 test file:

```ts
it('stamps translationGroup only on rows that share a translation', async () => {
  const { smartAttachSecondLanguage } = await import('../../src/lyrics/lineAligner')
  const primary = [
    { startTime: 0, endTime: 1, original: 'part-a', translation: '' },
    { startTime: 1, endTime: 2, original: 'part-b', translation: '' },
    { startTime: 2, endTime: 3, original: 'other', translation: '' },
  ]
  const result = await smartAttachSecondLanguage(
    primary, 'WHOLE covering both of them
unrelated tail', embed,
  )
  expect(result.lines[0].translationGroup).toBe(result.lines[1].translationGroup)
  expect(result.lines[0].translationGroup).toBeDefined()
  expect(result.lines[2].translationGroup).toBeUndefined()
})
```

- [ ] **Step 5: Run the unit tests**

Run: `npx vitest run tests/lyrics/lineAligner.groupMove.test.ts tests/lyrics/lineAligner.confidence.test.ts`
Expected: PASS.

- [ ] **Step 6: Regenerate the embedding cache**

The `groupedOriginals` strings are new, so the cached embedder will throw.

Run: `npx tsx scripts/audit-line-pairing.mjs --write-embed-cache`
Run: `npx tsx scripts/audit-corpus.mjs --pairing --write-embed-cache`
Expected: both complete; `embeddings-cache.json` grows.

- [ ] **Step 7: Verify the control did not move**

Run: `npx vitest run tests/ai-pipeline/corpus-pairing.test.ts`
Expected: PASS with `pair_unpaired` / `pair_magnet` / `pair_wrong` **unchanged**. No groups should form on 1:1 fixtures. **If they moved, stop and diagnose** — either `canGroupUnder` is too permissive or the skip penalty change had an unintended effect on clean input.

- [ ] **Step 8: Measure the win**

Run: `npx tsx scripts/audit-line-pairing.mjs`
Expected versus the Task 6 baseline: `line_correct` up and `line_wrong` down, most visibly on `merge-adjacent` and `composite`. If `line_wrong` went **up**, the gate is too loose — raise `MIN_TRANSLATION_GLYPHS_FOR_GROUP` and re-measure before proceeding.

Run: `npx vitest run tests/lyrics/akfg-user-paste.test.ts`
Expected: PASS. This is the real messy user paste — if the scorecard improved but this got worse, the perturbation set is wrong, not the paste.

Then re-snapshot: `npx tsx scripts/audit-line-pairing.mjs --write-baseline`

- [ ] **Step 9: Commit**

```bash
git add src/lyrics/lineAligner.ts tests/lyrics/lineAligner.groupMove.test.ts \
        tests/ai-pipeline/fixtures/embeddings-cache.json \
        tests/ai-pipeline/fixtures/line-pairing-baseline.json
git commit -m "feat: merge-originals DP move, and a real skip penalty

The free skip when |n-m| > 1 was compensating for the missing move: with no
way to express a folded translation, forcing skips to be costly would have
produced bad 1:1 pairings instead. G represents it, so a constant cost is
now correct. Ships together because measuring them apart flatters neither."
```

---

## Phase 3 — Noise

### Task 8: Translation-side header, title and credit detection

**Files:**
- Create: `src/lyrics/translationNoise.ts`
- Modify: `src/lyrics/bilingual.ts:97` (`stripNonLyricLines` call site), `src/lyrics/lineAligner.ts` (pass `songTitle`/`artist` through)
- Test: `tests/lyrics/translationNoise.test.ts` (create)

**Interfaces:**
- Consumes: `SmartAttachOptions.songTitle`, `.artist` (`src/lyrics/lineAligner.ts:638-641`).
- Produces: `isTranslationNoiseLine(text: string, opts?: { songTitle?: string; artist?: string }): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lyrics/translationNoise.test.ts
import { describe, it, expect } from 'vitest'
import { isTranslationNoiseLine } from '../../src/lyrics/translationNoise'

describe('isTranslationNoiseLine', () => {
  const opts = { songTitle: 'Example Song', artist: 'Example Artist' }

  it('catches a leading title line', () => {
    expect(isTranslationNoiseLine('Example Song - Example Artist', opts)).toBe(true)
    expect(isTranslationNoiseLine('Example Song', opts)).toBe(true)
  })

  it('catches translator credits', () => {
    expect(isTranslationNoiseLine('Translated by Someone', opts)).toBe(true)
    expect(isTranslationNoiseLine('translation: someone', opts)).toBe(true)
  })

  it('catches translator notes', () => {
    expect(isTranslationNoiseLine('(TN: this is a pun)', opts)).toBe(true)
    expect(isTranslationNoiseLine('[Note: untranslatable]', opts)).toBe(true)
  })

  it('leaves real lyric lines alone', () => {
    expect(isTranslationNoiseLine('I walk alone through the quiet town', opts)).toBe(false)
    expect(isTranslationNoiseLine('Nothing left to say', opts)).toBe(false)
  })

  it('does not eat a lyric line that merely mentions the title word', () => {
    expect(isTranslationNoiseLine('This example song of ours goes on and on', opts)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/translationNoise.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lyrics/translationNoise.ts
/**
 * Translation-side noise detection. The PRIMARY side already has three
 * detectors (isPrimaryHeaderLine, isMetadataPrimaryLine, looksLikeJapaneseTitleLine
 * in lineAligner.ts); the translation side had only stripNonLyricLines, which
 * catches bracketed lines and bare section labels and nothing else. A pasted
 * title line therefore offset every row until the DP's skips absorbed it.
 */

const CREDIT_RE = /^(translat(ed|ion)\s*(by|:)|tl\s*by|lyrics?\s*by|romaji\s*by)/i
const NOTE_RE = /^[([]\s*(tn|t\.n\.|note|translator'?s? note)\b/i

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9぀-鿿]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** True when `line` is essentially just the metadata value, not a lyric mentioning it. */
function isMetadataEcho(line: string, metadata: string): boolean {
  const a = normalize(line)
  const b = normalize(metadata)
  if (!a || !b) return false
  if (a === b) return true
  // "Title - Artist" style: the line is the metadata plus a separator and little else.
  const stripped = a.replace(b, '').replace(/^[\s\-–—:|by]+|[\s\-–—:|]+$/g, '').trim()
  return a.includes(b) && stripped.length <= Math.max(4, b.length)
}

export function isTranslationNoiseLine(
  text: string,
  opts?: { songTitle?: string; artist?: string },
): boolean {
  const t = text.trim()
  if (!t) return false
  if (CREDIT_RE.test(t)) return true
  if (NOTE_RE.test(t)) return true
  if (opts?.songTitle && isMetadataEcho(t, opts.songTitle)) return true
  if (opts?.artist && isMetadataEcho(t, opts.artist)) return true
  if (opts?.songTitle && opts?.artist && isMetadataEcho(t, `${opts.songTitle} ${opts.artist}`)) return true
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lyrics/translationNoise.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire it into the extraction path**

In `src/lyrics/lineAligner.ts`, in `cleanTranslations`'s call chain within `smartAttachSecondLanguage`, filter with the song metadata already available on `SmartAttachOptions`:

```ts
  const trans = cleanTranslations(extractTranslationsForAttach(secondary, primary.length))
    .filter((t) => !isTranslationNoiseLine(t, { songTitle: options?.songTitle, artist: options?.artist }))
```

Apply the same filter in the `useBlockSplit` branch so both paths agree.

- [ ] **Step 6: Measure**

Run: `npx tsx scripts/audit-line-pairing.mjs`
Expected: `title-prefix`, `translator-note`, `trailing-credit` and `composite` improve; the others unchanged.

Run: `npx vitest run tests/ai-pipeline/corpus-pairing.test.ts tests/lyrics/`
Expected: PASS, control unmoved.

Re-snapshot: `npx tsx scripts/audit-line-pairing.mjs --write-baseline`

- [ ] **Step 7: Commit**

```bash
git add src/lyrics/translationNoise.ts tests/lyrics/translationNoise.test.ts \
        src/lyrics/lineAligner.ts tests/ai-pipeline/fixtures/line-pairing-baseline.json
git commit -m "feat: detect title, credit and note lines on the translation side"
```

---

## Phase 4 — Experience

> **Gate before starting Phase 4 — DECIDED, measured after Task 6.**
>
> The per-row confidence score **cannot support a flag UI**, and the confidence-based flag does NOT ship.
> Measured on the population a flag would actually apply to (rows that HAVE a translation): 1061 rows,
> 20 of them wrong, mean confidence *inverted* (wrong 0.849 vs correct 0.758), **AUC 0.399 — below chance**,
> and **precision 0.000 at every threshold from 0.05 to 0.50** (209 rows flagged, none of them wrong).
>
> An earlier reading suggested precision 1.000 at a conservative threshold. That was an artifact: it
> measured the score's ability to identify rows that are *blank*, which is a structural fact rather than a
> confidence judgement, and not what a flag is for.
>
> The spec's documented fallback — gate on "uncertain rows" — is equally unavailable, because it needs the
> same signal. **What ships instead is structural facts, which are certain rather than probabilistic:**
> rows with no translation at all, unplaced lines (`extras`), and the pairing `method`. On the corpus those
> cover 22 of 42 errors with **zero** false alarms — strictly better than the flag could manage, and honest
> about what it does not know.
>
> Task 10's wrong-song gate uses *mean* confidence across a whole song, a far coarser discrimination that
> this result does not automatically refute — but it must be **measured**, never assumed.

### Task 9: Grouped display

**Files:**
- Create: `src/lyrics/translationGroups.ts`
- Modify: `src/lyrics/LyricDisplay.tsx:274-392` (`Line`), `src/ai-pipeline/wordAligner.ts`
- Test: `tests/lyrics/translationGroups.test.ts`, `tests/lyrics/LyricDisplay.groups.test.tsx`

**Interfaces:**
- Consumes: `TimedLine.translationGroup` (Task 4), `groups` from `autoAlignLines` (Task 7).
- Produces: `groupRanges(lines: TimedLine[]): Array<{ start: number; end: number; text: string }>` — contiguous row ranges sharing a group id, `end` inclusive.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lyrics/translationGroups.test.ts
import { describe, it, expect } from 'vitest'
import { groupRanges } from '../../src/lyrics/translationGroups'
import type { TimedLine } from '../../src/core/types'

const L = (original: string, translation: string, translationGroup?: number): TimedLine =>
  ({ startTime: 0, endTime: 1, original, translation, translationGroup })

describe('groupRanges', () => {
  it('treats rows without a group id as singletons', () => {
    const r = groupRanges([L('a', 'x'), L('b', 'y')])
    expect(r).toEqual([
      { start: 0, end: 0, text: 'x' },
      { start: 1, end: 1, text: 'y' },
    ])
  })

  it('collapses contiguous rows sharing an id', () => {
    const r = groupRanges([L('a', 'shared', 7), L('b', 'shared', 7), L('c', 'z', 8)])
    expect(r).toEqual([
      { start: 0, end: 1, text: 'shared' },
      { start: 2, end: 2, text: 'z' },
    ])
  })

  it('does not merge non-contiguous rows that reuse an id', () => {
    const r = groupRanges([L('a', 'p', 1), L('b', 'q', 2), L('c', 'p', 1)])
    expect(r.map((x) => [x.start, x.end])).toEqual([[0, 0], [1, 1], [2, 2]])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lyrics/translationGroups.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lyrics/translationGroups.ts
import type { TimedLine } from '../core/types'

/**
 * Contiguous row ranges sharing a translation group, so display can render the
 * translation ONCE and bracket it across the rows it covers.
 *
 * Only contiguous runs merge: group ids are dense per attach, but a stale id
 * reused non-adjacently must never pull unrelated rows together.
 */
export function groupRanges(
  lines: TimedLine[],
): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = []
  let i = 0
  while (i < lines.length) {
    const id = lines[i].translationGroup
    let end = i
    if (id != null) {
      while (end + 1 < lines.length && lines[end + 1].translationGroup === id) end++
    }
    out.push({ start: i, end, text: lines[i].translation ?? '' })
    i = end + 1
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lyrics/translationGroups.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the bracket**

In `src/lyrics/LyricDisplay.tsx`, compute `groupRanges(lines)` once in the list component and pass each row a `groupRange`. A row renders its translation only when it is the range's `start`; rows inside a multi-row range render a left bracket rule spanning the group instead of their own translation element. Rows where `start === end` are unchanged from today.

Guard with the existing `hasVisibleTranslation` so a group whose text duplicates the original still suppresses correctly.

- [ ] **Step 6: Pair a group as one unit**

In `src/ai-pipeline/wordAligner.ts`, when consecutive rows share a `translationGroup`, run the pairer once over the concatenated originals against the single translation, then distribute the resulting indices back per row with `offsetTokenAlignmentIndices` (`src/lyrics/lineAligner.ts:206`), offsetting by the cumulative token count of preceding rows in the group. Without this, both rows are offered the whole English sentence when half belongs to each.

- [ ] **Step 7: Verify**

Run: `npx vitest run tests/lyrics/ tests/ai-pipeline/corpus-pairing.test.ts`
Expected: PASS, `pair_*` unmoved (no groups form on 1:1 corpus input).

- [ ] **Step 8: Commit**

```bash
git add src/lyrics/translationGroups.ts src/lyrics/LyricDisplay.tsx \
        src/ai-pipeline/wordAligner.ts tests/lyrics/translationGroups.test.ts \
        tests/lyrics/LyricDisplay.groups.test.tsx
git commit -m "feat: render a shared translation bracketed across its rows"
```

---

### Task 10: Optimistic apply and the wrong-song gate

**Files:**
- Modify: `src/lyrics/SecondLanguagePanel.tsx:27-33` (Phase), `:91-120` (`route`), `:199-224` (confirm block)
- Test: `tests/lyrics/SecondLanguagePanel.test.tsx`

**Interfaces:**
- Consumes: `SmartAttachResult.confidence` (Task 6), `.extras` (Task 5).
- Produces: the `'confirm'` phase is removed; a `'wrong-song'` phase replaces it, entered only on low mean confidence.

- [ ] **Step 1: Set the floor from measurement**

Read `line-pairing-baseline.json`. Pick the mean-confidence value that separates the `composite` perturbation (a messy but correct fit) from a genuinely unrelated paste. Add a throwaway row to the scorecard pairing each song's originals against a *different* song's translations to find the separation empirically. Record the chosen constant with the measured values beside it:

```ts
/** Below this mean confidence the paste is probably for a different song.
 * Measured 2026-08-XX: composite perturbation scores N; cross-song paste scores M. */
const WRONG_SONG_MEAN_CONFIDENCE = 0.00 // fill from measurement
```

- [ ] **Step 2: Write the failing test**

```tsx
// tests/lyrics/SecondLanguagePanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SecondLanguagePanel } from '../../src/lyrics/SecondLanguagePanel'
import type { TimedLine } from '../../src/core/types'

const primary: TimedLine[] = [
  { startTime: 1, endTime: 2, original: 'アルファ', translation: '' },
  { startTime: 2, endTime: 3, original: 'ベータ', translation: '' },
]

describe('SecondLanguagePanel', () => {
  it('applies a clean fit without asking for confirmation', async () => {
    const onApply = vi.fn()
    render(
      <SecondLanguagePanel
        lines={primary} title="T" artist="A" sourceLanguage="ja"
        onApply={onApply} onClose={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /paste lyrics/i }))
    await userEvent.type(screen.getByRole('textbox'), 'first line\nsecond line')
    await userEvent.click(screen.getByRole('button', { name: /attach/i }))

    await waitFor(() => expect(onApply).toHaveBeenCalled())
    expect(screen.queryByText(/does this pairing look right/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/lyrics/SecondLanguagePanel.test.tsx`
Expected: FAIL — the confirm screen still appears and `onApply` is not called.

- [ ] **Step 4: Implement**

Replace `route` so it applies directly, entering the gate only on low mean confidence:

```tsx
  const route = async (secondary: string) => {
    setPhase({ kind: 'aligning' })
    try {
      const result = await smartAttachSecondLanguage(lines, secondary, undefined, {
        songTitle: title, artist,
      })
      const conf = result.confidence ?? []
      const mean = conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : 1
      if (mean < WRONG_SONG_MEAN_CONFIDENCE) {
        setPhase({ kind: 'wrong-song', paired: result.lines, secondary, mean })
        return
      }
      onApply(result.lines)
      onClose()
    } catch {
      // Fall back to the manual editor rather than losing the paste.
      const transLines = extractSecondLanguageLines(secondary)
      setPhase({
        kind: 'align',
        originalLines: lines.map((l) => l.original),
        translationLines: transLines,
        extraLines: transLines.slice(lines.length),
      })
    }
  }
```

Delete the `'confirm'` phase and its render block; add a `'wrong-song'` block whose copy names the actual problem ("This doesn't look like a translation of this song") with Apply anyway / Paste different options.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/lyrics/SecondLanguagePanel.test.tsx tests/lyrics/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/SecondLanguagePanel.tsx tests/lyrics/SecondLanguagePanel.test.tsx
git commit -m "feat: apply a clean translation fit without a confirmation gate"
```

---

### Task 11: Flags, in-context repair, and unplaced lines

**Files:**
- Create: `src/lyrics/TranslationRepairPopover.tsx`
- Modify: `src/lyrics/LyricDisplay.tsx`, `src/player/PlayerView.tsx`
- Test: `tests/lyrics/TranslationRepairPopover.test.tsx`

**Interfaces:**
- Consumes: `TimedLine.translationConfidence`, `LyricsData.unplacedTranslations`, `groupRanges`.
- Produces: `<TranslationRepairPopover lineIndex candidates onChoose onClose />` where `candidates: Array<{ text: string; score: number; source: 'nearby' | 'unplaced' }>`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/lyrics/TranslationRepairPopover.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationRepairPopover } from '../../src/lyrics/TranslationRepairPopover'

describe('TranslationRepairPopover', () => {
  const candidates = [
    { text: 'the current one', score: 0.4, source: 'nearby' as const },
    { text: 'a better one', score: 0.8, source: 'nearby' as const },
    { text: 'an orphaned line', score: 0.6, source: 'unplaced' as const },
  ]

  it('offers candidates best-first and marks unplaced ones', async () => {
    render(
      <TranslationRepairPopover
        lineIndex={3} candidates={candidates} onChoose={() => {}} onClose={() => {}}
      />,
    )
    const options = screen.getAllByRole('button', { name: /one|line/i })
    expect(options[0]).toHaveTextContent('a better one')
    expect(screen.getByText(/unplaced/i)).toBeInTheDocument()
  })

  it('reports the chosen text', async () => {
    const onChoose = vi.fn()
    render(
      <TranslationRepairPopover
        lineIndex={3} candidates={candidates} onChoose={onChoose} onClose={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /a better one/i }))
    expect(onChoose).toHaveBeenCalledWith('a better one')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lyrics/TranslationRepairPopover.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the popover**

A list of candidate buttons sorted by score descending, each labelled with its text and, when `source === 'unplaced'`, a small "unplaced" tag. Follow the surface styling of `src/lyrics/TimestampPopover.tsx` for consistency, and reuse `useModalDialog` for Escape handling.

- [ ] **Step 4: Render the flag**

In `LyricDisplay`, a translation whose row has `translationConfidence < FLAG_THRESHOLD` renders with a dotted underline — **not** a colour or dim treatment, because `ColoredTranslation` (`src/lyrics/LyricDisplay.tsx:216`) already uses colour to carry token-alignment meaning. It must also read as distinct from the existing `needs_review` timing flag. Tapping opens the popover.

- [ ] **Step 5: Compute candidates**

In `PlayerView`, on opening the popover for row `i`, score row `i`'s original against the translations of rows `i-2..i+2` plus every `unplacedTranslations` entry, using the cached embedder. Vectors are already computed, so this is free. A full k-best DP traceback is not needed.

- [ ] **Step 6: Surface unplaced lines**

One quiet line of text where the flags live: "N lines weren't placed", opening a list positioned by each entry's `afterLineIndex`. Not a modal, not a blocker.

- [ ] **Step 7: Verify**

Run: `npx vitest run tests/lyrics/ tests/player/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lyrics/TranslationRepairPopover.tsx src/lyrics/LyricDisplay.tsx \
        src/player/PlayerView.tsx tests/lyrics/TranslationRepairPopover.test.tsx
git commit -m "feat: flag uncertain translation rows and repair them in place"
```

---

### Task 12: Progress, re-homing, and re-fit on change

**Files:**
- Modify: `src/lyrics/SecondLanguagePanel.tsx:122-130`, `src/ai-pipeline/textEmbedder.ts` call path, `src/lyrics/EditMode.tsx:641-642`, `src/player/PlayerView.tsx`
- Test: `tests/lyrics/translationRefit.test.ts`

**Interfaces:**
- Consumes: `LyricsData.translationSource` (Task 4), `embedTexts` `onProgress` (`src/ai-pipeline/textEmbedder.ts:21`).
- Produces: `shouldRefitTranslation(prev: TimedLine[], next: TimedLine[]): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lyrics/translationRefit.test.ts
import { describe, it, expect } from 'vitest'
import { shouldRefitTranslation } from '../../src/lyrics/translationRefit'
import type { TimedLine } from '../../src/core/types'

const L = (original: string): TimedLine => ({ startTime: 0, endTime: 1, original, translation: '' })

describe('shouldRefitTranslation', () => {
  it('is false when the originals are unchanged', () => {
    expect(shouldRefitTranslation([L('a'), L('b')], [L('a'), L('b')])).toBe(false)
  })

  it('is true when the line count changed', () => {
    expect(shouldRefitTranslation([L('a'), L('b')], [L('a'), L('b'), L('c')])).toBe(true)
  })

  it('is true when a line text changed', () => {
    expect(shouldRefitTranslation([L('a'), L('b')], [L('a'), L('B!')])).toBe(true)
  })

  it('ignores pure timing changes', () => {
    const before = [{ startTime: 0, endTime: 1, original: 'a', translation: '' }]
    const after = [{ startTime: 5, endTime: 9, original: 'a', translation: '' }]
    expect(shouldRefitTranslation(before, after)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lyrics/translationRefit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lyrics/translationRefit.ts
import type { TimedLine } from '../core/types'

/**
 * True when a stored pairing is stale because the PRIMARY rows changed shape.
 * Timing-only changes do not invalidate a pairing — the pairing is about text.
 */
export function shouldRefitTranslation(prev: TimedLine[], next: TimedLine[]): boolean {
  if (prev.length !== next.length) return true
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].original !== next[i].original) return true
  }
  return false
}
```

- [ ] **Step 4: Wire the re-fit**

In `PlayerView`'s post-align and post-gap-recovery paths, when `shouldRefitTranslation` is true and `lyrics.translationSource` exists, re-run `smartAttachSecondLanguage` against the stored source and persist. Costs one cached embedding pass, and a stale pairing is strictly wrong.

- [ ] **Step 5: Thread progress**

Pass an `onProgress` from `SecondLanguagePanel` through `smartAttachSecondLanguage` into `embedTexts` (`src/ai-pipeline/textEmbedder.ts:21` already accepts it; `autoAlignLines` never forwards it). Show real progress, and on a first attach say a model is downloading rather than showing a static step.

- [ ] **Step 6: Re-home `AlignmentEditor`**

It currently hangs off the deleted confirm screen. Add a "Fix all pairings" entry under Edit mode's More menu (`src/lyrics/EditMode.tsx:641-642`) that opens it with the real `extras` from storage, not `[]`.

- [ ] **Step 7: Full verification**

Run: `npm test`
Run: `npm run lint`
Run: `npx tsx scripts/audit-line-pairing.mjs --check-baseline`
Run: `npx tsx scripts/audit-corpus.mjs --pairing --check-baseline`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lyrics/translationRefit.ts src/lyrics/SecondLanguagePanel.tsx \
        src/lyrics/EditMode.tsx src/player/PlayerView.tsx \
        tests/lyrics/translationRefit.test.ts
git commit -m "feat: re-fit stale pairings, real attach progress, re-homed editor"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| 1 — instrument, perturbations, metrics, ratchet | 1, 2, 3 |
| 2.1 — `G` move | 7 |
| 2.2 — skip penalty | 7 |
| 2.3 — stop losing lines | 5 |
| 2.4 — per-row confidence | 6 |
| 2.5 — translation-side noise | 8 |
| 3 — model fields, `translationSource`, word-pairer group leak | 4, 9 |
| 4 — optimistic apply, wrong-song gate, flag, repair, unplaced, progress, re-home, re-fit | 10, 11, 12 |
| Go/no-go on Phase 4 | gate note before Task 9; decision point in Task 10 |
| Deferred items | not planned, by design |

**Fixed during self-review:** Task 7 returned `groups` and Task 9 read
`TimedLine.translationGroup`, with no step connecting them. Task 7 Step 4 now
stamps the field via `applyTranslations`.

**Known gaps, accepted:**
- The `WRONG_SONG_MEAN_CONFIDENCE` constant is deliberately unset until Task 10 Step 1 measures it. The spec requires this; guessing it would reintroduce the unmeasured-constant problem the design set out to remove.
- Task 9 Steps 5–6 and Task 11 Steps 3–6 describe UI work without full code blocks. These are rendering changes against components too large to reproduce inline (`LyricDisplay.tsx` is 565 lines, `PlayerView.tsx` is 1878). The interfaces they consume and produce are fully specified; the executor reads the component.
- `tests/lyrics/LyricDisplay.groups.test.tsx` is named in Task 9's file list but its body is not written out. The executor writes it against `groupRanges`, whose contract is fully specified in Task 9 Step 1.
