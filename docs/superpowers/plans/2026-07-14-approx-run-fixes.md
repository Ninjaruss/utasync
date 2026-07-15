# Approx-Run Fixes (Round 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Spec = `docs/superpowers/audits/2026-07-14-approx-run-diagnosis.md` (user-approved); every fix below cites its measured repro from that diagnosis.

**Goal:** Make degenerate-run display honest (no pileups below floor, no zero-duration rows, truthful labels/banner), unpin well-evidenced neighbors from bad runs, ship round-5 fixes to stored songs, and lock the new behavior with a garbled-transcript CI fixture.

**Architecture:** Same fix-loop discipline as round 5: per-fix TDD (failing test from the measured repro → minimal pipeline fix → corpus/LRC regression gates → commit), spec review + quality review per fix, ratchet at the end. Fixes B and C intentionally move corpus proxy metrics; use the ALLOWED_MEASUREMENT_ARTIFACTS carve-out protocol between fixes and clear it at the ratchet.

**Branch:** `accuracy-audit-round5` (continues PR #12).

**Universal regression gates (every fix):**
- `npx tsx scripts/audit-corpus.mjs --pairing --check-baseline` → only documented carve-out cells may flag; anything else = stop.
- `npx tsx scripts/audit-vs-lrc.mjs` → NO config regresses vs: guitar word 0.40/1.62, guitar segment 0.73/1.96, stranger word ja 0.85/37.74, stranger segment ja 5.93/33.79, word mixed 0.56/3.64, segment mixed 0.56/7.86, segment medium 0.70/12.92.
- `npx vitest run tests/ai-pipeline/ tests/lyrics/ --exclude "**/.claude/**"` green (known load flakes pass in isolation).
- Commits use `--no-gpg-sign` (1Password agent erroring).

---

### Task B (first — C depends on it): packing floor + zero-width elimination + display floor repair

**Files:** Modify `src/lyrics/redistributeDegenerateRuns.ts` (redistributeRun :139–166), `src/lyrics/phraseAlignment.ts` (expandSquashedLineHighlights :1504–1515), `src/ai-pipeline/mixedLanguageAlign.ts` (after merge stitch :123–129). Tests: new `tests/lyrics/redistributeDegenerateRuns.floor.test.ts`, extend mixed tests.

Requirements (each gets a failing test first, from the diagnosis repros):
1. `redistributeRun` never emits a line shorter than `min(minLineDuration(line), fairShare)` where fairShare = windowSpan/runLength; when activity capacity cannot fit the floors, spread the run at floor durations across the whole window (activity-region preference kept where it fits) — capacity limits must degrade to "spread + needs_review", never to slivers. Never emit `start == end` (repro: 22-line run scaled ×0.365 → 0.44s slivers; cursor exhaustion → zero rows; see diagnosis H2).
2. `expandSquashedLineHighlights`: epsilon-tolerant guard (`room >= MIN_HIGHLIGHT_S - 1e-6`), and the synthetic last-row room must expand a zero-span final row (float repro: room 1.1999999999999886).
3. Mixed merge: re-run the display floor after `mergeMixedRefinedAlignments`' stitch. Repro: stranger row 45 ships `183.5–183.5` quality `good` in BOTH modes on current code — test asserts merged output has no zero-duration rows and row 45 ≥ display floor.

### Task C: honest labels

**Files:** Modify `src/lyrics/redistributeDegenerateRuns.ts` (onActivity :165), `src/lyrics/phraseAlignment.ts` (upgrade :1885–1888), `src/lyrics/EditMode.tsx` (banner :327–330, :385–390). Tests: extend redistribution tests + a component test for the banner.

Requirements:
1. The `needs_review → approximate` upgrade requires the packed line to be on activity AND at ≥ COMPRESSION_FRACTION (0.55) of its `minLineDuration` — a sliver on a noise blip stays `needs_review` (repro: diagnosis H4, garble case: 6 slivers all read approx, banner 0).
2. Banner counts lines that are `needs_review` OR (approximate AND duration < 0.55 × minLineDuration post-Task-B this set should be near-empty — assert the coupling in a test). Keep wording; count change only. If Task B's floor makes the second clause structurally empty, note that in the test as the invariant.
3. Post-fix invariant test: in the garble scenario, banner count ≥ the number of packed-below-evidence lines OR the lines are spread at floor and honestly labeled.

### Task D: drag clamps (three measured sub-cases, one commit each if mechanisms are separate)

**Files:** Modify `src/lyrics/phraseAlignment.ts` (backfillLateStartsToMatchedSpan :515–566). Test: extend `tests/ai-pipeline/lineBoundary.evidence-override.test.ts` or new file.

Sub-cases (diagnosis H5, each with exact numbers):
1. Straddle guard: when the straddled word partially belongs to the previous line, fall back to `boundary = max(prevSpanEnd, prevFloor)` instead of `continue` (guitar segment #44: 2.92s err → expect ≤ ~1.0s; evidence 195.90, prevSpanEnd 195.81).
2. Cap exception: allow pulls ≥ LATESTART_MAX_PULL_S when span coverage ≥ 0.9 (span-corroborated precedent from round-5 T3) (stranger segment #23/#24: late 10.55/10.35 with cov 1.00/0.93, errs 12.10/9.95 → expect ≤ ~2s).
3. prevFloor pinning: when the previous line is zero/sub-floor width AND this line's own span evidence (cov ≥ 0.5) sits before prevFloor, permit pulling to `max(evidence, prevSpanEnd)` (guitar segment #29: pinned 137.38 by zero-width #28; evidence 119.5-era case → expect err ≤ ~1s; re-measure post-Task-B since #28's width changes).
Regression watch: these loosen clamps — the full LRC table must not regress anywhere; if a sub-case can't be gated safely, defer it with measurements (round-5 A5 precedent).

### Task A: ship plumbing (independent; do after B/C/D so the version bump ships the new behavior)

**Files:** Modify `src/lyrics/phraseAlignment.ts` (ALIGNMENT_PIPELINE_VERSION :24), `src/player/PlayerView.tsx` (re-refine :436–450), possibly `src/lyrics/EditMode.tsx`. Tests: version-gate test + component test.

Requirements:
1. Bump `ALIGNMENT_PIPELINE_VERSION` to 20.
2. Mixed-song stored-transcript hazard: on re-refine, if the song's `alignmentLanguage === 'mixed'` (verify the stored field name in the lyrics store) and stored version < 20, do NOT silently re-refine from the stored merged transcript; instead surface the existing off-timing banner path (or a one-line notice) recommending re-running Auto-align. Investigate what is actually persisted before implementing; if both pass transcripts are stored (unlikely), prefer a true re-merge. Report findings honestly.

### Task E: garbled-transcript fixture class

**Files:** Create `tests/ai-pipeline/fixtures/akfg/transcript.word.garbled.json` (deterministic perturbation of transcript.word.json: drop chunks with midpoint in [188,258], insert a hallucinated `ような` chunk at [228,229] — the diagnosis repro recipe), add corpus.json row `akfg-garbled-word`, generation script comment or scripts/lib note documenting the recipe. Tests: corpus-scorecard picks it up automatically once baselined at the ratchet.

Requirements: with Tasks B/C landed, the garbled row must show align_zero_dur=0, no sub-floor pileups, honest labels (assert via a focused test, not just the baseline snapshot).

### Task F: ratchet + verification + report

Same as round-5 Task 5/6: `--write-baseline` (audit every moved cell: B/C legitimately move stranger/akfg proxy cells — each must be explainable as floor-spreading or label honesty, list them in the commit body), clear carve-outs, guards pass, full vitest, LRC table verbatim-compared, before/after appendix added to the diagnosis doc, push to PR #12 and update the PR body checklist.
