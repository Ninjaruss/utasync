# Selective anchored CTC refine — spike findings

Date: 2026-08-01

Spike question: does a CTC refiner applied ONLY to untrusted lines, inside
windows pinned by trusted anchor lines from the shipped pipeline, beat the
current word-mode + mixed-consensus baseline on dense code-switched songs?
Prior art: `531e0d3` measured the BLANKET hybrid (all lines, 4-line groups) —
mixed result, not adopted. This spike targets the selective variant that
commit's conclusion flagged as the only plausible-but-unvalidated role.

**Answer: NO-GO** (see Verdict section below). This document covers the full
spike: baseline (Task 4), selective-refine mechanism (Task 5), and the full
sweep + gate evaluation (Task 6).

## Baseline

Script: `scripts/hybrid-align-scorecard.mjs` (baseline mode — no `--selective`
flag). Scores the CURRENT app aligner against synced-LRC truth:
`refineMixedLanguageAlignment` (real two-pass ja/en word-mode consensus merge)
for the two mixed songs, `refineAlignmentWithPhrases` for the three
single-language songs. `going-my-way` has no committed transcript fixture and
is skipped (CTC-only guard, exercised in a later task).

Command:

```
npx tsx scripts/hybrid-align-scorecard.mjs
```

Full output:

```
recollect: baseline scored=47 rawMean=5.09 normMean=5.03 anchors=0
stranger-than-heaven: baseline scored=59 rawMean=1.97 normMean=1.32 anchors=20
guitar-loneliness: baseline scored=36 rawMean=0.58 normMean=0.55 anchors=40
veil: baseline scored=48 rawMean=0.41 normMean=0.38 anchors=34
skip going-my-way (missing fixture)

=== HYBRID SCORECARD ===
config                                scored  anch | raw:  mean   p50   p90  >1s >1.5 | norm:  mean   p50   p90  >1s >1.5 | off
recollect (baseline)                     47     0 |      5.09  4.23 13.50   36   32 |       5.03  4.03 12.59   39   34 | -0.91
stranger-than-heaven (baseline)          59    20 |      1.97  1.46  4.13   43   27 |       1.32  0.56  2.82   18   16 | 1.36
guitar-loneliness (baseline)             36    40 |      0.58  0.29  1.93    9    5 |       0.55  0.29  1.80    8    5 | 0.13
veil (baseline)                          48    34 |      0.41  0.26  0.98    4    2 |       0.38  0.22  0.86    4    3 | -0.12
```

### Per-song consensus-anchor counts (`consensusAgreedLines`, mixed songs only; single-language songs use their own `good`-quality lines as anchors)

| song | scored lines | consensus/good anchors |
|---|---|---|
| recollect | 47 / 53 | 0 |
| stranger-than-heaven | 59 / 59 | 20 |
| guitar-loneliness | 36 / 47 | 40 |
| veil | 48 / 48 | 34 |
| going-my-way | skipped (no transcript fixture) | — |

### Notes / sanity checks

- Word counts loaded per fixture (via `--debug`): recollect ja=607 words /
  en=47 chunks; stranger-than-heaven ja=557 words / en=76 chunks;
  guitar-loneliness ja=395 words; veil ja=408 words. All well above the
  zero-word-count failure mode that invalidated `531e0d3`'s first run.
- No song scored 0 lines or produced a >30s mean, so the harness is trusted
  as-is; no debugging workaround was needed beyond the `--debug` word-count
  print added to the script.
- `recollect` normMean (5.03s) is above the rough 2-4s vicinity noted in the
  task's prior-round expectation, but this is the FIRST word-mode mixed
  baseline (prior rounds measured segment-mode) and the plan explicitly
  allows deviation here. It was cross-checked directly (see below) rather
  than accepted blindly.
- **`recollect` has zero consensus anchors.** Traced with an ad-hoc debug
  script comparing the ja-pass and en-pass per-line `startTime`/quality: the
  two forced-language passes disagree by roughly 15-55s across most of the
  song (only converging to within a few seconds near the very end), and
  where they do get close the quality labels are not both `approximate`/
  `good` at the same time. `CONSENSUS_AGREE_TOL` is 2.5s, and the passes
  never satisfy both the tolerance and the rank gate simultaneously except
  near the tail. This is a genuine property of this fixture pairing (ja
  word-mode transcript vs. the forced-en segment transcript), not a script
  bug — it means the selective-CTC-refine task (Task 5) will have NO trusted
  anchors to pin windows against for `recollect`, which the next task needs
  to handle (e.g. treat as an anchor-starved case, or fall back to another
  anchor source).
