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

**Skips:** 1 file / 2 tests skipped. Per `--reporter=verbose`, the skips are
`tests/ai-pipeline/akfg-mp3.align.integration.test.ts` (gated by
`describe.skipIf(!process.env.RUN_AKFG_MP3 || !existsSync(WAV))`) and
`tests/sources/lrclib.live.test.ts` (gated by
`describe.skipIf(!LIVE)` where `LIVE = process.env.RUN_LRCLIB_LIVE === '1'`).
Both are opt-in, env-var-gated suites (heavy local audio run / live network
calls), not cache-presence skips; neither env var was set for this baseline
run.

## 5. Option-coverage matrix (Task 2)

Verified against the actual `tests/ai-pipeline/fixtures/corpus.json` (14 rows) and
the real option surface in `src/ai-pipeline/alignTimestampMode.ts`,
`src/ai-pipeline/capability.ts`, `src/ai-pipeline/models.ts`,
`src/ai-pipeline/inferenceBackend.ts`, and the toggles wired in
`src/ai-pipeline/AutoAlignFlow.tsx`.

### User-facing option surface (from AutoAlignFlow.tsx)

Three independent toggles a user can actually set, plus one sheet-derived axis
that isn't a toggle at all:

1. **`accurateReadings`** ("Accurate readings (slower)" checkbox) — forces
   word-level Whisper timestamps via `preferredWhisperTimestampMode`. Surfaced
   whenever the default would otherwise be segment mode (`accurateReadingsAvailable`
   in `alignTimestampMode.ts`: full tier on songs >180s, or any lite-tier song).
2. **`highAccuracy`** ("High accuracy" checkbox, full tier only) — swaps
   `Xenova/whisper-small` for `Xenova/whisper-medium` via `getWhisperModel` /
   `canUseHighAccuracy` (`models.ts`, `inferenceBackend.ts`). Gated on
   `highAccuracySupported = canUseHighAccuracy(tier)`, i.e. full tier only.
3. **`vocalSeparation`** (Demucs preprocessing toggle, full tier only, default
   from `useSettingsStore`) — an audio-domain preprocessing step, not a
   transcript/alignment-domain option.
4. **Sheet language** (`ja` / `en` / `mixed`) — not a toggle; auto-detected from
   the pasted lyric sheet by `detectSheetLanguage` (`whisperLanguage.ts`) from
   script composition. `mixed` sheets get `whisperLanguageFor` → `undefined`
   (Whisper auto-detects per 30s chunk) and route through the two-pass
   `refineMixedLanguageAlignment`.

Device tier (`lite` / `full` / `manual`, from `capability.ts`) is not itself a
user toggle — it's inferred from `navigator.gpu` / `deviceMemory` — but it gates
which of the above toggles are even shown, and shifts the *default* timestamp
mode. The corpus scorecard is tier-agnostic (`corpus-scorecard.test.ts` calls
`refineAlignmentWithPhrases` directly, never `getDeviceTier`), so tier-dependent
*default* selection is not exercised by this instrument at all — only the
resulting word/segment transcript shapes are.

### Matrix (verified against corpus.json)

| Axis | Covered by | Verified |
|---|---|---|
| word-timestamp mode (`accurateReadings`) | `akfg-firsttake-word`, `stranger-than-heaven-word`, `guitar-loneliness-word` | yes |
| segment mode (lite-tier / long-song default) | `akfg-firsttake-segment`, `stranger-than-heaven-segment`, `guitar-loneliness-segment` | yes |
| high-accuracy medium tier (`highAccuracy`) | `stranger-than-heaven-word-medium`, `stranger-than-heaven-segment-medium` | yes |
| Whisper per-chunk auto-detect robustness | `stranger-than-heaven-word-autolang`, `stranger-than-heaven-segment-autolang` | yes — see note below |
| mixed-language two-pass (`lang: "mixed"` + `transcriptEn`) | `stranger-than-heaven-mixed-word`, `stranger-than-heaven-mixed-segment` | yes |
| Japanese default (`lang: "ja"`) | `veil`, `akfg-firsttake-word/segment`, `my-eyes-only`, `guitar-loneliness-word/segment` | yes |
| English-only sheet (`lang: "en"`) | none | **gap — no corpus row has `lang: "en"`** |
| vocal separation (Demucs) toggle | none | **not coverable by this instrument — audio-domain, not transcript-domain** |
| readings truth | `fixtures/reading-truth.json` (8 song keys: veil, akfg-firsttake-word/segment, my-eyes-only, stranger-than-heaven-word/segment, guitar-loneliness-word/segment) | yes, partial — autolang/medium/mixed row variants share the base song's reading truth implicitly via `audit-corpus.mjs`, no separate keys |
| pairing truth | `fixtures/pairing-truth.json` (3 song keys only: veil, akfg-firsttake-word, guitar-loneliness-word) + per-song pairing audits `tests/ai-pipeline/my-eyes-only-pairing-audit.test.ts`, `tests/ai-pipeline/veil-pairing.integration.test.ts`, `tests/ai-pipeline/corpus-pairing.test.ts` | yes, narrower than the draft implied — pairing-truth.json does NOT include stranger-than-heaven or my-eyes-only or any `*-segment` row |

