# ADR-0006: How alignment accuracy is measured

- Status: accepted
- Date: 2026-11-06

## Context

Every alignment decision this project has made rests on a number, and the numbers were not
trustworthy. Two documented failures, both from this repository's own audits:

1. **The committed accuracy gate subtracted a per-song median offset before scoring.** A
   constant lag makes every line late by the same amount; normalising it away cancels
   exactly the error you most need to see. One song passed the green test while sitting
   ~1.18 s behind the music, with 40 of 59 lines more than a second off.
2. **The truth corpus had two songs**, and the tests auto-skip when private fixtures are
   absent — so a run with no audio present was *green*.

Separately, rule 6 (ADR-0004) forbids committing song text, and an LRC file *is* song text.
That is why the corpus could not grow: there was nowhere to put truth.

This ADR records the measurement regime, so that it is not re-litigated. It does not set the
Phase 0 pass bar; that is ADR-0003.

## Decision

**1. Offsets are reported, never subtracted.** Scoring reports raw per-line absolute error,
the fraction within a stated tolerance, p50, p90, the worst line, and the median *signed*
offset as a number of its own. No scorer may fit and remove a per-song offset, a drift slope,
or any other transform of its own predictions before comparing them to truth. A constant lag
is the governing failure this whole apparatus exists to catch; a fitted offset is the one
operation guaranteed to hide it.

**2. Truth lives in git as per-line hashes, never as text.** An annotation stores, per line,
`textHash` (the canonical hash of the line's text) plus `onset` and `uncertainty` — no lyric
text, in the file or in any log or report. The hash is enough: the scorer only needs to
confirm it is comparing like with like. `scripts/lib/lyricHash.mjs` defines one canonical
normalisation (trim, collapse whitespace, NFKC, strip punctuation and bracketed annotations),
versioned by `lineHashVersion`; changing it invalidates every stored hash, which is correct
and should be noisy. A hash mismatch is a **loud, counted skip** naming the song and the line
index — never a silent drop, and never the text of either side.

**3. A run that scored too few songs fails.** A scoring run reports the count it scored, and
a count below what the gate requires is a shortfall and a **failure to evaluate** — printed,
never a pass and never silence. Skipped songs are listed with their reason and feed the same
shortfall. Silence is never success.

**4. Which kinds of truth may certify an accuracy claim.** The one table is
`scripts/lib/truthKinds.mjs`; every scorer and guard asks it and none keeps its own list.

| kind | scores | certifies | why |
| --- | --- | --- | --- |
| `human-onsets` | yes | yes | Blind human marks are the only listened truth. |
| `corpus-onsets` | yes | yes | Measured from a corpus whose timing is known (PJS), grain 0.02–0.05 s (L40). |
| `lrc-derived` | yes | **no** | A catalogue LRC's own offset against the singing is ±0.3 s (L39), *larger* than the 0.25 s tolerance a claim is made at — it cannot adjudicate that tolerance. Regression signal only. |
| `coarse-captions` | yes | **no** | Caption-level timing is too coarse. |
| `unverified-lrc` | no | no | Planned or unreviewed; cannot score at all. |

A `human-onsets` annotation certifies only when it is blind and adjudicated:
`predictionsShown: false`, `priorPredictionExposure: "none"`, `status: "adjudicated"`, a named
reviewer, and `uncertainty` on every scored line no larger than the tolerance being claimed.
A single-pass draft is reported as a draft and certifies nothing. Model confidence, stored
transcripts and the aligner's own output are not truth under any circumstances (rule 1).

**5. Truth-free diagnostics are reported separately and can never pass a gate.** Prior
movement, two-independent-prior convergence and planted-offset recovery say whether a method
is anchored to the audio. They cannot say it is anchored to the *right place*.

## Consequences

- The corpus can live in the repository and grow, and CI can validate it without audio:
  `node scripts/corpus-ci.mjs` checks shape, hash version and kind agreement;
  `npm run benchmark:test` checks the scorers' own logic. Scoring itself is local, on the
  owner's machine, because the audio cannot go in git.
- Reports are longer and less flattering than the ones they replace. That is the point.
- **A stratified line sample is not "precise" to `benchmarks/sync`.** The `precise` predicate
  in `scripts/lib/syncBenchmark.mjs` requires an annotation with no excluded lines, because
  that instrument answers a whole-song question. ADR-0003's gate scores a pre-registered
  sample, with the unsampled lines marked `excluded`, so such an annotation certifies the
  Phase 0 gate (`experiments/phase0/score.mjs`) while deliberately not setting
  `eligibleForAccuracyClaim` in `scoreRun`. Reconciling the two is a separate change with its
  own ledger line; the two predicates answer different questions and are kept apart on
  purpose.
- **"Certifies" means two different things, and a reader must not take `canCertify` for the
  whole test.** The table above is about *kinds*: `canCertify('corpus-onsets')` is true, and that
  is what `experiments/phase0/score.mjs` asks. The `precise` predicate in
  `scripts/lib/syncBenchmark.mjs` additionally requires `kind === 'human-onsets'` *literally*, so
  it can never be true for a `corpus-onsets` annotation however well-formed — measured corpus
  truth is not listened truth, and `benchmarks/sync` asks "is this whole song right, against a
  human?". The code says so in a comment at that line; it is recorded here too, because
  `canCertify` reads like the certification test and is only half of it. In short: `canCertify`
  answers "may a score against this kind back an accuracy claim at all", `precise` answers "is
  this whole-song, blind, adjudicated, human-listened truth". A change that collapses them needs
  its own ADR, not a patch.

## Reversal

- Rule 1 (no subtraction) is reversed only by a measurement showing that a fitted offset is
  an artefact of the *instrument* rather than of the aligner — e.g. a decoder-level constant
  latency measured against synthetic audio with planted onsets. "It makes the numbers look
  better" is not that measurement.
- Rule 2 (hashes) is reversed if ADR-0004 is reversed, or if a licence-clean corpus of real
  accompanied singing with redistributable lyrics exists, in which case text may be committed
  for those songs and the hash becomes optional for them.
- Rule 3 (too few songs fails) is reversed when the corpus is large enough that the count stops
  carrying information — concretely, when every song a scorer can reach is scored on every run,
  so a shortfall can only mean a missing *input* rather than a missing *judgement*. Then the
  count becomes a warning and the failure moves to the inputs. It is **not** reversed because a
  run was inconvenient, nor because the absent songs were believed to be representative.
- Rule 4 is reversed per row by measurement: if a catalogue LRC's offset against the singing
  were measured on enough songs to be bounded well below the claimed tolerance, `lrc-derived`
  could certify at a correspondingly looser tolerance. L30 and L36 are the opposite result.
- Rule 5 (diagnostics never pass a gate) is reversed for one diagnostic only by a measurement
  that ties it to error against certifying truth — a correlation, on enough songs to be worth
  trusting, between that diagnostic and absolute line error. Until such a measurement exists,
  "the method is clearly anchored" is not a substitute for scoring it; L36 is exactly that
  situation, recorded as a truth-free result and not as an accuracy claim.
