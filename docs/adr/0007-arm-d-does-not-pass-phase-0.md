# ADR-0007: Arm D does not pass Phase 0; stop the rewrite rather than finish the gate

- Status: **proposed** — the owner takes or refuses this branch; nothing here is decided by
  measurement alone
- Date: 2026-11-25
- Replaces ADR-0003 if accepted

## Context

ADR-0003 pre-registered a gate with two columns, `corpus-onsets` (PJS medleys) and
`human-onsets` (real accompanied songs with no catalogue LRC), and a decision rule: D passes →
D becomes the Android engine; only C passes → find a licence-clean CTC model; **neither passes →
simplify the existing pipeline rather than rewrite it**.

The `corpus-onsets` column has now been evaluated and **fails** (L62): 41% of starts within
250 ms against a required 85%, 20 unflagged lines over a second against a required zero, and
D beat the prior it was refining on 1 of 25 songs. Split by whether D decided anything, the
79 lines it pinned scored the prior's own number — they *are* the prior — and the 21 lines it
chose itself had a median error of **7.13 s**.

A non-certifying screen against the five catalogue LRCs (L62, part 2) was then run to test the
obvious objection, that medleys are unrepresentative. It does not hold: 35 of 221 lines on real
songs are over a second from the LRC and 16 are over two, **none flagged**, including 9–10 s
errors on guitar-loneliness, whose LRC is version-exact, and 12–13 s errors on veil, the
cleanest LRC in the corpus. The repeated-chorus alibi was checked and does not cover them.

## Decision

**Take the "neither passes" branch now, without finishing the `human-onsets` column.**

- Arm D does not become the Android alignment engine.
- `src/ai-pipeline/` is not ported (ADR-0002 is unchanged and still says so).
- The Android app keeps timings that arrive already timed — a synced LRCLIB result, an imported
  `.lrc` — plus tap-along and the nudge screen. It gains no automatic aligner in v1.
- The `human-onsets` column is **not** completed. It would cost roughly 100 blind listening
  judgements from the owner, on two songs they have never run through the app, to confirm a
  conclusion two independent instruments already point at.

## Why this is not gate-tampering

The gate was not restated, loosened or re-scoped after seeing a result, which ADR-0003 forbids.
A required column was evaluated as written and failed. Stopping early **can only make the
verdict stricter**: the unevaluated column could have turned a MET into a NOT MET, never the
reverse, because every column must pass separately. What this ADR gives up is the chance that D
is good on real songs and bad only on medleys — and the LRC screen is the evidence that the
chance is small, offered as a screen and not as a certificate.

## Consequences

- The Android app has no automatic alignment, and that is now a recorded decision rather than an
  open question. The product consequence is blunt: a song with no synced lyrics needs tap-along.
- The PWA keeps its pipeline, and preparation there plus `.lrc` export remains the only route to
  a timed song the app did not receive already timed.
- Phase 0's apparatus stays: the medleys, the annotations, the scorer, `knownTextAlign.mjs` and
  the Kotlin window planner in `android/align/Windows.kt`, which is now dead weight carried for a
  hypothesis that did not land. Removing it is a separate change.
- `:inference` stays empty.

## Reversal

Reverse this if any of the following becomes true, and say which:

1. **A different engine is spiked and passes a gate written before it runs.** Nothing here says
   automatic alignment is impossible — it says *this* approach, Whisper cross-attention DTW
   windowed on a prior, failed the evidence it was given.
2. **The failure is diagnosed and fixed.** The measured mechanism is that D's own starts are
   wild and its `pinned` flag catches none of them (0 of 16 lines over 2 s on real songs). An
   aligner whose flag caught its own catastrophes would be a different proposition, and clause 2
   would have been satisfiable.
3. **The owner completes the `human-onsets` column and it contradicts this.** The column is still
   open, and this ADR's cost is that it will not be filled in.