- `stranger-than-heaven`'s raw mean (1.97s) vs. norm mean (1.32s) shows a
  real +1.36s offset — consistent with the plan's warning that offset
  normalization can hide real lag; both are reported per the task spec.

## Word-mode mixed regression (headline side-finding)

The current shipped app path for mixed songs is word-JA + segment-EN two-pass
with cross-pass consensus merge (`recollect (baseline)` row below). On
Recollect this scores **norm mean 5.03s with 0 consensus anchors**. Swapping
only the JA pass to segment-mode transcripts (`recollect (baseline
ja=segment)`, everything else identical) scores **norm mean 2.50s with 26
consensus anchors** — less than half the error, at zero extra cost (no model,
no CTC, just a different already-committed transcript fixture).

The mechanism: `CONSENSUS_AGREE_TOL` (`src/ai-pipeline/mixedLanguageAlign.ts:90`)
is 2.5s. In word-mode, the JA and EN passes disagree by roughly 15-55s across
most of the song (converging only near the very end), so the consensus rescue
that the pipeline depends on for mixed songs never fires — Recollect gets zero
trusted anchors and the merge falls back to raw per-line quality picking,
which is exactly the false-confident failure class the design doc describes.
Word-mode-everywhere (PRs #37/#39) silently disabled this rescue for
Recollect; it was never re-validated against the mixed-song consensus path
after landing.

**Stranger-than-heaven corroboration — weaker than expected, an honest
caveat:** stranger does NOT show the same collapse. Its word-mode pass
retains 20 consensus anchors (norm mean 1.32) vs. 21 anchors in segment-mode
(norm mean 1.76) — word mode is actually *better* for stranger, the opposite
direction from Recollect. So this is not a universal "word-mode breaks
consensus on all mixed songs" defect; it is specific to how badly Recollect's
word-JA and forced-EN passes diverge relative to `CONSENSUS_AGREE_TOL`. A
blanket "force segment-JA on all mixed songs" fix would help Recollect
(5.03→2.50, −50%) but regress stranger's own baseline (1.32→1.76, +33%
worse) using nothing but the already-shipped consensus mechanism — see Next
steps.

## Sweep table

Command: `npx tsx scripts/hybrid-align-scorecard.mjs --sweep --debug` (the
`--debug` flag was added on top of the task's suggested command to also
capture window diagnostics in the same run; it does not change scored
numbers). Full verbatim scorecard section:

