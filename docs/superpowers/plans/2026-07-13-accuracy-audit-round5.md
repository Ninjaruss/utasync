# Accuracy Audit Round 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit alignment timings, sung furigana readings, and word definitions across every user-facing option combination, fix confirmed defects in the pipeline code, and ratchet CI baselines.

**Architecture:** Deterministic fixture-based instruments already exist (`scripts/audit-corpus.mjs`, `scripts/audit-vs-lrc.mjs`, ground-truth vitest guards). This round runs them, closes coverage gaps, triages discrepancies into defect classes, applies TDD fixes to pipeline sources (`src/lyrics/`, `src/ai-pipeline/`, `src/language/japanese/`), and re-snapshots baselines. Tasks 1–3 are fully deterministic; Task 4 is a repeatable fix-loop procedure executed once per confirmed defect class found in Task 3; Tasks 5–6 lock in and verify.

**Tech Stack:** Node 20+, `npx tsx` for scripts, vitest, kuromoji tokenizer, committed Whisper transcripts (no audio, no model downloads except cached embeddings).

**Branch:** `accuracy-audit-round5` (already created off `jmdict-context-readings`).

---

### Task 1: Baseline snapshot

Capture the "before" state of all three instruments so every later change is measurable. No code changes.

**Files:**
- Create: `docs/superpowers/audits/2026-07-13-round5-baseline.md`

- [ ] **Step 1: Run the corpus scorecard (alignment + readings + pairing)**

Run: `npx tsx scripts/audit-corpus.mjs --pairing --check-baseline 2>&1 | tee /tmp/round5-corpus.txt`
Expected: one scorecard row per corpus song; exits 0 (no regression vs `tests/ai-pipeline/fixtures/corpus-baseline.json`). If it exits non-zero, that IS a finding — record it, do not "fix" the baseline.

- [ ] **Step 2: Run the ground-truth LRC audit**

Run: `npx tsx scripts/audit-vs-lrc.mjs 2>&1 | tee /tmp/round5-lrc.txt`
Expected: per-configuration transcript-error and alignment-error tables for the songs in `tests/ai-pipeline/fixtures/lrc-truth/` (guitar-loneliness, stranger-than-heaven).

- [ ] **Step 3: Run the CI guard tests**

Run: `npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts tests/ai-pipeline/corpus-pairing.test.ts tests/ai-pipeline/lrc-truth.test.ts tests/ai-pipeline/akfg-ground-truth.test.ts tests/ai-pipeline/akfg-word-ground-truth.test.ts 2>&1 | tee /tmp/round5-guards.txt`
Expected: all pass (akfg tests skip themselves if `.cache/auto-align-audit/` transcripts are absent — note any skips in the report).

- [ ] **Step 4: Run the full suite once for a flake register**

Run: `npx vitest run 2>&1 | tail -40 | tee /tmp/round5-vitest.txt`
Expected: green, or a short list of known-flaky integration tests (rerun any failure once; only persistent failures are findings).

- [ ] **Step 5: Write the baseline report**

