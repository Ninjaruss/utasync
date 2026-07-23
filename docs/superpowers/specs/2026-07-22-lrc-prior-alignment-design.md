# LRC-Prior Alignment — Design

**Date:** 2026-07-22
**Goal:** Make existing line timing (from a pasted LRC, subtitle, or prior
alignment) act as a *prior* that constrains the auto-aligner, so it can no
longer drop a lyric line onto entirely wrong content. Today the aligner discards
any timing and re-derives everything from the transcript; on a bad transcript it
confidently mis-places lines by 10+ seconds (Recollect). The pasted lyrics should
be a **basis** for alignment, not thrown away.

**Relationship to shipped work:** This is Approach A of the "reference-LRC"
brainstorm. It complements the shipped "paste LRC timings" feature: exact-for-
this-recording timings are used as-is (synced, skip Whisper); *this* feature is
for when the timings are approximate or from a different recording (e.g. a studio
LRC used to sync a THE FIRST TAKE performance) and the user still wants to align
the audio, guided by the known structure. Approaches B (acoustic warp) and C
(hybrid) from the brainstorm are explicitly deferred.

**Decisions (user-confirmed):**
- The prior is used **automatically** whenever a song being auto-aligned already
  carries timing. The transcript is demoted to a *refiner within a tolerance*,
  never an override. No new mode to learn.
- Reached via a **three-way** choice on a timed paste — [Use timings as-is] /
  [Align using these as a guide] / [Align from scratch] — and via Edit-mode
  "Re-align" (which uses the prior when timing exists; "align from scratch" is
  the explicit opt-out).
- The prior gate is a **pure function** of `(matched spans, prior times)` — no
  acoustic signal, no vocal stem required — so it is validated offline against a
  Recollect fixture built from real diagnostic data before any UI is built.

## Behavior

When auto-align runs on a song whose lines already carry non-trivial times, those
times become a **monotonic scaffold**. A transcript match that lands far from
where the prior expects a line is rejected; the line falls back to its prior-
implied position. The transcript is still used to sharpen placement *within* a
tolerance window. Plain-text songs (no prior) are unaffected — the feature no-ops.

## Algorithm — `applyLrcPrior(lines, matchedSpans, priorTimes, opts)`

Two pure stages.

### Stage 1 — Rescale the prior onto this audio (robust fit)

The prior times may be for this recording or a different one (different tempo).
Fit a robust **affine** map `actual ≈ a·prior + b` (a = tempo scale, b = offset).

**Method — deterministic exhaustive 2-point RANSAC** (chosen over Theil–Sen after
working the real Recollect data: its bulge is ~40% of the confidently-matched
lines, which exceeds Theil–Sen's ~29% breakdown point and drags a median-offset
fit by ~2.3 s):
- Collect the confidently-matched, positively-timed pairs `(prior_i, actual_i)`
  — `actual_i` = the line's current placement (`lines[i].startTime` after the
  pipeline); coverage = `matchedChars / totalChars` ≥ `minCoverage`.
- Enumerate **every** pair of these points (songs have ≤ ~60 lines → ≤ ~1800
  candidate models — cheap and *deterministic*, no PRNG, no flaky tests). Each
  pair defines a 2-point line `(a, b)`; discard models with `a` outside a sane
  tempo band (`0.5 ≤ a ≤ 2.0`). Count inliers (`|actual_k − (a·prior_k + b)| ≤
  inlierTol`). Keep the model with the most inliers.
- **Least-squares refit** `(a, b)` on the winning inlier set for precision.
- Exhaustive enumeration guarantees a clean inlier pair is always tried, so it is
  robust well past 40% outliers as long as the correct lines are a plurality.

Apply the map to every line's prior time → `expected_i = a·prior_i + b`. For a
same-recording accurate LRC the winning model is ≈ identity, so `expected_i` ≈
the pasted times; for a slower/faster recording `a` captures the tempo.

Fallbacks: 0 pairs → identity (`a=1, b=0`); 1 pair → unit-slope offset
(`a=1, b=actual−prior`); no 2-inlier consensus → robust median offset
(`a=1, b=median(actual−prior)`).

*Deferred (Phase 2):* piecewise / tempo-drift maps (a recording that changes
tempo mid-song). Phase 1's single affine handles a uniform tempo difference.

### Stage 2 — Per-line gate (refine-or-fall-back)

