# Word-Mode Default for Full-Tier Long Songs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full-tier devices use word-level (cross-attention) Whisper timestamps for *all* songs — remove the `durationSec > 180` fallback to tail-clipping segment mode. Lite keeps segment-by-default (opt-in still available); high-accuracy/whisper-medium and manual tiers unchanged.

**Architecture:** One-line removal in `preferredWhisperTimestampMode` (the `>180s` guard is already full-tier-only), plus the coupled cleanup of the now-redundant "Accurate readings" opt-in for full tier in `accurateReadingsAvailable`. No new state, no new branch, no model download — this enables the existing WebGPU manual-windowing word path (`whisper.worker.ts:106`) on long songs. See `docs/superpowers/specs/2026-07-28-word-mode-default-full-tier-design.md`.

**Tech Stack:** TypeScript, Vitest. Single source file `src/ai-pipeline/alignTimestampMode.ts` + its unit test.

**Standing constraint:** All commits in this repo must be UNSIGNED — use `git commit --no-gpg-sign`. Commit only when the user has asked you to; if unsure, pause and ask rather than committing. Branch off `main` (not the current `feat/acoustic-label-gate` PR branch).

**Evidence of non-regression (already measured):** `scripts/word-vs-segment-scorecard.mjs` — word beats or matches segment on median/tail for both fixture songs with both transcripts (guitar mean −37%, stranger p50 −53%; neither p90 outlier worsened). See spec for the table.

---

## File Structure
- `src/ai-pipeline/alignTimestampMode.ts` — remove the `>180s` guard (full → word); make `accurateReadingsAvailable` return false for full tier; refresh the two doc comments.
- `tests/ai-pipeline/alignTimestampMode.test.ts` — flip the full-tier expectations (TDD: first).
- `scripts/word-vs-segment-scorecard.mjs` — already written (working tree). Land it as the permanent instrument in the same branch.

---

### Task 1: Flip the full-tier default (TDD)

**Files:**
- Modify: `src/ai-pipeline/alignTimestampMode.ts`
- Test: `tests/ai-pipeline/alignTimestampMode.test.ts`

- [ ] **Step 1: Update the failing tests first**

In `tests/ai-pipeline/alignTimestampMode.test.ts`:

Replace the `preferredWhisperTimestampMode` full-tier-long-song case (currently expecting `'segment'`) with word-mode expectations:
```ts
  it('uses word timestamps on full tier regardless of duration (precision default)', () => {
    expect(preferredWhisperTimestampMode('full', 300)).toBe('word')
    expect(preferredWhisperTimestampMode('full', 200)).toBe('word')
    expect(preferredWhisperTimestampMode('full', 120)).toBe('word')
  })
```
Keep the lite-default (`'segment'`) and both accurate-readings opt-in cases (still `'word'`).

Update `accurateReadingsAvailable` — full tier no longer offers the opt-in (it is already word):
```ts
  it('is not offered on full tier (word mode is the full-tier default)', () => {
    expect(accurateReadingsAvailable('full', 300)).toBe(false)
    expect(accurateReadingsAvailable('full', 120)).toBe(false)
    expect(accurateReadingsAvailable('manual', 300)).toBe(false)
  })
```
Keep the lite cases (both durations `true`).

Update `accurateReadingsEstimate`:
```ts
    expect(accurateReadingsEstimate('full', 300)).toBeNull()
    expect(accurateReadingsEstimate('full', 120)).toBeNull()
    expect(accurateReadingsEstimate('lite', 300)).toBe('~3–8 min')
    expect(accurateReadingsEstimate('manual', 300)).toBeNull()
```
Leave `suggestsWordLevelAlignment` / `accurateRealignReason` tests unchanged — they exercise the merged-block detector directly with synthetic transcripts and remain valid (still useful for lite-tier segment output).

Run `npx vitest run tests/ai-pipeline/alignTimestampMode.test.ts` — confirm the updated cases FAIL against current code.

- [ ] **Step 2: Make the change**

