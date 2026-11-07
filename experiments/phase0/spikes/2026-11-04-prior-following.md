# Spike 2026-11-04: lines that follow the prior

**Pre-registered before the first run.** Time box: one day.

## Observation (ledger L36)

Under planted ±0.8 s prior offsets, arm D recovered 96–100% of lines on veil and guitar but
8 lines followed the prior exactly: line 0 of veil, guitar and going-my-way, and going-my-way
lines 12, 13, 24, 25, 26. In every case the target line was the **first text** in its window
(line 0 has no previous line; the others hit the >30 s fallback that drops the previous line),
and its start equals the window start (shift −1.00 s or −3.00 s, or −prior when the window
starts at 0). Cross-attention DTW gives the first text token the first frames after the
special tokens; nothing before it absorbs the lead-in audio.

## Hypothesis

Prepending a filler token that Whisper uses for music (`♪`) before the window's text lets the
filler absorb non-target audio, so the first target token lands on the singing.

## Variant

`--filler ♪`: decoder input = prefix + `♪` + context lines. Everything else unchanged.

## Gate

On veil, guitar-loneliness and going-my-way, with priors from the catalogue LRC shifted by
+0.8 s and −0.8 s (6 planted runs + 3 unshifted):

1. **Fix:** at least 12 of the 16 (8 lines × 2 shifts) previously failing line/shift cases
   recover within 0.25 s of the unshifted filler result.
2. **No regression:** per song and shift, the share of lines recovered within 0.25 s is no
   more than 2 percentage points below the baseline (L36).
3. **No silent drift:** on lines that were stable in the baseline, the median |filler − baseline|
   start is at most 0.05 s. (Without human truth a moved line is neither better nor worse, so
   the variant must not move lines it was not meant to fix.)

Pass all three → adopt `--filler` as the arm D default. Otherwise → record the failure,
keep the baseline, and flag "first text in window" lines as unreliable instead.

## Result (2026-11-04): FAIL — not adopted

| song | shift | baseline recovered ≤0.25 s | filler recovered ≤0.25 s |
| --- | --- | --- | --- |
| veil | +0.8 s | 96% | 96% |
| veil | −0.8 s | 100% | 100% |
| guitar-loneliness | +0.8 s | 98% | 98% |
| guitar-loneliness | −0.8 s | 96% | 98% |
| going-my-way | +0.8 s | 81% | 90% |
| going-my-way | −0.8 s | 84% | 81% |

1. Fix: 6 of 16 target cases recovered (needed ≥12) — FAIL.
2. No regression: going-my-way −0.8 s fell 3 pp — FAIL.
3. No silent drift: going-my-way baseline-stable lines moved by a median 0.10 s — FAIL.

One `♪` token does not absorb the lead-in reliably, and it moves lines it was not meant to
touch. **Decision:** keep the baseline; mark lines whose start lands within 0.1 s of their window
start as `pinned` (unreliable). On the baseline runs that flag catches 8 of 10 planted failures
and flags 0 of 136 stable lines (the two misses moved 0.26 s, at the threshold). A second-pass
stability check was not built: the free flag already covers the mechanism.

Not tried (would need a new spike, not a re-tune): a window that starts at the previous line's
prior even in the >30 s case, and multi-token fillers.
