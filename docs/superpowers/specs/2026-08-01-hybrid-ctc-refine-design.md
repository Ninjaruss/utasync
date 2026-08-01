# Whisper-bounded CTC refine — offline spike (design)

**Date:** 2026-08-01
**Status:** approved (spike only — no app code)
**Target failure class:** dense within-line JA/EN code-switching (Recollect class)
**Decision shape:** measure first; GO/NO-GO gate below. Ship vehicle decided in a
follow-up design only on GO.

## Problem

Mixed-language songs remain the worst-aligned class. The shipped pipeline
(forced-JA + forced-EN two-pass, cross-pass consensus merge, word-mode
timestamps, vocal isolation) still fails on dense within-line code-switching:
both forced passes garble the "other" language mid-line, and per-line
pass-picking cannot see inside a line. Recollect's worst lines are
*false-confident* — cov=1.00, placed 11–13s late (whole ~8s section drifts).

Prior CTC forced-alignment work established:

- The mechanism works in-browser-compatible form:
  `onnx-community/mms-300m-1130-forced-aligner-ONNX` (q8 ~340MB), romanized
  31-token vocab, ~50fps logits, JA via kuroshiro romaji. Corpus p50 is
  excellent everywhere (0.08–0.41s).
- Monolithic CTC = NO-GO: on par overall, seam cascades (one lyric/audio
  coverage hole skips ahead and crams the rest).
- Naive open-ended windowing = catastrophic (mean 39s; CTC pays nothing for
  blanks and smears tokens across the span).
- Self-anchoring = provably vacuous (DP optimal substructure).
- **Rule: containment bounds must be INDEPENDENT of the CTC path.**

The queued-but-unrun experiment is the WhisperX-style hybrid: Whisper's coarse
placement supplies independent closed bounds; CTC refines within them. Its
romanized vocab makes a code-switched line one continuous token stream — the
within-line JA/EN split structurally disappears at the refine layer.

## Spike architecture

Scripts-only, offline (node). No app-path changes; corpus baseline stays
byte-identical by construction.

### 1. Re-baseline (the number to beat)

Run the current app aligner path (`refineAlignmentWithPhrases`; mixed two-pass
merge for mixed sheets; word-mode transcripts where committed) against synced
LRC truth for five songs:

| song | role | audio |
|---|---|---|
| recollect | primary target (dense code-switch) | ~/Downloads (local) |
| stranger-than-heaven | mixed regression guard | public/e2e/stranger.mp3 |
| guitar-loneliness | clean-JA guard | public/e2e/guitar.mp3 |
| veil | clean-JA guard | public/e2e/veil.mp3 |
| going-my-way | opening-accuracy guard | ~/Downloads (local) |

All prior CTC numbers predate word-mode-everywhere (PRs #37/#39), so this
table is mandatory before any comparison.

### 2. Window construction (the new work)

- **Anchors:** trusted lines from the baseline alignment. For mixed songs, the
  cross-pass consensus skeleton (|ja−en| ≤ 2.5s with real evidence) — a
  stronger trust signal than per-line quality labels, which are known
  false-confident on the target class. For single-language songs (guards),
  lines labeled `good` with real evidence.
- **Windows:** the span between two consecutive anchors, plus a slack margin,
  closed on both ends. Song head closes at 0, tail at duration.
- **Refine scope:** CTC re-times ALL lines interior to a window (the bet:
  section drifts are interior to windows whose edges the consensus got right).
  Anchor lines themselves keep their Whisper times.
- **Sweep parameters:** anchor policy (consensus-only vs consensus+good;
  minimum anchor spacing) and slack margin (e.g. 0.5–2s).
- Independence rule holds by construction: bounds derive from Whisper/consensus
  output only, never from CTC output.

### 3. CTC refine within a window

- Port the TDD'd cores from `feat/forced-alignment`
  (`src/ai-pipeline/forcedAlign/{viterbi,normalize,forcedAligner}.ts`) with
  their unit tests; reuse the chunked-inference (30s) + kuroshiro romanization
  machinery already in `scripts/forced-align-scorecard.mjs`.
- Per window: concatenate the window's lines, romanize (kuroshiro for JA,
  passthrough for EN) into one token stream, Viterbi over the window's logit
  slice only.
- **Degenerate-window guard:** skip refine (keep Whisper times) when token
  density is implausible for the window duration — either direction: too many
  tokens/sec (lyrics don't fit; the seam-cascade precursor) or too few (open
  space to smear; the naive-windowing precursor). Exact thresholds tuned
  during the sweep and recorded in the findings memo.
- Edge cases: lines with zero romanizable content (symbols/numbers) pass
  through unrefined; windows with no interior lines are no-ops.

### 4. Scoring + GO/NO-GO gate

New permanent instrument `scripts/hybrid-align-scorecard.mjs` (patterned on
`forced-align-scorecard.mjs`): per song, mean / p50 / p90 / >1s / >1.5s
line-start error vs LRC truth, baseline vs hybrid side by side.

**Pre-committed gate:**

- **GO:** Recollect mean AND p90 improve ≥25% vs the step-1 baseline, AND no
  guard song (stranger, guitar, veil, going-my-way) regresses on any metric by
  >10%.
- **NO-GO:** anything less. Document numbers as a measured dead-end and stop.

The hybrid would only ever apply to mixed sheets in-app; clean songs are in
the gate as mechanism-sanity, not as a deployment claim.

### Deliverable

Numbers table (baseline vs hybrid, all sweep points) + GO/NO-GO memo. On GO,
the in-app shape (ship vehicle, 340MB download UX, tier gating, fallback
ladder) gets its own design round.

## Explicitly rejected alternatives (this round)

- **B — phonetic-space matching upgrade:** improves coverage/matching only;
  the target lines are confidently matched but mistimed, which matching can't
  touch. Back pocket if the spike shows coverage-starved windows.
- **C — lyric-prompt-biased single mixed pass:** whole-song decoder biasing
  invites hallucinated confidence, the exact Recollect failure class; prompt
  biasing is only proven safe behind accept-if-better on short slices.

## Out of scope

- Wrong-occurrence p90 outliers (window placed on the wrong chorus — the
  hybrid refines timing, it cannot rescue a mis-placed window).
- The ~1.1s systematic onset lag on dense bilingual vocals (audio-layer).
- Any in-app wiring, UI, or model-download flow.