```
=== HYBRID SCORECARD ===
config                                scored  anch | raw:  mean   p50   p90  >1s >1.5 | norm:  mean   p50   p90  >1s >1.5 | off
recollect (baseline)                     47     0 |      5.09  4.23 13.50   36   32 |       5.03  4.03 12.59   39   34 | -0.91
recollect (baseline ja=segment)          47    26 |      2.50  1.77  6.04   32   30 |       2.50  1.84  5.97   32   30 | -0.07
recollect sel/none/pad1 (ja=word)        47     0 |      1.30  0.53  4.42   17   12 |       1.26  0.45  4.31   17   13 | 0.18
recollect sel/none/pad1 (ja=segment)     47     0 |      1.30  0.53  4.42   17   12 |       1.26  0.45  4.31   17   13 | 0.18
recollect sel/consensus/pad0.5 (ja=word)    47     0 |      1.30  0.53  4.42   17   12 |       1.26  0.45  4.31   17   13 | 0.18
recollect sel/consensus/pad1 (ja=word)    47     0 |      1.30  0.53  4.42   17   12 |       1.26  0.45  4.31   17   13 | 0.18
recollect sel/consensus/pad2 (ja=word)    47     0 |      1.30  0.53  4.42   17   12 |       1.26  0.45  4.31   17   13 | 0.18
recollect sel/both/pad0.5 (ja=word)      47    10 |      3.17  1.57  6.98   25   24 |       3.07  1.81  6.64   26   24 | 0.34
recollect sel/both/pad1 (ja=word)        47    10 |      3.46  1.70  7.60   27   26 |       3.37  1.94  7.26   28   27 | 0.34
recollect sel/both/pad2 (ja=word)        47    10 |      3.39  1.61  7.60   26   24 |       3.29  1.71  7.13   26   25 | 0.47
recollect sel/consensus/pad0.5 (ja=segment)    47    26 |      2.56  2.03  6.65   28   26 |       2.53  1.72  6.30   28   25 | -0.35
recollect sel/consensus/pad1 (ja=segment)    47    26 |      2.56  2.03  6.65   28   26 |       2.53  1.72  6.30   28   25 | -0.35
recollect sel/consensus/pad2 (ja=segment)    47    26 |      2.60  2.03  6.65   28   26 |       2.57  1.72  6.30   28   25 | -0.35
recollect sel/both/pad0.5 (ja=segment)    47    40 |      2.47  2.03  6.04   30   29 |       2.47  2.00  5.97   30   29 | -0.07
recollect sel/both/pad1 (ja=segment)     47    40 |      2.47  2.03  6.04   30   29 |       2.47  2.04  6.00   30   29 | -0.03
recollect sel/both/pad2 (ja=segment)     47    40 |      2.54  2.03  6.04   30   29 |       2.53  2.04  6.00   30   29 | -0.03
stranger-than-heaven (baseline)          59    20 |      1.97  1.46  4.13   43   27 |       1.32  0.56  2.82   18   16 | 1.36
stranger-than-heaven (baseline ja=segment)    59    21 |      2.26  1.50  6.50   40   27 |       1.76  0.56  6.66   22   17 | 1.18
stranger-than-heaven sel/none/pad1 (ja=word)    59     0 |      2.90  1.49  9.74   52   29 |       1.99  0.41  8.84   20   17 | 1.47
stranger-than-heaven sel/none/pad1 (ja=segment)    59     0 |      2.90  1.49  9.74   52   29 |       1.99  0.41  8.84   20   17 | 1.47
stranger-than-heaven sel/consensus/pad0.5 (ja=word)    59    20 |      2.05  1.55  5.32   45   31 |       1.61  0.58  4.73   22   20 | 1.21
stranger-than-heaven sel/consensus/pad1 (ja=word)    59    20 |      2.12  1.55  5.32   45   31 |       1.67  0.58  5.50   22   20 | 1.21
stranger-than-heaven sel/consensus/pad2 (ja=word)    59    20 |      2.90  1.58  7.58   44   32 |       2.67  0.85  8.50   27   22 | 0.91
stranger-than-heaven sel/both/pad0.5 (ja=word)    59    37 |      2.27  1.56  5.54   46   31 |       1.95  0.65  6.70   24   22 | 1.16
stranger-than-heaven sel/both/pad1 (ja=word)    59    37 |      2.68  1.58  5.57   45   33 |       2.37  0.76  6.56   26   21 | 1.00
stranger-than-heaven sel/both/pad2 (ja=word)    59    37 |      2.60  1.58  6.46   45   32 |       2.30  0.82  7.45   27   22 | 1.00
stranger-than-heaven sel/consensus/pad0.5 (ja=segment)    59    21 |      2.52  1.74  5.48   46   34 |       2.14  0.65  5.59   24   22 | 1.25
stranger-than-heaven sel/consensus/pad1 (ja=segment)    59    21 |      2.49  1.74  5.40   46   34 |       2.10  0.65  5.59   24   22 | 1.25
stranger-than-heaven sel/consensus/pad2 (ja=segment)    59    21 |      2.73  1.76  5.96   47   36 |       2.46  0.87  6.99   27   23 | 1.03
stranger-than-heaven sel/both/pad0.5 (ja=segment)    59    36 |      2.56  1.58  7.29   43   32 |       2.30  0.94  8.23   29   21 | 0.94
stranger-than-heaven sel/both/pad1 (ja=segment)    59    36 |      2.83  1.74  7.20   43   34 |       2.57  0.94  8.14   29   22 | 0.94
stranger-than-heaven sel/both/pad2 (ja=segment)    59    36 |      2.73  1.61  7.20   43   34 |       2.50  1.12  8.12   31   23 | 0.92
guitar-loneliness (baseline)             36    40 |      0.58  0.29  1.93    9    5 |       0.55  0.29  1.80    8    5 | 0.13
guitar-loneliness sel/none/pad1          36     0 |      0.54  0.20  2.01    8    5 |       0.44  0.08  1.82    8    5 | 0.19
guitar-loneliness sel/good/pad0.5        36    40 |      0.55  0.27  1.97    8    5 |       0.52  0.25  1.88    8    5 | 0.13
guitar-loneliness sel/good/pad1          36    40 |      0.55  0.27  1.97    8    5 |       0.52  0.25  1.88    8    5 | 0.13
guitar-loneliness sel/good/pad2          36    40 |      0.55  0.27  1.97    8    5 |       0.52  0.25  1.88    8    5 | 0.13
veil (baseline)                          48    34 |      0.41  0.26  0.98    4    2 |       0.38  0.22  0.86    4    3 | -0.12
veil sel/none/pad1                       48     0 |      1.54  0.23  4.72    8    7 |       1.53  0.20  4.79    7    7 | -0.08
veil sel/good/pad0.5                     48    34 |      1.13  0.23  3.17   11   10 |       1.09  0.25  3.03   11    9 | -0.14
veil sel/good/pad1                       48    34 |      1.31  0.27  3.88   13   11 |       1.28  0.26  3.75   13   11 | -0.13
veil sel/good/pad2                       48    34 |      1.40  0.27  4.77   13   11 |       1.38  0.26  4.64   13   11 | -0.13
```

