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

---

## Result — every pre-registered arm FAILED

Run 2026-11-25, `node experiments/detector/signals.mjs`. 221 lines, 16 catastrophes, 186 stable.

| arm | recall (needed ≥ 12 of 16) | false alarms (needed ≤ 28 of 186) | verdict |
| --- | --- | --- | --- |
| A order | **0 of 16** | 0 of 186 | FAIL |
| B spacing | **0 of 16** | 8 of 186 | FAIL |
| D pinned (the product's flag) | **0 of 16** | 10 of 186 | FAIL |
| A ∨ B | **0 of 16** | 8 of 186 | FAIL |
| C window-shift disagreement (own subset: 115 lines) | 1 of 8 (needed ≥ 6) | 8 of 97 | FAIL |

Not a near miss: four of the five arms caught **nothing at all**.

## What the failure revealed — the catastrophes are self-consistent

Arm A catching zero is the informative part: a line can be ten seconds out without breaking
order, which means D's output is internally smooth. Printing the gaps either side of every
catastrophic line shows why, and the pattern is the same every time:

| song, line | error | D's gap before / after | the prior's gap before / after |
| --- | --- | --- | --- |
| veil 4 | 12.2 s | 3.5 / 15.2 | **15.9 / 3.0** |
| veil 19 | 12.9 s | 3.3 / 15.8 | **15.8 / 2.9** |
| guitar-loneliness 18 | 10.4 s | 5.5 / 15.8 | **14.1 / 6.1** |
| guitar-loneliness 34 | 9.2 s | 4.9 / 14.0 | **12.3 / 5.0** |
| recollect 25 | 13.4 s | 1.7 / 16.3 | **15.3 / 3.2** |
| going-my-way 14 | 10.3 s | 7.2 / 15.4 | **17.6 / 5.5** |

**The gaps are inverted.** The prior says "long instrumental, then this line"; D says "this line,
then long instrumental". D takes the first line after an instrumental break and pulls it back to
the end of the previous section, and the error tracks the break's length. This is the case
ADR-0003's sampling rule calls out as the hard one — section entries after an instrumental — now
measured rather than assumed, and it is the same family as L37's prior-following lines, except
that these are **not** pinned: the window edge is not where they land, so the existing flag is
blind to them.

## Arm E, pre-registered against untainted truth

The inversion is an obvious candidate signal, and it was found by looking at these five songs, so
scoring it on them would be tuning on the data (rule 1). It is therefore fixed here and evaluated
**only on the PJS medleys**, whose onsets are real measured truth (phoneme labels, uncertainty
0.02 s) rather than an LRC screen, and which played no part in finding it.

- **Arm E:** flag line *i* when the prior's gap before it is more than **2×** the song's median
  prior gap **and** D's own gap before it is less than **half** the prior's. Both constants are
  judgements, fixed before the run, derived from the table above and never re-fitted.
- **Dataset:** 25 medleys, 100 scored lines — **20 catastrophes** (> 2 s from the true onset),
  **80 stable** (≤ 1 s), 0 in the excluded band.
- **Gate:** recall **≥ 15 of 20** (75%) and false alarms **≤ 12 of 80** (15%).
- A pass makes arm E a candidate to carry into the `human-onsets` column. It is still not
  permission to ship: a detector that works on medleys has not been shown to work on songs.
