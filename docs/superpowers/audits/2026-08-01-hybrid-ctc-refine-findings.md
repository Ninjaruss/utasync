# Selective anchored CTC refine — spike findings

Date: 2026-08-01

Spike question: does a CTC refiner applied ONLY to untrusted lines, inside
windows pinned by trusted anchor lines from the shipped pipeline, beat the
current word-mode + mixed-consensus baseline on dense code-switched songs?
Prior art: `531e0d3` measured the BLANKET hybrid (all lines, 4-line groups) —
mixed result, not adopted. This spike targets the selective variant that
commit's conclusion flagged as the only plausible-but-unvalidated role.

This document currently covers Task 4 only: the baseline (app-path, no CTC)
scorecard. Selective-refine and sweep results land in later tasks.

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

## Files

- `scripts/hybrid-align-scorecard.mjs` — the scorecard script (baseline mode)