Create `docs/superpowers/audits/2026-07-13-round5-baseline.md` containing: the corpus scorecard table verbatim, the LRC error tables verbatim, guard-test status (including skips), and the flake register. Plain markdown, no analysis yet.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/audits/2026-07-13-round5-baseline.md
git commit -m "audit: round 5 baseline snapshot (corpus, LRC ground truth, CI guards)"
```

---

### Task 2: Coverage-gap matrix

Map every user-facing option to the corpus rows that exercise it; add cheap missing coverage; record un-closable gaps.

**Files:**
- Modify: `docs/superpowers/audits/2026-07-13-round5-baseline.md` (append matrix)
- Possibly modify: `tests/ai-pipeline/fixtures/corpus.json` (new rows reusing committed transcripts only)

- [ ] **Step 1: Build the matrix from corpus.json**

Axes × existing rows (verify against `tests/ai-pipeline/fixtures/corpus.json`, don't trust this table blindly):

| Axis | Covered by |
|---|---|
| word-timestamp mode | `*-word` rows (akfg, stranger, guitar) |
| segment mode (lite-tier default) | `*-segment` rows |
| high-accuracy medium tier | `stranger-than-heaven-{word,segment}-medium` |
| auto language detect | `stranger-than-heaven-*-autolang` |
| mixed-language two-pass | `stranger-than-heaven-mixed-{word,segment}` |
| Japanese default | veil, akfg, my-eyes-only, guitar-loneliness |
| English-only | **none** |
| readings truth | `fixtures/reading-truth.json` |
| pairing truth | `fixtures/pairing-truth.json`, per-song pairing audits |

- [ ] **Step 2: Close cheap gaps**

For each gap where a committed transcript already exists in `tests/ai-pipeline/fixtures/` but no corpus row references it, add the row to `corpus.json` (name, lang, lyrics, transcript paths — copy the shape of an existing row). Do NOT create synthetic transcripts. Expected outcome per the spec: English-only likely stays a recorded gap (no committed EN transcript) — write it in the report as a proposed follow-up corpus addition.

- [ ] **Step 3: Re-run scorecard if rows were added**

Run: `npx tsx scripts/audit-corpus.mjs --pairing`
Expected: new rows appear; note their metrics in the report. (Do not re-snapshot the baseline yet — that happens in Task 5.)

- [ ] **Step 4: Append the matrix + gap list to the report and commit**

```bash
git add docs/superpowers/audits/2026-07-13-round5-baseline.md tests/ai-pipeline/fixtures/corpus.json
git commit -m "audit: round 5 option-coverage matrix; add corpus rows for uncovered options"
```

---

### Task 3: Discrepancy triage

Turn instrument output into a ranked defect list. No fixes yet.

**Files:**
- Create: `docs/superpowers/audits/2026-07-13-round5-findings.md`

- [ ] **Step 1: Per-line alignment inspection**

For each song/config where Task 1–2 output shows a nonzero `needs_review`, boundary-metric outlier, or LRC alignment-error p90 > transcript-error p90 (aligner making Whisper's output *worse*), dump the offending lines. `audit-vs-lrc.mjs` prints per-line errors; for corpus songs read the scorecard columns and re-run `npx tsx scripts/audit-corpus.mjs` and inspect the per-song detail it prints.

- [ ] **Step 2: Reading discrepancy inspection**

Compare reconciled readings against `fixtures/reading-truth.json` — the scorecard's reading columns count mismatches; list each mismatching token (song, line, surface, expected reading, got reading). Cross-check each against the residual carve-outs documented in the 2026-07 furigana QA (`docs/` + memory) and label carve-outs as `known-residual`.

- [ ] **Step 3: Pairing/definition inspection**

Run: `npx tsx scripts/audit-corpus.mjs --pairing --dump-pairs 2>&1 | tee /tmp/round5-pairs.txt`
List each pair violating `fixtures/pairing-truth.json`, plus any gloss that is empty, English-mismatched, or homophone-wrong. Label known noise-floor pairs from the word-pairer QA as `known-residual`.

- [ ] **Step 4: Write findings report**

`docs/superpowers/audits/2026-07-13-round5-findings.md`: one table per dimension with columns `id | song/config | symptom | severity (high/med/low) | root-cause hypothesis | status (new / known-residual)`. Group `new` findings into defect classes (same root cause = one class). Rank classes by user impact: timing errors a listener hears > wrong furigana > wrong gloss > cosmetic.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/2026-07-13-round5-findings.md
git commit -m "audit: round 5 findings — triaged defect classes across timing/readings/pairings"
```

---

### Task 4: Fix loop — repeat once per `new` defect class from Task 3, highest rank first

This is a procedure template; the concrete test content comes from the Task 3 findings table. Every iteration follows the same five steps. **Fixes go in pipeline sources, never in `scripts/audit-*.mjs`.**

**Files (per iteration):**
- Test: `tests/ai-pipeline/<defect-class-slug>.test.ts` (new) or extend the closest existing test file from the list in `tests/ai-pipeline/`
- Modify: the pipeline source implicated by the root-cause hypothesis — alignment: `src/lyrics/phraseAlignment.ts`, `src/ai-pipeline/contentAligner.ts`, `src/ai-pipeline/mixedLanguageAlign.ts`; readings: `src/ai-pipeline/readingReconciler.ts`, `src/language/japanese/readingCorrections.ts`, `src/lyrics/readingDisplay.ts`; definitions: `src/ai-pipeline/wordAligner.ts`, `src/ai-pipeline/lyricGloss.ts`, `src/language/japanese/jmdictReadings.ts`

- [ ] **Step 1: Write the failing test**

Reproduce the finding minimally from committed fixtures. Shape (alignment example — adapt inputs to the defect class):

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refineAlignmentWithPhrases } from '../../src/lyrics/phraseAlignment'

