# Acoustic Onset-Snapping (phase 2) — Design

**Date:** 2026-07-17
**Goal:** Fix the "highlight lands late" symptom — a line whose start is later than the actual vocal onset, so the highlight lights up after singing began. Pull the start back to the real **vocal-energy onset** from the phase-1 vocal-activity envelope. This is the acoustic complement to the existing lexical `backfillLateStartsToMatchedSpan`, and it works where that one can't: garbled transcripts (messy/live audio) and long segment-mode chunks (which `backfill` explicitly skips because their char times are interpolated).

**Builds on:** the phase-1 acoustic signal ([[acoustic-vocal-activity-round13]], PR #24 / branch `acoustic-vocal-activity`). The `VocalActivitySignal` (with its `onset` track), the `AlignLyricsOptions.vocalActivity` threading, and `AutoAlignFlow` computing the envelope are already in place. This branch stacks on `acoustic-vocal-activity`.

**Decisions (user-confirmed):**
- **Conservative / high-confidence only** — re-timing a line can make a correct line worse, so only snap when the placement is provably wrong (mirrors the v1 over-demotion lesson).
- **Late starts only** — pull a start EARLIER to a vocal onset; never push a start later (too-early starts are already handled by the v1 demotion gate). `endTime` is never touched.
- **Both stem and mix paths** — stem is acoustic-decisive; **mix requires lexical corroboration** (the acoustic onset must agree with the line's transcript-word onset) so percussion/transients can't win.

**Non-negotiable safety property:** identical to v1 — when `vocalActivity` is absent (stored re-refine, DSP failure) every path is byte-identical to today. Onset-snapping is a new tuner that no-ops without a signal; with a signal it only ever moves a start EARLIER, within tight guards, never crossing the previous line, preserving `MIN_HIGHLIGHT`.

## Architecture

### 1. Helpers in `src/ai-pipeline/vocalActivity.ts`

- `nearestOnset(sig, targetSec, opts): number | null` — the time of the strongest `onset` peak in `[targetSec - opts.maxBefore, targetSec + opts.slackAfter]` whose strength ≥ `opts.minStrength`, or `null`. (Searches mostly *before* the target, since a late start sits *after* the real onset.)
- `hasPreOnsetDip(sig, onsetSec, opts): boolean` — true when a genuine low-activity gap precedes `onsetSec` (mean/voiced activity in `[onsetSec - dipWindow, onsetSec)` is low): confirms this is a real **phrase** onset emerging from a lull, not a mid-word syllable bump.
- `voicedFraction` (existing) reused to confirm sustained voiced activity between the onset and the current start.

### 2. New tuner `snapLateStartsToVocalOnset` in `src/lyrics/phraseAlignment.ts`

Runs in the tuner chain **immediately after `backfillLateStartsToMatchedSpan`** (so lexical correction runs first; the acoustic tuner handles the residue). No-op unless `options?.vocalActivity` is present. It has the same signature style as the other tuners and receives `lines`, the sanitized `words`, the per-line matched `spans`, and the signal.

For each line, snap `startTime` back to a vocal onset `T` only when ALL hold:
1. **A qualifying onset exists:** `T = nearestOnset(sig, line.startTime, { maxBefore: MAX_PULL, slackAfter: SLACK })` is non-null and `T < line.startTime - MIN_PULL` (the start is meaningfully late vs the onset).
2. **Real phrase onset:** `hasPreOnsetDip(sig, T)` — a silence dip precedes `T` — AND `voicedFraction(sig, T, line.startTime) ≥ VOICED_RUN_MIN` (vocals are sustained from `T` up to the current start; i.e. "singing was already going" at the late start).
3. **Ownership:** `T` is ≥ the previous line's edge — the same clamp `backfill` uses (`prevEdge = max(prevLine.startTime + 0.3, prevLine matched-span end)`); the snapped start never crosses it and never squashes the previous line below `MIN_HIGHLIGHT`.
4. **Anchored, not fabricated:** the line has modest lexical anchoring — matched-span `coverage ≥ SNAP_MIN_COVERAGE` (a low floor, e.g. 0.3), computed from the `spans` the tuner chain already carries. (The tuners run *before* the label-honesty pass, so per-line quality may not be in scope here; the coverage floor is the reliable anchoring signal — if a quality array is available at this stage, also skip `needs_review`.) We refine a roughly-correct placement; we never invent one.
5. **Source rule:**
   - `source === 'stem'` → the acoustic onset is **decisive** (gates 1–4 suffice).
   - `source === 'mix'` → **also require lexical corroboration:** `T` must be within `MIX_CORROBORATE_TOL` (~0.5 s) of the line's lexical onset (`span.firstTime` / the transcript word containing the first matched char). This makes a raw-mix snap fire only where energy and transcript agree, so a drum hit or synth transient (no lexical support near `T`) can never win.

Then `line.startTime = T` (clamped to `prevEdge`); `endTime` unchanged.

### 3. Conservative constants (tuned in implementation)
`MAX_PULL ≈ 2.0s` (bigger lateness is a different defect class, per `backfill`'s cap), `MIN_PULL ≈ 0.3s`, `SLACK ≈ 0.15s`, `minStrength` (onset), `dipWindow`/dip threshold, `VOICED_RUN_MIN ≈ 0.6`, `SNAP_MIN_COVERAGE ≈ 0.3`, `MIX_CORROBORATE_TOL ≈ 0.5s`. All chosen for high precision (few false snaps) over recall.

## Testing

- **Synthetic integration tests** (`tests/lyrics/onsetSnap.test.ts`): build an envelope with a `dip → onset → sustained-voiced` pattern and a line whose start is placed late (inside the voiced run); assert the start snaps back to the onset and `endTime` is unchanged. Then assert it does **NOT** fire when: no pre-onset dip; the onset would cross the previous line; the pull exceeds `MAX_PULL`; coverage is below the floor / line is `needs_review`; the signal is absent; and — on `source: 'mix'` — when the onset does **not** agree with the lexical onset (drum-hit onset with no transcript support), while it DOES fire on mix when they agree.
- **DSP helper tests** for `nearestOnset` / `hasPreOnsetDip` on synthetic envelopes.
- **Corpus stays safe automatically:** the committed synthetic corpus fixture (`akfg-instrumental-word.json`) has an all-zero `onset` track, so `nearestOnset` returns null → onset-snapping can't fire → corpus timings and the `--check-baseline` guard are unchanged (signal-absent invariant plus binary-onset invariant).
- Full suite green; `npx tsc --noEmit` clean.

## Safety / invariants

- Signal absent → byte-identical to today (v1 property preserved; the tuner is gated on `options?.vocalActivity`).
- Start-only, earlier-only, `endTime` never touched; never crosses the previous line; `MIN_HIGHLIGHT` preserved → cannot create a degenerate/overlapping row.
- Stem-decisive / mix-corroborated → percussion transients on a raw mix can't move a boundary.
- Coverage floor + not-`needs_review` → refines placements, never fabricates them.
- Deterministic DSP → reproducible.

## Scope

- **In:** `nearestOnset` + `hasPreOnsetDip`; `snapLateStartsToVocalOnset` tuner (stem-decisive + mix-corroborated); synthetic tests. Threading is already done (v1).
- **Deferred:** repeated-chorus onset disambiguation; early-start correction (pushing a too-early start forward); a percussion-robust onset detector for a *decisive* (non-corroborated) mix path; a real-onset corpus fixture to measure timing improvement in CI (needs the user's derived envelopes + the live e2e harness).

## Open risks

- The committed corpus can't prove real-world timing improvement (synthetic onset track) — same limitation as v1; real measurement needs `make-vocal-activity.mjs` envelopes + `e2e-align.mjs`.
- Constant tuning is done against synthetic tests, not real stems; the conservative posture (high `minStrength`, dip requirement, `MAX_PULL` cap) bounds the downside.