Note on "auto language detect": there is no separate user-facing "auto-detect
language" toggle. `whisperLanguageFor` always forces a language unless the sheet
is `mixed` (in which case it's `undefined` and Whisper auto-detects per chunk —
that path is exercised by the `mixed-*` rows). The `*-autolang` corpus rows are
named for a different thing: they hold transcripts as if Whisper's own per-chunk
auto-detection had been used on a nominally single-language (`ja`) song, testing
alignment robustness against the resulting language-flapping artifacts (visible
in the baseline table as `mode: proportional` instead of `content` — the
content-match path degrades and the aligner falls back to proportional
placement). This is a robustness regression test, not a coverage row for a real
menu option.

### Step 2 — missing transcript coverage check

Compared every committed transcript-shaped file under `tests/ai-pipeline/fixtures/`
against every `transcript` / `transcriptEn` path referenced in `corpus.json`:

```
find . -iname "*transcript*" -o -iname "*.words.json"   # 14 files
grep -oE '"[a-zA-Z0-9_./-]+\.json"' corpus.json          # 14 references, exact same set
```

**Result: no gap.** Every committed transcript file (`akfg/transcript.{segment,word}.json`,
`guitar-loneliness/transcript.{segment,word}.json`, `my-eyes-only.transcript.json`,
`veil/transcript.words.json`, and all 8 `stranger-than-heaven/transcript.*.json`
variants) is already referenced by a corpus.json row. **No corpus rows were added**
— there was nothing cheap left to close; `tests/ai-pipeline/fixtures/corpus.json`
was not modified.

(`akfg-user-ja.txt` at the fixtures root is not a transcript — it's a plain lyric
ground-truth file used only by the AKFG ground-truth tests, not by the corpus
scorecard.)

### Recorded gaps

1. **English-only song** — no corpus row has `lang: "en"`. Every song is `ja` or
   `mixed`; the English branch of `whisperLanguageFor` / `detectSheetLanguage`
   (`return 'en'` when only Latin script is present) is exercised by no fixture.
   Proposed follow-up: add a fully English lyric sheet + Whisper transcript pair
   as a new corpus song (not cheap — requires sourcing/transcribing new audio,
   so deferred out of this task's "cheap" scope).
2. **Vocal separation (Demucs) toggle** — not coverable by the corpus scorecard
   at all, since the instrument starts from a pre-existing transcript JSON, not
   raw audio. Demucs preprocessing happens upstream of transcription. No
   fixture-based fix is possible; would need an audio-level integration test
   instead.
3. **`pairing-truth.json` is narrower than the draft's matrix implied** — it has
   truth rows for only 3 of the 14 corpus songs (`veil`, `akfg-firsttake-word`,
   `guitar-loneliness-word`). `stranger-than-heaven` (all 8 variants) and
   `my-eyes-only` have no pairing-truth entries; `my-eyes-only`'s pairing
   coverage instead comes from the separate
   `my-eyes-only-pairing-audit.test.ts`, and no `*-segment` row has dedicated
   pairing truth at all (segment rows show `pair_unpaired`/`pair_magnet`/`pair_wrong`
   all-zero in the Task 1 scorecard table, which reflects the pairing pass simply
   not running meaningfully on segment-shaped transcripts, not verified-zero
   accuracy).
4. **Device-tier default selection is untested by the corpus scorecard** — the
   scorecard calls the alignment functions directly and never exercises
   `getDeviceTier`/`preferredWhisperTimestampMode`'s tier-based defaulting; only
   `alignTimestampMode.ts`'s own unit tests (if any) would cover that logic.
   Not investigated further here — flagged as a boundary of this instrument's
   scope, not a corpus gap.

### Guard-test result

No corpus.json changes were made, so `corpus-baseline.json` did not need
updating and Task 5's re-baseline is unaffected by this task.

```
npx vitest run tests/ai-pipeline/corpus-scorecard.test.ts --exclude "**/.claude/**"

 Test Files  1 passed (1)
      Tests  15 passed (15)
```

All 14 per-song non-regression tests plus the "baseline has a row for every
corpus song" guard pass cleanly.