const here = dirname(fileURLToPath(import.meta.url))

describe('<defect-class-slug>', () => {
  it('<states the expected behavior from the findings row>', async () => {
    const words = JSON.parse(readFileSync(join(here, 'fixtures/<song>/<transcript>.json'), 'utf8'))
    const lines = readFileSync(join(here, 'fixtures/<song>/lyrics.ja.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean)
    const result = await refineAlignmentWithPhrases(lines, words /* , opts per config */)
    expect(result.lines[<idx>].startTime).toBeGreaterThanOrEqual(<truth - tol>)
    expect(result.lines[<idx>].startTime).toBeLessThanOrEqual(<truth + tol>)
  })
})
```

- [ ] **Step 2: Run it, verify it fails for the triaged reason**

Run: `npx vitest run tests/ai-pipeline/<defect-class-slug>.test.ts`
Expected: FAIL matching the findings-table symptom. If it passes, the root-cause hypothesis is wrong — return to Task 3 for this class.

- [ ] **Step 3: Minimal pipeline fix**

Smallest change in the implicated source file that makes the test pass. No behavior flags unless an option-specific fix would regress another option.

- [ ] **Step 4: Corpus-wide regression check**

Run: `npx vitest run tests/ai-pipeline/<defect-class-slug>.test.ts && npx tsx scripts/audit-corpus.mjs --pairing --check-baseline && npx tsx scripts/audit-vs-lrc.mjs`
Expected: new test passes; `--check-baseline` exits 0; LRC error percentiles ≤ Task 1 values for every config. If any song regresses, refine or gate the fix — an accepted trade-off requires an explicit note in the findings report.

- [ ] **Step 5: Commit**

```bash
git add tests/ai-pipeline/<defect-class-slug>.test.ts src/<changed files>
git commit -m "fix(<area>): <defect class> (round 5)"
```

- [ ] **Repeat** until every `new` defect class is fixed or explicitly deferred with a reason in the findings report.

---

### Task 5: Ratchet baselines and thresholds

**Files:**
- Modify: `tests/ai-pipeline/fixtures/corpus-baseline.json` (via script, never by hand)
- Modify: `tests/ai-pipeline/lrc-truth.test.ts` (threshold constants)
- Possibly modify: `tests/ai-pipeline/akfg-ground-truth.test.ts` / `akfg-word-ground-truth.test.ts` (`tol` values, only where fixes tightened real behavior)

- [ ] **Step 1: Re-snapshot the corpus baseline**

Run: `npx tsx scripts/audit-corpus.mjs --pairing --write-baseline`
Then diff: `git diff tests/ai-pipeline/fixtures/corpus-baseline.json`
Expected: every changed metric moved down (or is a new Task 2 row). Any metric that moved UP is an unnoticed regression — return to Task 4.

- [ ] **Step 2: Tighten ground-truth thresholds**

In `tests/ai-pipeline/lrc-truth.test.ts`, lower each error-threshold constant to the smallest value with ≥20% headroom above the observed post-fix number (e.g. observed p90 1.4s → threshold 1.7s, not 1.41s — flake headroom is deliberate).

- [ ] **Step 3: Verify guards pass at the new levels**

Run: `npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts tests/ai-pipeline/corpus-pairing.test.ts tests/ai-pipeline/lrc-truth.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/ai-pipeline/fixtures/corpus-baseline.json tests/ai-pipeline/lrc-truth.test.ts tests/ai-pipeline/akfg-*.test.ts
git commit -m "test(align): ratchet round-5 baselines and ground-truth thresholds"
```

---

### Task 6: Final verification and report

**Files:**
- Modify: `docs/superpowers/audits/2026-07-13-round5-findings.md` (append before/after table)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: green (rerun once for register-listed flakes; anything else is a Task 4 return).

- [ ] **Step 2: Browser display-layer spot-check**

Start the dev server via the Browser pane (launch config, not Bash). For one Japanese song and one mixed-language song: play ~30s and confirm line highlight lands with the vocal, ruby furigana matches sung readings on lines fixed in Task 4, and the tap-word popover shows a sane gloss for two words per song. Screenshot each as proof.

- [ ] **Step 3: Append before/after scorecard to the findings report**

Table: each metric — Task 1 value → final value, per song/config. One paragraph of accepted trade-offs and deferred items (including the English-only corpus gap follow-up).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/audits/2026-07-13-round5-findings.md
git commit -m "audit: round 5 before/after report and verification"
```