In `preferredWhisperTimestampMode`, delete the line `if (durationSec > 180) return 'segment'`. Result:
```ts
  if (options?.accurateReadings && tier !== 'manual') return 'word'
  if (tier === 'lite') return 'segment'
  return 'word'
```
`durationSec` is now unused by this function but stays in the signature (callers in `AutoAlignFlow.tsx:278` and `e2eAlignHarness.ts:203` pass it, and the lite/estimate helpers still use it). If eslint flags the unused param, prefix a `void durationSec` or rename to `_durationSec` — do NOT change the signature/arity.

In `accurateReadingsAvailable`, change the full-tier branch:
```ts
export function accurateReadingsAvailable(tier: DeviceTier, durationSec: number): boolean {
  if (tier === 'full') return false // full tier defaults to word mode; no slower opt-in needed
  return tier === 'lite'
}
```
(`durationSec` now only matters via lite — keep the param for API stability; guard the unused-warning the same way if needed.)

Refresh the doc comment above `preferredWhisperTimestampMode` (drop the "trades tail accuracy for speed past 180s" rationale for full tier; state full tier now always uses word mode via the WebGPU manual-windowing path, and lite keeps segment for the merge-stall reason) and the `accurateReadingsAvailable` comment (full tier no longer surfaces the opt-in).

- [ ] **Step 3: Verify**

`npx vitest run tests/ai-pipeline/alignTimestampMode.test.ts` — green. Then `npx tsc -p tsconfig.app.json --noEmit` and `npx eslint src/ai-pipeline/alignTimestampMode.ts` — clean.

---

### Task 2: Reconcile long-song integration tests

**Files (inspect; modify only if needed):**
- `tests/ai-pipeline/akfg-segment-align.test.ts`
- `tests/ai-pipeline/akfg-mp3.align.integration.test.ts`
- `tests/ai-pipeline/veil-align.integration.test.ts`

- [ ] **Step 1:** Run the full alignment suite: `npx vitest run tests/ai-pipeline`.
- [ ] **Step 2:** For any failure caused by a long song now resolving to `'word'` instead of `'segment'`: if the test's intent is to exercise the *segment* code path, pin the mode explicitly (pass the segment transcript fixture / set the mode directly) so it keeps testing what it means to, rather than inferring the mode from tier+duration. Do NOT weaken a test that legitimately asserts end-to-end timing. If a test is genuinely exercising the default-mode decision, update its expectation to word and (where a word transcript fixture exists) assert the tighter timing.
- [ ] **Step 3:** Confirm `npx tsx scripts/audit-corpus.mjs --check-baseline` still passes (fixture-based; the app-side mode flip does not touch the aligner, so the baseline should be unaffected — if it changed, stop and investigate rather than rewriting the baseline).

---

### Task 3: Land the measurement instrument

**Files:**
- `scripts/word-vs-segment-scorecard.mjs` (already in working tree)

- [ ] **Step 1:** Confirm it runs: `npx tsx scripts/word-vs-segment-scorecard.mjs` prints the word-vs-segment table for stranger + guitar.
- [ ] **Step 2:** Keep it as the permanent before/after instrument for this lever (companion to `forced-align-scorecard.mjs` / `audit-corpus.mjs`). No baseline wiring needed — it's a diagnostic, not a CI gate.

---

## Final verification (before claiming done)
- [ ] `npm test` (full suite) green — call out `AutoAlignFlow.unload.test.tsx` if it flakes under full-suite concurrency (known pre-existing flake, passes isolated).
- [ ] `npx tsc -p tsconfig.app.json --noEmit` + `npm run lint` clean.
- [ ] **Live confirmation (user, full-tier device):** align a >180s song with isolation ON, confirm the run uses word mode (progress shows per-window transcription, not a single segment pass) and that line tails/starts sit tighter than before. Node cannot measure the browser Whisper path — this final check is the user's, as with every prior alignment change.

## Deferred (not in this plan)
- UI copy noting the longer full-tier run time.
- Any lite-tier default change or aligner-logic change.
