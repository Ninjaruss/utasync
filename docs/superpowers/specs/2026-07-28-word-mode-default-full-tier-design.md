# Word-Level Timestamp Mode Default for Full-Tier Long Songs — Design

**Date:** 2026-07-28
**Goal:** Make full-tier devices use **word-level (cross-attention) Whisper
timestamps** for *all* songs, removing the `durationSec > 180` fallback to the
tail-clipping **segment** mode. Segment chunks clip the sung final syllable
~0.7–1.0s early and interpolate per-line boundaries inside multi-line chunks;
word mode keeps line starts/tails tight. Every full-length song currently runs in
segment mode (all real songs are >180s), so this is a per-line precision win on
essentially every song a full-tier user aligns.

**Decisions (user-confirmed):**
- **Default word mode ON for full tier**, regardless of duration. Accept the
  ~3–8 min extra compute per align as the cost of tighter timing.
- **Lite tier keeps segment as its default** (the long-form merge stall is real
  on memory-constrained / phone devices) — the `accurateReadings` opt-in still
  lets a lite user request word mode per-align.
- **Manual tier** is unaffected (no transcription).
- **High-accuracy (whisper-medium) still forces segment** — unchanged; its
  word-timestamp path has a repetition-loop hallucination pathology that segment
  mode avoids (`AutoAlignFlow.tsx:275`). Orthogonal to this change.
- Scope: the **default-mode flip + the coupled opt-in/hint cleanup + tests**.
  UI copy about the longer run time is optional polish, deferred.

## Why this is small and low-risk

`preferredWhisperTimestampMode` (`src/ai-pipeline/alignTimestampMode.ts:16`)
already reads:

```ts
if (options?.accurateReadings && tier !== 'manual') return 'word'
if (tier === 'lite') return 'segment'
if (durationSec > 180) return 'segment'   // ← only reachable when tier === 'full'
return 'word'
```

The `durationSec > 180` guard is **full-tier-only** (lite already returned on the
line above). Deleting it makes full tier always return `'word'`. No new branch,
no new state.

**The mechanism is not new.** transformers.js `return_timestamps:'word'` already
sets `return_token_timestamps:true` internally
(`node_modules/@huggingface/transformers/src/pipelines.js:1812`) — the
OpenAI/WhisperX cross-attention + alignment-heads DTW. And the full-tier WebGPU
worker already runs **manual per-window word transcription**
(`whisper.worker.ts:106`), which replaced transformers.js's broken long-form
merge — the stall that originally justified the 180s cutoff no longer applies on
full tier. So we are enabling an existing, proven code path more often, not
building a new one, and adding **zero** model download.

## Measured evidence (non-regression)

`scripts/word-vs-segment-scorecard.mjs` (new instrument) runs the real app aligner
(`refineAlignmentWithPhrases`) on the committed **word** vs **segment** transcript
fixtures, scored vs synced-LRC truth (same offset-normalized metric as
`forced-align-scorecard.mjs`):

| song | mode | mean | p50 | p90 | >1s | >1.5s |
|---|---|---|---|---|---|---|
| guitar-loneliness (clean JA) | **word** | **0.55** | **0.29** | **1.80** | **8** | **5** |
| | segment | 0.87 | 0.39 | 2.27 | 11 | 8 |
| stranger-than-heaven (mixed) | **word** | 9.58 | **0.91** | 35.74 | **27** | 26 |
| | segment | 9.24 | 1.91 | 33.03 | 32 | 31 |

- guitar: word beats segment on every metric (mean −37%).
- stranger: word halves p50 (1.91→0.91s) and cuts >1s; mean flat, p90 ~35s for
  both (the wrong-occurrence / coverage outliers — a different failure class this
  lever neither fixes nor worsens).
- **Verdict:** upside-only median/tail-precision improvement; the only cost is
  compute time. Not a fix for coverage-bound catastrophic outliers (owned by the
  in-flight vocal-isolation + content-matching levers).

## Behavior changes

### 1. `preferredWhisperTimestampMode(tier, durationSec, options)`
Remove the `if (durationSec > 180) return 'segment'` line. Full tier → always
`'word'`. `durationSec` stays in the signature (callers + lite/estimate helpers
still pass it; keep API stable). Update the doc comment to reflect that full tier
no longer trades tail accuracy for speed.

### 2. `accurateReadingsAvailable(tier, durationSec)`
Currently returns `durationSec > 180` for full tier. Full tier is now *always*
word, so the "Accurate readings (slower)" opt-in would be a no-op there — it must
return **`false` for full tier** and keep `tier === 'lite'`. This automatically
makes `accurateReadingsEstimate` null for full tier (the "~3–8 min" opt-in
disappears where it's already the default).

### 3. Player "re-align for accurate timing" hint
`suggestsWordLevelAlignment` / `accurateRealignReason` fire on segment-mode merged
blocks. Full-tier songs are now word mode, so the `segment-blocks` hint naturally
stops firing for them (no merged multi-line chunks to detect) — no code change
required, but confirm the PlayerView `suggestWordLevelAlign` gate
(`PlayerView.tsx:1299`) reads correctly for lite (still valuable there).

## Ripple / tests to reconcile
- `tests/ai-pipeline/alignTimestampMode.test.ts` — existing assertions that full
  tier + `>180s` → `'segment'` must flip to `'word'`. **TDD: update expectations
  first.**
- Integration tests that exercise the segment path on a long song
  (`akfg-segment-align.test.ts`, `akfg-mp3.align.integration.test.ts`,
  `veil-align.integration.test.ts`) — confirm they drive the segment code path
  *directly* (via a transcript fixture / explicit mode) rather than through
  `preferredWhisperTimestampMode`; if any infer the mode from tier+duration, pin
  the mode explicitly so they keep testing what they intend.
- `scripts/audit-corpus.mjs` `--check-baseline` — fixture-based on committed
  transcripts; the app-side mode flip does **not** change the aligner, so the
  corpus baseline is unaffected. No baseline rewrite expected.

## Out of scope / deferred
- UI copy warning about the longer full-tier run time (a progress note). Optional
  polish; the accepted tradeoff is already surfaced by the existing
  transcribing/merging progress states.
- Any change to lite-tier defaults, high-accuracy mode, or the aligner itself.
- The coverage-bound catastrophic outliers (stranger p90 ~35s) — different
  failure class, addressed by vocal isolation + content matching elsewhere.
