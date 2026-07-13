# Round 5 baseline snapshot (2026-07-13)

Data snapshot only — no analysis or recommendations. Captures the "before" state of
all three audit instruments prior to round-5 changes.

## 1. Corpus scorecard

Command: `npx tsx scripts/audit-corpus.mjs --pairing --check-baseline`

Exit code: `0` — no regressions vs `tests/ai-pipeline/fixtures/corpus-baseline.json`.

```
=== Corpus scorecard (lower is better) ===

song                                    lines    mode  align_needs_review  align_monotonicity  align_zero_dur  align_long_dur  align_pileup  align_compressed  unscoreable  bnd_measured  bnd_early_p1  bnd_early_p2  bnd_latestart_p1  bnd_latestart_p2  bnd_late_p1  bnd_late_p2  bnd_midword_p2  bnd_beyond_audio  bnd_gap_p50_p2  bnd_gap_p95_p2  read_kanji_tokens  read_adopt  read_mismatch  read_ruby_wrong  pair_unpaired  pair_magnet  pair_wrong
-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
veil                                    48/48  content                   7                   0               0               0             0                 0            0            31             0             0                 3                 0            1            0               0                 0           0.28s           1.04s                119           0              3                0             10            0           0
akfg-firsttake-word                     30/30  content                   0                   0               0               0             0                 0            1            22             0             0                 1                 0            0            1               0                 0           0.48s           4.36s                 87           1              0                0              9            0           6
akfg-firsttake-segment                  30/30  content                   0                   0               0               0             0                 0            1            27             0             1                 4                 0            4            0               2                 0              0s              8s                 87           1              0                0              0            0           0
my-eyes-only                            40/40  content                   2                   0               0               0             1                 1            0            34             0             0                 1                 0            0            0               0                 0            0.8s           2.66s                 42           0              1                0              0            0           0
stranger-than-heaven-word               59/59  content                   2                   0               0               0             0                20            5            22             0             1                 2                 0            0            0               2                 0              0s           0.34s                 47           0              1                0              0            0           0
stranger-than-heaven-segment            59/59  content                   3                   0               0               0             5                24            5            17             0             0                 1                 0            0            0               1                 0              0s            0.5s                 47           0              0                0              0            0           0
stranger-than-heaven-word-autolang      59/59  proportional                   7                   0               0               0             9                59            5             1             1             1                 1                 0            0            0               0                 2              0s              0s                 47           0              0                0              0            0           0
stranger-than-heaven-segment-autolang   59/59  proportional                   1                   0               0               0            10                59            5             0             1             0                 1                 0            0            0               0                 1              0s              0s                 47           0              0                0              0            0           0
stranger-than-heaven-word-medium        59/59  content                   5                   0               1               0             0                28            5            28             0             3                 2                 1            0            0               1                 0              0s           2.18s                 47           0              0                0              0            0           0
stranger-than-heaven-segment-medium     59/59  content                   0                   0               0               0             1                17            5            32             0             2                 2                 1            1            1               4                 0              0s            0.5s                 47           0              0                0              0            0           0
stranger-than-heaven-mixed-segment      59/59  content                   2                   0               1               1             2                 8            5            25             0             2                 2                 2            1            0               2                 0              0s              3s                 47           0              0                0              0            0           0
stranger-than-heaven-mixed-word         59/59  content                   2                   0               0               0             0                20            5            22             0             1                 2                 0            0            0               2                 0              0s           0.34s                 47           0              0                0              0            0           0
guitar-loneliness-word                  47/47  content                   2                   0               0               0             0                 0            0            37             0             0                 3                 0            3            0               3                 0              0s           9.81s                 96           0              1                0             19            0           7
guitar-loneliness-segment               47/47  content                   2                   0               0               0             1                 1            0            37             0             2                 3                 1            3            2               0                 0              0s           9.15s                 96           0              1                0              0            0           0

✓ No regressions vs baseline.
```

No embed-cache miss occurred; `--pairing` used the cached embeddings in
`tests/ai-pipeline/fixtures/embeddings-cache.json` without a model download.

## 2. LRC ground-truth error tables

Command: `npx tsx scripts/audit-vs-lrc.mjs`

Exit code: `0`.