going-my-way was skipped (`skip going-my-way (missing fixture)`) — no committed
transcript, same as the baseline task. No errors, no >30s outliers, no 0-scored
songs anywhere in the run (checked against the log directly, not summarized
by eye).

## Verdict: NO-GO

**Gate (pre-committed, design doc §4):** GO iff some single selective config
(a real anchored config — nonzero anchors, not `sel/none` and not a
0-anchor-degenerate `sel/consensus` run, which is the same monolithic
architecture wearing a different label) improves Recollect norm mean AND
norm p90 by ≥25% vs. the best cheap baseline (segment-JA: mean 2.50, p90
5.97), AND at that same config stranger/guitar/veil regress on no metric by
>10% vs. their own baselines.

Threshold: mean ≤ 2.50 × 0.75 = **1.875s**, p90 ≤ 5.97 × 0.75 = **4.478s**.

Real anchored configs for Recollect (anchors > 0 only):

| config | anchors | norm mean | norm p90 | vs. threshold |
|---|---|---|---|---|
| sel/both (ja=word) | 10 | 3.07 – 3.37 | 6.64 – 7.26 | fails (worse than baseline) |
| sel/consensus (ja=segment) | 26 | 2.53 – 2.57 | 6.30 | fails (worse than baseline) |
| sel/both (ja=segment) | 40 | **2.47** (best) | **5.97** (best) | fails — mean −1.2%, p90 0% (needed −25% on both) |

The single best real-anchored candidate (`recollect sel/both/pad0.5
(ja=segment)`) improves mean by (2.50−2.47)/2.50 = **1.2%** and p90 by
(5.97−5.97)/5.97 = **0%** — nowhere near the 25% bar on either metric. No
config gets close enough to warrant checking the guard-song regression
clause; the gate fails at the improvement step alone.

**Verdict: NO-GO.** Selective anchored CTC refine does not beat the cheap
segment-JA baseline on the target song. Recorded as a measured dead-end per
the pre-committed gate — no post-hoc softening applied.

## Monolithic arm finding (`sel/none`, does not count toward the gate)

Per the design doc, `sel/none` (empty anchor set → the whole song is one
guarded window, CTC bounded only by `[0, duration]`) is a different
architecture from selective anchored refine and is excluded from the gate by
construction — it carries the same cascade risk the design doc's prior art
already ruled NO-GO for monolithic CTC. Recorded here as a separate finding,
not a candidate.

| song | norm mean | norm p50 | norm p90 | >1s | >1.5s | scored |
|---|---|---|---|---|---|---|
| recollect | 1.26 | 0.45 | 4.31 | 17 | 13 | 47 |
| stranger-than-heaven | 1.99 | 0.41 | **8.84** | 20 | 17 | 59 |
| guitar-loneliness | 0.44 | 0.08 | 1.82 | 8 | 5 | 36 |
| veil | 1.53 | 0.20 | 4.79 | 7 | 7 | 48 |

