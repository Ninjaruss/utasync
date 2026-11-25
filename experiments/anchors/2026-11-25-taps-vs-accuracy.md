# Spike: how many taps does a song need before interpolation is good enough?

**Pre-registered 2026-11-25, before the simulation was written.** Time-boxed to one day
(CLAUDE.md rule 3). Nothing enters `android/` on this result alone.

## The question

ADR-0007 leaves the Android app with no automatic aligner. The proposed replacement is not
"tap every line" but **tap a few, interpolate the rest**: the machinery already exists
(`TimingAnchor`, `applyAnchors`, the tap-along screen, the nudge screen), and `applyAnchors`
already spreads lines evenly between two pins.

The whole feature rests on one unmeasured number: **how many taps before the untapped lines
land close enough to sing to?** Six taps is a different product from thirty.

## The measurement

For each of the five songs with a catalogue LRC, treat the LRC's line starts as the reference
and simulate a user tapping *k* lines, then interpolating the rest. Report the error on the
**untapped** lines only — a tapped line is exact by construction and including it would flatter
the result.

- **Which lines a user taps.** Not a random sample: a person taps where a section starts, which
  is the line after the longest silence. So the simulated anchors are line 0 plus the *k−1*
  lines with the largest preceding gap. A second arm taps every *k*-th line, as a control for
  whether the choice of line matters at all.
- **Two interpolation rules.** (a) **even**: equal spacing between anchors, which is what
  `applyAnchors` does today; (b) **by length**: time between anchors split in proportion to each
  line's character count, since a longer line takes longer to sing.
- **k ∈ {2, 3, 5, 8, 12}**, so the answer is a curve rather than a single claim.

## What this can and cannot say

The LRC is a reference, not truth (L39, L62, ADR-0006): ~0.3 s of its own slop and an unknown
per-song offset, so each song is centred on its median. It cannot resolve 250 ms. It is adequate
here because the question is "within about a second", and because both interpolation rules are
judged against the *same* reference, so the comparison between them is fair even where the
reference is not exact.

## The gate

**Build the feature only if, at k = 6 or fewer, the better rule puts ≥ 85% of untapped lines
within 1.0 s of the reference, on at least 4 of the 5 songs.**

If it takes more than six taps, this is tap-along with extra steps and the honest answer is that
the app has no timing story beyond an imported `.lrc`. 1.0 s is the judgement from L41 — the
point where a highlight starts pointing at the wrong line — not a new constant.

## Result

*(written after the run; the text above is not edited)*

---

## Result — FAIL, and not narrowly

`node experiments/anchors/tapsVsAccuracy.mjs`. Each cell is the share of **untapped** lines
within 1.0 s of the reference, with the better of the two interpolation rules named.

**Tapped at the longest silences** (what a person would actually do):

| song | lines | k=2 | k=3 | k=5 | k=8 | k=12 |
| --- | --- | --- | --- | --- | --- | --- |
| going-my-way | 31 | 21% | 18% | 23% | 48% | 58% |
| guitar-loneliness | 36 | 41% | 21% | 23% | 25% | 33% |
| recollect | 47 | 13% | 16% | 19% | 26% | 26% |
| stranger-than-heaven | 59 | 11% | 21% | 19% | 31% | 30% |
| veil | 48 | 13% | 18% | 7% | 43% | 61% |

**Tapped every nth line** (the control):

| song | lines | k=2 | k=3 | k=5 | k=8 | k=12 |
| --- | --- | --- | --- | --- | --- | --- |
| going-my-way | 31 | 10% | 7% | 19% | 30% | 63% |
| guitar-loneliness | 36 | 21% | 36% | 26% | 50% | 71% |
| recollect | 47 | 22% | 20% | 50% | 33% | 37% |
| stranger-than-heaven | 59 | 9% | 7% | 15% | 29% | 60% |
| veil | 48 | 17% | 20% | 33% | 45% | 72% |

**The gate asked for ≥ 85% at k ≤ 6 on 4 of 5 songs. The best cell anywhere at k ≤ 5 is 50%, and
even twelve taps reaches 85% on no song at all.** Neither interpolation rule wins consistently,
which is itself informative: the choice between them is noise next to the error.

Two readings worth keeping:

- **The curve is not monotonic when tapping the longest silences** (veil: 18% at k=3, 7% at
  k=5). Not a bug — it was checked. Tapping the biggest breaks clusters the anchors where the
  breaks are, which leaves the song's tail beyond the last anchor, extrapolated from the median
  line gap. Spreading taps evenly bounds every span and does better at high k, which is the
  opposite of the behaviour the feature would have encouraged.
- **1.0 s is a generous bar and it still fails.** The reference carries ~0.3 s of its own slop,
  but that does not explain a 30–60% hit rate.

## Verdict — NO-GO. The feature is not built.

A line's timing is not predictable from its neighbours. Singing is not uniform in time: held
notes, breaths, instrumental bars and half-sung lines all break the assumption that time between
two known points divides by line or by character count. Sparse input cannot be rescued by a
cleverer fill rule, because the information is not in the lyric sheet — it is in the audio.

**What this closes, stated so it is not re-proposed:** "tap a few lines and interpolate the rest"
in any form — by line, by character count, by section. **What it leaves:** a song is timed
because it arrived timed (a synced LRCLIB result, an imported `.lrc`), or because every line was
tapped, or because something reads the audio. There is no cheap middle, and three spikes now say
so from three directions (L62, L63, this one).