```
=== guitar-loneliness: 36/47 sheet lines have LRC truth (lrc dur 229s)
guitar-loneliness word             offset=  0.31s | transcript p50= 0.29 p90= 1.42 (n=32) | align p50= 0.45 p90= 1.70 >1s=6/36 | worst: #0 3.1s, #29 2.2s, #42 1.8s
guitar-loneliness segment          offset=  0.36s | transcript p50= 0.58 p90= 2.16 (n=32) | align p50= 0.81 p90= 2.92 >1s=16/36 | worst: #20 5.5s, #46 4.6s, #0 3s

=== stranger-than-heaven: 59/59 sheet lines have LRC truth (lrc dur 237s)
stranger-than-heaven word ja-only  offset=  1.38s | transcript p50= 0.36 p90= 0.71 (n=25) | align p50= 0.85 p90=37.74 >1s=29/59 | worst: #50 40.2s, #48 39.8s, #49 39.7s
stranger-than-heaven segment ja-only offset=  1.40s | transcript p50= 0.40 p90= 3.36 (n=26) | align p50= 5.93 p90=33.79 >1s=40/59 | worst: #51 38.3s, #50 37.1s, #52 36.4s
stranger-than-heaven word mixed 2-pass offset=  1.38s | transcript p50= 0.36 p90= 0.71 (n=25) | align p50= 0.85 p90=37.74 >1s=29/59 | worst: #50 40.2s, #48 39.8s, #49 39.7s
stranger-than-heaven segment mixed 2-pass offset=  1.36s | transcript p50= 0.42 p90= 9.98 (n=32) | align p50= 0.73 p90= 7.86 >1s=25/59 | worst: #2 13.7s, #42 12.8s, #41 11s
stranger-than-heaven segment medium ja-only offset=  1.20s | transcript p50= 0.30 p90= 1.45 (n=33) | align p50= 0.70 p90=12.92 >1s=26/59 | worst: #2 19.8s, #46 15.3s, #45 15.2s
```

Only `guitar-loneliness` and `stranger-than-heaven` have LRC truth fixtures under
`tests/ai-pipeline/fixtures/lrc-truth/`; the other corpus songs are not covered by
this instrument.

## 3. CI guard tests

Command (as specified):
`npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts tests/ai-pipeline/corpus-pairing.test.ts tests/ai-pipeline/lrc-truth.test.ts tests/ai-pipeline/akfg-ground-truth.test.ts tests/ai-pipeline/akfg-word-ground-truth.test.ts`

As-specified result: `Test Files 2 failed | 7 passed (9)`, `Tests 51 passed (51)`.
The 2 "failed suites" were **not** the target files — vitest's path-glob matching
also picked up a stray nested git worktree at
`.claude/worktrees/reverent-jones-72f65b/` (a pre-existing, unrelated worktree
checked out inside the repo tree; `git worktree list` confirms it points at a
detached HEAD `c6ca544`, unrelated to `accuracy-audit-round5`). The two failures
were `akfg-ground-truth.test.ts` and `akfg-word-ground-truth.test.ts` collected
from *inside that worktree copy*, which lacks its own `.cache/auto-align-audit/`
directory, producing `ENOENT` on `AKFG_FirstTake_segment.json` /
`AKFG_FirstTake_word.json`. `Tests 51 passed (51)` confirms no actual test
assertion failed anywhere in the run — only the two worktree-copy suites errored
at module load before defining any tests.

To confirm the real (main-repo) target files, the same 5 files were re-run scoped
to the main tree only (`--exclude "**/.claude/**"`):

```
 Test Files  5 passed (5)
      Tests  34 passed (34)
```

All 5 target files pass cleanly. The AKFG ground-truth tests did **not** skip —
`.cache/auto-align-audit/` is present in the main repo
(`AKFG_FirstTake_segment.json`, `AKFG_FirstTake_word.json`, plus other cached
transcripts), so both `akfg-ground-truth.test.ts` and
`akfg-word-ground-truth.test.ts` ran their full assertion sets (verified via
`--reporter=verbose`, no `skip` markers in their output).

## 4. Full test suite

Command: `npx vitest run` (scoped with `--exclude "**/.claude/**"` to avoid
double-collecting the stray nested worktree noted above).

```
 Test Files  170 passed | 1 skipped (171)
      Tests  1199 passed | 2 skipped (1201)
   Duration  26.53s
```

Exit code: `0`. Single run, no reruns needed — no failures observed, so the flake
register is empty.

**Flake register:** none. No test failed on the first full run, so no reruns were
required and no persistent failures exist.

**Skips:** 1 file / 2 tests skipped. These correspond to the project's known
self-skipping guard tests that require locally-cached, non-committed audio
transcripts (e.g. `tests/ai-pipeline/user-downloads-audit.test.ts`, which uses
`.skip`/`skipIf` guards similar to the AKFG ground-truth suites) — consistent
with the existing pattern documented for `scripts/audit-corpus.mjs` guards. This
run did not enumerate the skipped test names individually beyond the vitest
summary counts (`1 skipped` file, `2 skipped` tests).
