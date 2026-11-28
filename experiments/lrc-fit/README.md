# Can a record for the wrong cut be fitted to the user's audio?

**Written before any code was run (rule 3). Time box: one day.**

## The question, and why it is not arm D

L62/L63/L64 closed three routes to a timed song: aligning from scratch is wrong in the
tail, nothing detects where, and interpolating between a few taps does not work. This
asks something smaller that none of them covered.

Today's L68 found that only **5 of the owner's 10 local songs** have an LRCLIB record
whose length matches the file. The others mostly **do** have a record — it is for a
different cut. The clearest case: a 4:38 studio record against a 6:33 First Take
recording of the same song, same words, different performance.

So: given a synced record whose **text is right** and whose **timings belong to another
cut**, can a global transform put it on the user's audio well enough to sing to?

This is prior *refinement*, the one thing in this file with a positive measurement
behind it (L12: refining an already-timed LRC beat aligning from scratch, 8 of 8 pairs).
It is not arm D and does not read the audio.

## The arms

All three fit one affine map `t' = scale · t + offset`. They differ only in where the
two numbers come from. None analyses audio; Android has no vocal-activity detection, so
an arm that needed one could not be built cheaply anyway.

| arm | taps the user makes | scale from | offset from |
| --- | --- | --- | --- |
| **A0** | — | 1 (none) | 0 (none) — the record as it stands, the baseline |
| **A1** | — | user audio length ÷ record length | 0 |
| **A2** | 1 | user audio length ÷ record length | the tap on line 1 |
| **A3** | 2 | the two taps | the two taps |

A3 is the honest ceiling: with the first and last line tapped, the affine map is
determined exactly, and what is left is the error the model itself cannot represent —
the part of a different cut that is not a stretch, such as an added solo.

L64 is not a counter-argument. It interpolated **between** taps with no prior and found
a line's timing is not predictable from its neighbours. Here every line's timing is
already known from the record; only two global numbers are being fitted.

## Corpus and reference

Songs with (a) local audio, (b) an LRCLIB record whose declared length matches the file
within ±3 s — the **reference** — and (c) at least one further record for the same song
whose length differs by more than 5 s — the **input**. Each (reference, input) pair is
one case.

Lines are compared only where their text matches after normalisation, so a record with
different line breaks contributes only its unambiguous lines.

**The reference is a reference, not truth** (L39, L62): a version-exact record can still
be a few hundred milliseconds off throughout. Every arm faces the same reference, and
the question asked here — "within about a second" — is coarse relative to that error.

## The gate

Build a fitting feature only if **both** hold:

1. **Usable:** on **≥ 4 of 5** songs, some arm puts **≥ 85%** of matched lines within
   **1.0 s** of the reference. (Same bar and shape as L64's pre-registered gate, so the
   two are comparable and the number is not chosen after seeing this data.)
2. **No harm:** that arm's within-1.0 s percentage is **at least A0's on every pair**, and
   strictly greater on at least one. A transform that
   improves most songs and wrecks one is not shippable, because nothing here can tell
   the user which they got — that is exactly L63's lesson.

Also reported, deciding nothing: % within 0.5 s, the worst line, and how the arms rank
against each other, so the cost of each extra tap is visible.

If only A3 passes, the feature is "tap the first and last line", not "automatic" — and
that result is reported as such rather than dressed up.

## Limits, stated before the run

- Five songs, one person's library. Nothing here generalises to another catalogue.
- A "different cut" is not one thing: a radio edit, a live take and a remaster fail an
  affine map in different ways and this corpus does not separate them.
- Declared record length is metadata, not a measurement of the audio.
- Text matching decides which lines are scored; a song whose records share little text
  contributes few lines and is weighted accordingly. Counts are reported per pair.

## Reproduce

    node experiments/lrc-fit/fit.mjs <folder-of-audio-files> [names.json]

Records are cached under `.cache/lrc-fit/` because they contain lyric text; nothing
printed here contains any (rule 6).
