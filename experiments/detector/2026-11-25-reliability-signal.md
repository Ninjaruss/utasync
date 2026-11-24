# Spike: can anything flag arm D's catastrophic lines?

**Pre-registered 2026-11-25, before any arm was implemented or run.** Time-boxed to one day
(CLAUDE.md rule 3). Nothing enters `src/` or `android/` on this spike's result alone.

## The question

L62 measured the defect precisely: arm D's median is fine (p50 0.11–0.34 s on real songs,
centred on each song's own LRC offset) and its tail is not — 16 of 221 lines are more than two
seconds out, **and the `pinned` flag catches none of them**. An aligner that is wrong 7% of the
time but says *which* 7% is usable: the app can hide the highlight, fall back to the prior, or
ask for one tap. One that is confidently wrong is not.

So: **does any cheap signal separate those 16 lines from the other 186?**

## What this spike can and cannot decide

It cannot certify anything. The labels come from the LRC screen, which is a falsifier and not
truth (L62, ADR-0006): a catalogue LRC carries ~0.3 s of its own uncertainty and an unknown
per-song offset. A 10-second disagreement on a version-exact LRC is as close to a labelled
catastrophe as this repository has, and that is the whole claim.

Two outcomes are possible: **no signal**, which closes the ASR thread for good; or **a candidate
worth testing against real truth**, which would then need the `human-onsets` column before
anything is built on it. A pass here is not permission to ship.

## The dataset (fixed before the arms exist)

The 221 lines of the five songs with catalogue LRC priors, `--shipped` (after the pinned → prior
fallback, L38), each song centred on its own median signed shift.

| label | rule | n |
| --- | --- | --- |
| catastrophe | centred error > 2 s | 16 |
| stable | centred error ≤ 1 s | 186 |
| excluded | between 1 s and 2 s | 19 |

The 1–2 s band is excluded rather than assigned: it is inside the LRC's own slop plus a line's
worth of ambiguity, so calling it either way would be inventing labels.

## The gate

**PASS requires both, and each arm is judged on its own. "The best of four arms" is not a pass.**

1. **Recall ≥ 12 of the 16 catastrophes** (75%).
2. **False alarms ≤ 28 of the 186 stable lines** (15%).

15% is the exposure clause 1 of ADR-0003 already tolerates; 75% is the share of the tail that has
to disappear before the remainder is smaller than the song-to-song variation we cannot see
anyway. Both are judgements, not measurements, and neither may move after a run.

## The arms

- **A — order.** The line starts at or before the previous line's start.
- **B — spacing.** The gap to the previous line is more than 3× or less than 1/3 of the song's
  median line gap. (3 is a judgement; it is fixed here, before the run.)
- **C — window-shift disagreement.** |D from the true prior − D from a prior shifted ±0.8 s| >
  0.25 s. Only guitar-loneliness, veil and going-my-way have the shifted runs, so this arm is
  scored on its own subset and its numbers are **not** comparable to A, B and D's.
- **D — the `pinned` flag**, the baseline already in the product. Expected to catch ~0; it is
  here so the others are read against something.
- **A∨B** — the two free signals together.

## Result

*(written after the run, below this line — the text above is not edited)*
