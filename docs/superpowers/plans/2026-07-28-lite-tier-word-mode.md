# Lite-Tier Word-Level Timestamps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Default **lite tier** to word-level timestamps (like full tier / PR #37) — gated on a live lite-device speed measurement. Retire the now-vestigial "Accurate timing (slower)" opt-in once no tier defaults to segment.

**Architecture:** Remove the `tier === 'lite' → segment` branch in `preferredWhisperTimestampMode` so all non-manual tiers use word (lite already runs the manual-windowed WebGPU word path, so the WASM merge-stall the branch guarded against doesn't apply). Then retire the opt-in that only *forced* word (benefits no tier now) across `alignTimestampMode.ts`, `AutoAlignFlow.tsx`, `PlayerView.tsx`. Keep the segment-detection hint path for whisper-medium (the sole remaining segment producer). See `docs/superpowers/specs/2026-07-28-lite-tier-word-mode-design.md`.

**Tech Stack:** TypeScript, React, Vitest.

**Standing constraint:** Commits UNSIGNED (`git commit --no-gpg-sign`); commit only when the user asks. Branch off `main`.

---

### Task 0 — GATING measurement (user-run; blocks all code tasks)

I cannot measure a weak GPU from node. **The user runs this and reports the result; do not write code until a branch (A/B/C) is chosen.**

- [ ] On a real **lite** device (WebGPU, ~4–5GB RAM — a low-end laptop / weakest target), align a ~4–5 min local song (isolation is unavailable on lite, so this is raw-mix word transcription). Record: completes without crash/OOM? wall-clock vs the current segment run?
- [ ] Decide:
  - **(A)** clean + tolerable time (≈ ≤2× segment, no freeze) → implement Tasks 1–3 as written.
  - **(B)** clean but slow on weakest devices → implement Tasks 1–3 **plus Task 4** (a "Faster timing" segment opt-out for lite).
  - **(C)** crash / OOM / absurd time → **abort**: keep `tier === 'lite' → segment`, record the negative result in the `word-timestamp-lever` memory, close this lever. No code change.

---

### Task 1 — Flip lite → word (TDD) [branches A/B]

**Files:** `src/ai-pipeline/alignTimestampMode.ts`; `tests/ai-pipeline/alignTimestampMode.test.ts`

- [ ] **Step 1 (red):** Update tests — lite now word at any duration:
```ts
  it('uses word timestamps on lite tier (WebGPU manual-windowed word path)', () => {
    expect(preferredWhisperTimestampMode('lite', 60)).toBe('word')
    expect(preferredWhisperTimestampMode('lite', 300)).toBe('word')
  })
```
Remove/replace the old `'uses segment timestamps on lite tier'` case. Run the file, confirm it fails.
- [ ] **Step 2:** In `preferredWhisperTimestampMode`, delete `if (tier === 'lite') return 'segment'`. Body becomes (pre-opt-in-retirement) `void durationSec; if (options?.accurateReadings && tier !== 'manual') return 'word'; return 'word'` — the override is now redundant; Task 2 removes it. Refresh the doc comment (lite uses the WebGPU manual-windowed word path; no tier defaults to segment except whisper-medium high-accuracy).
- [ ] **Step 3:** `npx vitest run tests/ai-pipeline/alignTimestampMode.test.ts` green.

### Task 2 — Retire the vestigial "Accurate timing (slower)" opt-in [branches A/B]

**Files:** `alignTimestampMode.ts`, `AutoAlignFlow.tsx`, `PlayerView.tsx` (+ their tests)

- [ ] **Step 1:** `alignTimestampMode.ts` — delete `TimestampModeOptions.accurateReadings` and the override line (now nothing sets it usefully). If `TimestampModeOptions` becomes empty, drop the param. Make `accurateReadingsAvailable` return `false` (or delete it + `accurateReadingsEstimate` and fix imports — grep first).
- [ ] **Step 2:** `AutoAlignFlow.tsx` — delete the "Accurate timing (slower)" checkbox (`~748–762`), the `accurateReadings` state (`:128`), the prop (`:41`, `:107`), and simplify `preferredWhisperTimestampMode(tier, durationSec)` (`:278`, drop the options arg). `useHighAccuracy ? 'segment' : preferredWhisperTimestampMode(tier, durationSec)` stays.
- [ ] **Step 3:** `PlayerView.tsx` — remove `alignAccurateReadings` state (`:293`), the `accurateReadings` param of `beginAlignment` (`:757–758`), and the `accurateReadings={alignAccurateReadings}` prop (`:1527`).
- [ ] **Step 4 (reconcile the Edit-mode "Re-align accurately" affordance):** `onAutoAlignAccurate={() => beginAlignment('auto', true)}` (`:1389`) and the `segment-blocks` hint (`accurateRealignReason`, `:961`) existed to force word on a segment song. The only remaining segment producer is **whisper-medium high-accuracy**, whose word mode has a repetition-loop pathology (re-aligning it to word is undesirable — `AutoAlignFlow.tsx:275`). So: **remove the `onAutoAlignAccurate` button and the `segment-blocks` branch of `accurateRealignReason`** (keep the `weak-labels` branch and the generic Play-mode "approximate timing — tap a line" note, which stand on their own). Update `alignTimestampMode.ts` / `EditMode` / `PlayerView` accordingly. Grep `segment-blocks`, `onAutoAlignAccurate`, `suggestWordLevelAlign` and reconcile all sites + their tests.
- [ ] **Step 5:** Update affected tests: `AutoAlignFlow.*` (checkbox gone), `PlayerView` tests referencing the accurate button, and `alignTimestampMode.test.ts` (`accurateReadingsAvailable`/`Estimate`/`accurateRealignReason` segment-blocks cases).

### Task 3 — Verify [branches A/B]

- [ ] `npm test` green (call out the known `AutoAlignFlow.unload.test.tsx` flake if it appears; passes isolated).
- [ ] `npx tsc -p tsconfig.app.json --noEmit` + `npm run lint` clean.
- [ ] `npx tsx scripts/audit-corpus.mjs --check-baseline` — unaffected (aligner unchanged).
- [ ] **Live (user, lite device):** re-run the Task-0 song; confirm it aligns in word mode with tighter tails and the opt-in UI is gone.

### Task 4 — "Faster timing" lite opt-out [branch B ONLY]

**Files:** `alignTimestampMode.ts`, `AutoAlignFlow.tsx`

- [ ] Add `fastSegment?: boolean` to the mode fn: `if (tier === 'lite' && options?.fastSegment) return 'segment'` before `return 'word'` (TDD the new case).
- [ ] Add a "Faster timing (less precise)" checkbox shown **only on lite** in AutoAlignFlow, threaded like the retired opt-in but inverted (default word, opt out to segment). Test the lite-only visibility.

---

## Notes
- Accuracy upside is the same class PR #37 measured (`scripts/word-vs-segment-scorecard.mjs`, tier-independent). The only new risk is lite device **speed**, owned by Task 0.
- Do NOT touch full/manual/high-accuracy behavior or the aligner.