For each line (`actual_i` = its current placement `lines[i].startTime`):
- If the line is confidently matched (coverage ≥ `minCoverage`) **and**
  `|actual_i − expected_i| ≤ T` → keep `actual_i` (the transcript's placement is
  trusted to refine within tolerance).
- Else (low coverage, or a placement too far from the prior — a false match) →
  use `expected_i`.
- Then `enforceLineMonotonicity` + min-duration.

`T` starts as a fixed window (~2–3 s), with a tempo-aware option (scale by local
map slope) if measurement shows it is needed.

### Graceful degradation

If too few lines confidently match to fit a map (fully garbage transcript), fall
back to a single global rescale (anchor the prior's first/last matched extent to
the audio's, or identity for a same-recording paste) and place every line by the
prior. Still on-content and ordered — strictly better than blind.

### Partial priors

A line with no prior time (rare for a full LRC) is interpolated from its
neighbors before the fit.

## Integration

1. At align start, capture `priorTimes = song.lyrics.lines.map(l => l.startTime)`
   only when the song carries meaningful timing; otherwise the feature no-ops.
2. Run the existing pipeline (transcribe → content-match → mixed-merge / gap
   passes) unchanged. Reuse the `matchedSpans` already computed for the onset
   anchor.
3. Call `applyLrcPrior(lines, matchedSpans, priorTimes, { useTimingPrior })` as a
   late structural guardrail — it overrides only lines whose match violates the
   prior. The acoustic leading-edge/onset anchor still runs after, to sharpen the
   opening *within* the prior.

Gating: `useTimingPrior` is set by the three-way paste choice / Edit-mode
"Re-align"; "Align from scratch" clears it. Plain-text songs never reach the
pass (no prior times).

## Files

- `src/lyrics/lrcPrior.ts` — new. `applyLrcPrior` + the robust piecewise map fit
  (`fitPriorTimeMap`), both pure.
- `src/ai-pipeline/AutoAlignFlow.tsx` — capture `priorTimes`, call `applyLrcPrior`
  in the post-content-match block (beside the existing onset-anchor code), gated
  on `useTimingPrior`.
- `src/lyrics/LrcTimingNotice.tsx` + the three paste flows — extend the escape
  hatch to the three-way choice ([Use as-is] / [Align using as guide] / [Align
  from scratch]).
- Plumb `useTimingPrior` from the paste choice / Edit re-align into the align
  invocation.

## Edge cases

- **No prior / plain lyrics** → no-op (current behavior preserved).
- **Fully garbage transcript** → global-rescale fallback; every line uses the prior.
- **Different recording, extra instrumental break in audio** → the piecewise map
  spans it. (A section the lyrics have but the audio omits is the genuine hard
  edge — rare; the user controls the pasted lyrics.)
- **Line count** cannot diverge — align never changes the line set; the prior
  lines are those lines.

## Testing

- **Recollect prior-fixture (offline, committed):** `priorTimes` = the user's LRC;
  `matchedSpans` = the per-line coverage + false-match positions from the
  `[bulge-diag]` run (#7 @38.3 cov 1.00, #9 @46.3 cov 1.00, #12 @49.6, plus the
  correctly-matched lines). Assert `applyLrcPrior` rejects the outliers and lands
  every line within ~2 s of truth — the +12 s bulges gone, measured, before any UI.
- **Synthetic different-recording fixture:** same lyrics, prior scaled ~1.15× +
  offset, a few lines un-matchable → assert the robust map recovers tempo and the
  gate places everything correctly.
- **Robust-fit unit tests:** Theil–Sen ignores planted outliers; piecewise map
  tracks a tempo change; degenerate (0–1 anchors) falls back gracefully.
- **Tolerance-gate unit tests:** in-tolerance match kept; out-of-tolerance match
  rejected to prior; missing match → prior; monotonicity enforced.
- **Corpus safety:** stranger / veil align from plain text with no prior →
  `applyLrcPrior` no-ops → corpus baseline + LRC-truth gates byte-identical. Zero
  regression surface.

## Out of scope

- Approach B (transcript-free acoustic warp of the LRC onto the vocal-activity
  envelope) and Approach C (hybrid). Deferred; this spec measures how much the
  prior alone recovers first.
- Any change to the shipped exact-timings "synced, skip Whisper" path.
