# ADR-0003: Known-text alignment is the lead hypothesis, pending the Phase 0 gate

- Status: **proposed** — decided by the Phase 0 result, not by this document
- Date: 2026-11-03
- **Gate restated 2026-11-06, corrected 2026-11-07** (evidence terms only; see "Revision
  history" at the end)

## Context

The PWA transcribes the song with Whisper and then matches the lyric sheet to the
transcript. Its error tail comes from transcript holes, recording-version mismatches and
false confidence (ledger L14, L15, L18, L32). The lyric text is usually known, so
transcription discards information. A CTC forced-alignment spike (MMS, commits `1002f11`,
`bf0041a`) gave the best line medians measured here (p50 0.08–0.41 s) but bad tails; it was
declared a dead end without trying a skip (`<star>`) token or bounds from an independent
prior (the LRC). The MMS aligner is CC-BY-NC-4.0 and cannot ship.

## Hypothesis

Refining each line inside a window around an independent prior (catalogue LRC when it
exists), with a licence-clean model, reaches the contract: ≥85% of line starts within
250 ms of blind human onsets, no unflagged line over 1 s, and beats both the LRC as-is
and the current pipeline (live) on p90.

*(Unchanged from 2026-11-03. The gate section below is where "blind human onsets" is
replaced by the certifying kinds of ADR-0006, and where "beats A and B" is made precise.)*

## Experiment (`experiments/phase0/`)

Arms on identical, hash-locked inputs: (A) current pipeline, live; (B) LRC as-is;
(C) MMS windowed refine — ceiling only, not shippable; (D) Whisper-small known-text
alignment (cross-attention DTW) windowed around the prior. Where no catalogue LRC exists,
D's prior is the app's own run, as it would be in production, and arm B does not exist.
Truth-free diagnostics (prior independence, planted ±0.8 s offsets) are reported separately
and cannot pass the gate on their own. Measurement rules: ADR-0006.

## Gate (pre-registered; evidence terms restated 2026-11-06)

**Which evidence certifies.** Only `human-onsets` (blind: `predictionsShown: false`,
`priorPredictionExposure: "none"`; adjudicated: `status: "adjudicated"` with a named
reviewer) and `corpus-onsets`, per `scripts/lib/truthKinds.mjs` and ADR-0006. Every scored
line's `uncertainty` must be ≤ 0.25 s, because a mark coarser than the threshold cannot
adjudicate it — which is exactly why `lrc-derived` (uncertainty 0.3 s, L39) never certifies.
Draft marks are reported as drafts and certify nothing.

**How much evidence, by kind.** The two kinds do different jobs: PJS medleys carry the
volume, real songs carry the realism. PJS alone cannot pass this gate. PJS medleys are
concatenated solo sung sentences separated by silence, which is far easier than accompanied
J-pop; and spec §8.4's selection-bias argument bites the other way — the aligner only ever
runs where no catalogue LRC exists, so LRC-covered songs flatter it.

| | `corpus-onsets` (PJS medleys) | `human-onsets` (real accompanied songs) |
| --- | --- | --- |
| songs scored | ≥ 10 | ≥ 2 |
| of those, accompanied | ≥ 3 (built with `--bed`) | all of them |
| scored lines, pooled | ≥ 60 | ≥ 50 |
| scored lines per song | — | ≥ 20 |

(10 medleys at the builder's default `--per 6` is 60 lines, which is where both PJS numbers
come from; see L41.)

The real songs must be ones with **no catalogue LRC**, which is the population the aligner
actually serves; on them D runs from the app-run prior, as it would in production.

**One report, two manifests.** The two kinds live in different manifests — `benchmarks/sync`
for the real songs, `.cache/pjs/manifest.json` (local, never committed) for the medleys — so
the gate is evaluated by passing both to the scorer at once:
`node experiments/phase0/score.mjs --manifest benchmarks/sync/manifest.json --manifest .cache/pjs/manifest.json`.
A report covering one manifest shows the other kind with zero songs and therefore cannot say
MET; that is a shortfall in the invocation, and it reads as one. `--manifest` may be repeated
more than twice, which the "≥ 3 accompanied" row requires: `--bed` is one global flag per
builder run, so accompanied and unaccompanied medleys come from two runs into two `--out`
directories with a manifest each. `experiments/phase0/README.md` has the exact commands.

**Both columns must pass every clause below, separately — never pooled.** Pooling would let
60-plus easy PJS lines drown 50 hard ones.

**The stratified line sample.** Hand-marking every line of a 50-line song twice is what kept
this gate at zero. Instead, each `human-onsets` song is marked on a sample fixed **by this
rule, written down here before any marking or any run**, computed from the lyric sheet alone
and from nothing else:

1. a *block* is a run of lines between blank lines in the sheet;
2. mark every block-first line (section entries after an instrumental — the hard case);
3. mark every block-last line (tails and melisma — the other hard case);
4. mark the interior lines at every third position within the block, counting from the
   block's second line;
5. if that yields fewer than 20 lines, add interior lines in sheet order until 20 are marked;
6. every unmarked line gets `excluded: true` with `onset: null`.

**A sheet with fewer than 20 lines cannot be a gate song.** Step 5 cannot reach 20 marks on a
shorter sheet, so the rule marks every line and the per-song clause (≥ 20 scored lines) can
never be satisfied however carefully the song is marked. The decision, stated rather than left
to be discovered: a `human-onsets` gate song's sheet must read as **at least 20 non-blank
lines**, and a shorter one is reported as a per-song shortfall and contributes nothing.
Concretely, `benchmarks/sync/annotations/will-death-poetry.json` is an 18-line sheet, so the
existing listening pass on it can never count toward this gate — the two real songs have to be
others. (Marking a short song is not wasted work for `benchmarks/sync`, which asks a
whole-song question; it is simply not evidence for *this* gate.)

Nothing in the rule can be chosen after seeing a result: it reads line indices and blank
lines, never audio, never a prediction, never an error. Because of that, it is recomputed:
`experiments/phase0/score.mjs` reads the raw sheet (blank lines intact — they are the block
delimiters), derives the rule's selection, and makes a `human-onsets` song **gate-ineligible
with a printed reason** when its scored lines are not that selection. One exemption, and only
one: a song scored on *every* line of its sheet agrees, because that is the original whole-song
gate — strictly more evidence, and impossible to cherry-pick. The cost is ~25 lines a song, two
listening passes, two songs — roughly 100 careful judgements, against the 1,000-plus the
previous gate's "≥10 songs, every line" demanded. **The gate therefore certifies the sampled
lines only**, and deliberately over-weights block edges, where the errors are; it does not
claim anything about the unsampled interior.

**The clauses.**

1. **≥ 85% of scored line starts within 250 ms** of the certifying onset.
2. **No scored line over 1 s that the aligner did not flag** (`pinned` or `unstable`).
   Flagged lines over 1 s are a known cost, not a gate failure; unflagged ones are false
   confidence, which is the specific defect the hypothesis exists to fix.

   **What this clause costs, stated plainly.** A flag exempts a line from this clause
   *entirely* — not up to some larger error, but at any error. Clause 1 is what bounds the
   exposure, and it bounds it at roughly 15% of scored lines: on a 25-line song, three lines
   anywhere in the track may be as wrong as you like, provided the aligner flagged them and the
   other 22 are within 250 ms. So **this gate certifies less than the hypothesis above claims.**
   The hypothesis says known-text alignment *fixes* false confidence; what a MET verdict
   certifies is that false confidence is **labelled** — that the aligner knows which of its
   lines not to trust, and says so. A song can pass this gate and still be unusable to sing to
   on ~15% of its lines. That is a deliberate trade (a flagged line can be re-aligned, hidden
   or sent back to the user; a confidently wrong one cannot), and it is the reason
   `experiments/phase0/score.mjs` prints the flagged count and the worst scored line in the
   verdict section itself, as **reported rows, not clauses**: a reader must be able to tell a
   kind that was right from one whose errors were all exempt. Whether to cap the flagged
   fraction is a decision for this ADR, not for the scorer, and it is not capped today.
3. **D's p90 absolute error below arm A's and arm B's**, computed on the *same songs and the
   same line indices* — paired, never arm A on one set of songs and D on another. Where a
   song has no catalogue LRC, arm B does not exist and clause 3 reduces to beating arm A on
   it. **A comparison that did not run is "not evaluated", and the gate is not met**: silence
   is never a pass.

   **Arm B is never tested against a real catalogue artefact under this gate, and that is a
   change.** The `human-onsets` songs are required to have *no* catalogue LRC (that is the
   population the aligner serves), so arm B does not exist for a single one of them and clause 3
   reduces to arm A on the whole `human-onsets` column. The only arm-B evidence this gate can
   ever hold is on `corpus-onsets`, against the **synthetic prior the builder plants for itself**
   (`experiments/phase0/pjs/buildCorpus.mjs`; its constants are ledger L42). So "beats the LRC
   as-is" — half of the original hypothesis — is not tested by this gate at all. The report's row
   is named `D p90 below arm B, per song with an arm B prior` rather than "with an LRC" for that
   reason. Reinstating the real comparison means a third set of songs that *do* have a catalogue
   LRC, scored against certifying truth; that is more evidence than this gate asks for, and
   deliberately out of its scope.

**What arms A and B are on a PJS medley.** Arm B is the synthetic prior `buildCorpus.mjs`
plants (a constant per-medley offset plus per-line jitter, in place of a catalogue LRC): a fair
prior, but a stand-in for a catalogue artefact rather than one. Arm A is a run of the current
PWA pipeline over the medley's own `.wav` and lyric sheet — nothing about a medley prevents it,
since it is ordinary local audio with a matching sheet. **Two pieces of plumbing do not exist
yet**, and until they do the `corpus-onsets` column cannot pass clause 3: `scripts/sync-benchmark.mjs`
reads `benchmarks/sync/manifest.json` at a fixed path and so cannot see a medley, and
`runAll.sh` has no PJS entries. The consequence, stated rather than left to be discovered:
with only `--prior lrc` runs the report prints arm A as "not evaluated" for `corpus-onsets`,
which is NOT MET. Closing it means teaching the benchmark harness a manifest path and adding
the PJS songs to the batch; it is a change to the instrument, not to this gate, and it is not
part of the restatement.

250 ms and 1 s are **judgements, not measurements** — see ledger L41 for what each rests on
and what it is bracketed against. Nothing in this repository measures how sharply a *sung*
onset can be located, and sung onsets are genuinely soft: a melisma or a breathy consonant
has no single correct instant.

**Who reads the verdict.** `node experiments/phase0/score.mjs` prints these numbers and the
current verdict. A kind with too few songs or lines prints a shortfall and NOT MET.

**What the report cannot check, and so is the owner's to honour when choosing songs:** that a
`human-onsets` song is real accompanied music with no catalogue LRC. That is a selection
decision made before marking, and no hash can see it. Everything else in this gate is
machine-checked — including, since 2026-11-07, that the marked lines are the ones the sampling
rule selects: the rule is computed from the lyric sheet alone, so the scorer recomputes it
rather than taking it on trust.

## Decision rule (pre-registered, unchanged)

- D passes → D becomes the Android engine; `src/ai-pipeline` is not ported.
- Only C passes → find a permissively licensed CTC model before building.
- Neither passes → simplify the existing pipeline rather than rewrite it.

Passing on `corpus-onsets` while missing on `human-onsets` is the "neither passes" branch,
and it is an informative result, not a near miss.

## Reversal

This ADR is replaced by an accepted ADR once the gate above is evaluated and a branch of the
decision rule is taken. The gate's *evidence terms* may be restated again only before the
evaluating run (as they were on 2026-11-06 and corrected on 2026-11-07, both with zero
certifying songs scored and so no result to tune against); restating them after a run, in the
direction of the result, voids the pre-registration.

## Revision history

**2026-11-06 — the gate's evidence terms were restated. The hypothesis, the arms and the
decision rule are unchanged.** This is a revision, not the original; a reader comparing it to
a quotation of the original should expect the gate paragraph to differ.

- *Was:* "≥85% of line starts within 250 ms of blind human onsets, no unflagged line over
  1 s, and beats both the LRC as-is and the current pipeline (live) on p90", evaluated "on
  ≥10 songs" of blind human onsets.
- *Why:* that gate was never evaluable and the cost is why. Zero songs carry blind,
  adjudicated human onsets today — the corpus holds one `human-onsets` annotation still in
  `status: "draft"` after one listening pass, and one `coarse-captions` annotation. At ~50
  lines a song and two independent passes, ten songs is over a thousand careful listening
  judgements from one person. Spec §8.5 directs that the bar be re-derived from the corpus
  rather than inherited.
- *What changed:* five things, each written out in full in the gate section above rather than
  summarised twice here — the certifying kinds, the per-kind song and line counts, the
  stratified sample in place of every line, what "beats A and B" means when the arms did not
  run on the same songs, and the thresholds relabelled as judgements (ledger L41).
- *What clause 3 lost, which the first version of this history did not admit.* It said clause 3
  was only made precise. It was also narrowed: because the gate requires the `human-onsets`
  songs to have no catalogue LRC, **arm B does not exist for any gate song that is real music**,
  and the only arm-B comparison the gate can hold is against the builder's own synthetic prior
  on PJS medleys. "Beats the LRC as-is" is therefore no longer tested against a real catalogue
  artefact at all. Stated beside clause 3 above.
- *What did not change:* the hypothesis, the four arms, the decision rule, 250 ms, 85% and
  the 1 s unflagged limit. The numbers were not loosened — the evidence demanded was made
  affordable and its shape was made explicit.

**2026-11-07 — corrections to the 2026-11-06 restatement, still before any evaluating run. No
threshold, count or arm moved.** A whole-branch review found that the restatement was readable
as healthier than it is; each correction below removes a way the apparatus could look fine
having certified less than it appeared to.

- Clause 2's exemption is now stated with its consequence: a flag exempts a line at *any*
  error, clause 1 bounds the exposure at ~15% of scored lines, and so the gate certifies that
  false confidence is **labelled**, not that it is fixed.
- The scorer prints the flagged count, the worst scored line and the missing predictions in the
  verdict section, as reported rows. Before this, a kind could read MET with lines arbitrarily
  wrong and the verdict section showed nothing a reader could notice it by.
- Clause 3's narrowing is recorded (above), and the report's arm B row is renamed to stop
  claiming a catalogue LRC that, for medleys, does not exist.
- The sampling rule is machine-checked instead of being listed among the things "no hash can
  see", which it never was: it is computed from the sheet alone, so the scorer recomputes it.
- The minimum sheet length a gate song needs (20 non-blank lines) is stated, with the
  consequence for the one song already marked.
- `PIN_SEC`, which decides which lines clause 2 exempts, and the builder's planted prior
  constants, which set the bar clause 3 asks arm D to beat on medleys, have a ledger entry
  (L42) saying what they are bracketed against. Both are judgements; neither is measured.
