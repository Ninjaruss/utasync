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