Recollect's `sel/none` norm mean (1.26) is in fact the single best number for
Recollect anywhere in this spike — better than every baseline and every real
anchored selective config. This is the exact result the task's rationale
flagged as worth recording in full. It does **not** change the verdict: the
design doc's monolithic-CTC prior art ("on par overall, seam cascades — one
lyric/audio coverage hole skips ahead and crams the rest... excellent p50,
unreliable tails, no self-assessment") is directly visible in this same data.
Stranger's `sel/none` p90 is 8.84s — worse than stranger's own *word-mode
baseline* p90 (2.82s) by more than 3x — and veil, a clean single-language
song with an excellent 0.38s baseline mean, gets a 4x-worse mean (1.53) and
5.5x-worse p90 (4.79 vs. 0.86) under monolithic CTC. A good mean with a bad
tail and no mechanism to flag which lines fell in the bad tail is exactly the
failure mode that makes monolithic CTC unshippable, gate or no gate.

## Window diagnostics

Per-config window count and lines re-timed, from `--debug` output (compact
summary; full per-window bounds are in the raw log):

| config | windows | lines re-timed |
|---|---|---|
| recollect sel/none/pad1 (both ja-modes) | 1 | 53 |
| recollect sel/consensus/pad0.5–2 (ja=word, 0 anchors) | 1 | 53 |
| recollect sel/both/pad0.5–1 (ja=word) | 6 | 43 |
| recollect sel/both/pad2 (ja=word) | 6 | 43 |
| recollect sel/consensus/pad0.5–2 (ja=segment) | 4 | 27 |
| recollect sel/both/pad0.5–2 (ja=segment) | 6 | 13 |
| stranger sel/none/pad1 (both ja-modes) | 1 | 59 |
| stranger sel/consensus/pad0.5–2 (ja=word) | 7 | 39 |
| stranger sel/both/pad0.5–2 (ja=word) | 9 | 22 |
| stranger sel/consensus/pad0.5–2 (ja=segment) | 7 | 38 |
| stranger sel/both/pad0.5–2 (ja=segment) | 9 | 23 |
| guitar sel/none/pad1 | 1 | 47 |
| guitar sel/good/pad0.5–2 | 6 | 7 |
| veil sel/none/pad1 | 1 | 48 |
| veil sel/good/pad0.5–2 | 10 | 14 |

Pattern: more anchors → more, smaller windows, and a shrinking refined-line
count (most lines near a `both`-policy anchor set are themselves anchors and
are never re-timed). This is consistent with the module's contract
(`scripts/lib/selectiveWindows.mjs`) — no surprises here; recorded for the
record per the task spec, not because it changes the verdict.

## Next steps

**Selective anchored CTC refine (this spike): stop.** NO-GO per the
pre-committed gate. No config on any song approached the 25% bar, several
real-anchored configs actively regressed vs. their own cheap baselines
(Recollect sel/both ja=word: 3.07–3.37 vs. 1.26 monolithic and 2.50 segment
baseline; veil sel/good: 1.09–1.38 vs. 0.38 baseline; guitar sel/good: flat
to slightly worse). The mechanism (Whisper-bounded window + CTC refine
inside it) does not clear the bar this round; do not revisit without a new
idea, not just re-tuned parameters — pad and anchor-policy were already
swept.

**Actionable outcome: the word-mode mixed regression.** This is a real,
measured, zero-cost-to-fix defect independent of the CTC spike's outcome.
Candidate fix: on mixed songs, detect the anchor-starved case (near-zero
cross-pass consensus anchors under word-mode) and retry the JA pass in
segment-mode before falling back to raw per-line quality picking — recovering
Recollect's 2.50 vs. 5.03 (−50%) without regressing stranger, which already
gets a healthy anchor count in word-mode (1.32 vs. 1.76 if segment-mode were
forced instead). **Do not** ship a blanket "always force segment-JA on mixed
songs" — that regresses stranger by +33% using the sweep's own numbers above.
The conditional (anchor-starved-triggered) version is a small app change with
existing fixtures (recollect + stranger-than-heaven, both already committed)
to gate it in a follow-up PR.

## Files

- `scripts/hybrid-align-scorecard.mjs` — the scorecard script (baseline,
  `--selective`, and `--sweep` modes, including the `sel/none` monolithic
  arm added in this task)
- `scripts/lib/selectiveWindows.mjs` — pure window-construction module
- `docs/superpowers/specs/2026-08-01-hybrid-ctc-refine-design.md` — the
  pre-committed design + gate
- `/private/tmp/claude-501/-Users-ninjaruss-Documents-GitHub-utasync/20b79a2e-f489-42cd-b2a6-8ccfe7109f7f/scratchpad/hybrid-sweep.log`
  — full raw sweep output (not committed; regenerate with the `--sweep`
  command in this doc if needed)
