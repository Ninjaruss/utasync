# Accuracy Audit Round 5 — Alignment, Readings, Definitions

**Date:** 2026-07-13
**Branch:** `accuracy-audit-round5` (off `jmdict-context-readings`)
**Status:** Approved

## Goal

Broad fresh audit of the three core AI features — line alignment timings, sung
furigana readings, and Japanese word definitions/pairings — across **every
user-facing option combination**, followed by fixes for confirmed defects and
ratcheted CI baselines so the gains cannot silently regress.

## Scope

### In scope
- **Option axes to cover:**
  - Whisper model tier: default vs high-accuracy (whisper-medium) transcripts.
  - Word-level lite mode: on vs off.
  - Language mode: Japanese, English-only, mixed-language (two-pass).
- **Corpus:** existing committed fixtures only — `tests/ai-pipeline/fixtures/`
  (corpus.json transcripts + lyrics) and the ground-truth LRC data used by
  `audit-vs-lrc.mjs` / `akfg-ground-truth.test.ts` /
  `akfg-word-ground-truth.test.ts`. No new songs, no Whisper runs.
- **Fixes** land in real pipeline code (`src/lyrics/phraseAlignment.ts`,
  `src/ai-pipeline/*`, `src/language/japanese/*`), never in the audit scripts
  themselves.
- **Lock-in:** refresh `corpus-baseline.json` via `--write-baseline` and
  tighten ground-truth error thresholds in CI after verified improvements.

### Out of scope
- New corpus songs or new audio transcription.
- Re-fixing residual carve-outs documented in prior QA rounds (furigana
  reading QA, word-pairer QA) — these are flagged in the report, not reworked,
  unless a cheap fix falls out of new work.
- UI/UX changes beyond what a display-layer bug fix requires.

## Method

1. **Baseline run.** Run `npx tsx scripts/audit-corpus.mjs --pairing
   --check-baseline` and the two ground-truth test files unchanged. Record the
   scorecard as the "before" snapshot.
2. **Coverage-gap analysis.** Map each option axis to what the instruments
   actually exercise today. Any axis with zero deterministic coverage gets a
   fixture variant or script flag added, reusing committed transcripts (e.g. a
   medium-tier transcript fixture, a lite word-mode pass through the same
   corpus).
3. **Discrepancy triage.** Classify every finding as (a) alignment timing,
   (b) furigana/sung reading, or (c) definition/pairing, with severity and a
   root-cause hypothesis. Known residual carve-outs are labeled as such.
4. **Fix loop (per defect class).** Failing test first → fix in pipeline code
   → full corpus re-run to confirm no cross-metric regression.
5. **Lock-in.** `--write-baseline` with improved numbers; tighten ground-truth
   thresholds in the CI test files.
6. **Verification.** Full `vitest run`; browser spot-check of one song per
   language mode (dev server) for display-layer sanity — line highlight
   timing, ruby text, tap-word popover definitions.

## Success criteria

- Scorecard metrics equal or better than baseline on every song and every
  metric (lower is better throughout).
- No prior test regressions (`vitest run` green).
- Every new fix guarded by a test or a ratcheted threshold.
- A before/after report the user can read without re-running anything.

## Error handling / risks

- **Flaky integration tests** (known from prior rounds): rerun once before
  treating as a finding; report persistent flakes separately.
- **Metric trade-offs:** if a fix improves one song but worsens another, the
  fix must be gated or refined until the corpus is net-non-regressing per
  metric; document any accepted trade-off explicitly.
- **Missing coverage that needs audio:** if an option axis truly cannot be
  exercised from committed fixtures (e.g. no medium-tier transcript exists for
  any corpus song), record the gap in the report rather than fabricating
  fixtures; propose corpus additions as follow-up.
