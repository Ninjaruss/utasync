# Automatic lyric sync: refinement plan + blindspot audit of the prior QA

**Date:** 2026-09-28
**Status:** diagnosis complete, plan proposed — no product code changed
**Goal:** lyrics that land on the vocal by themselves, for every song the user can add.

**Evidence base:** two independent read-only audits (test/QA infrastructure; alignment
pipeline and user-input inventory), a re-run of the truth instrument, and a local
diagnostic that re-scores the same runs with the median offset **preserved**
(`.cache/audit-absolute.mjs`, gitignored scratch).

---

## 0. The problem, measured

The accuracy instrument is carefully built and has been iterated for two months. It is
blind to two things: **the systematic offset** (it removes it before scoring) and **the
audio half of the pipeline** (the fixtures are cached transcripts; there is no audio in
the repository). Re-scoring the same runs with the offset preserved:

| song / config | reported (offset removed) | **absolute** | within 250 ms | absorbed lag | worst |
|---|---|---|---|---|---|
| guitar-loneliness word | p50 0.40 / p90 1.62 | p50 0.29 / p90 1.93 | **16/36 (44%)** | **+0.31 s late** | 2.55 s |
| guitar-loneliness segment | p50 0.73 / p90 1.93 | p50 0.39 / p90 2.29 | **14/36 (39%)** | +0.36 s late | 5.83 s |
| stranger word ja-only | p50 0.64 / p90 36.10 | p50 **1.90** / p90 34.72 | **1/59 (2%)** | +1.38 s (absorbed) | 36.8 s |
| stranger segment ja-only | p50 1.44 / p90 33.79 | p50 **2.15** / p90 32.39 | **3/59 (5%)** | +1.40 s (absorbed) | 36.9 s |
| stranger segment medium | p50 0.70 / p90 9.34 | p50 **1.20** / p90 8.14 | **4/59 (7%)** | +1.20 s (absorbed) | 18.6 s |

1. **On the only version-exact song, 44% of lines land within 250 ms of human truth, and
   every line is ~0.3 s late.** A uniform 0.3 s lag *is* the "lyrics feel slightly
   behind" complaint, and it is exactly the term the instrument deletes before
   reporting. "p50 0.40 s" describes the residual after removing the largest component
   of audible error.
2. **The stranger rows understate the median error by ~3×** — the instrument's
   best-looking number is its least truthful, because the offset it absorbs (1.2–1.4 s)
   is folded into "version difference" and never asserted.
3. **No CI threshold asserts any perceptual bound.** The project's own measured product
   target — the figure that justified drag-to-retime — is *0.30 s mean with no line
   worse than 0.82 s* (`src/player/DragRetimeStrip.tsx:51`), and the CI thresholds
   allow p90 of 1.95 s, 2.35 s, 2.2 s, and **35 s**.

### The smoking gun — CORRECTED 2026-09-28 by measurement

`src/ai-pipeline/alignTimestampMode.ts:9-29` is a correction note the app ships to
itself:

> `segment: mean|err| 0.74s, p90 1.71s, 1 line >3s` … `word: mean|err| 5.61s, p90 16.90s,
> 29 lines >3s` … The word-mode failure is **a late ramp from line #31 onward (+24s
> decaying to +2s), i.e. a transcript time-domain artifact the aligner then follows.**

And yet (`:30-37`):

```ts
export function preferredWhisperTimestampMode(tier, durationSec): 'word' | 'segment' {
  void tier
  void durationSec // every transcribing tier uses word mode; params kept for API stability
  return 'word'
}
```

**This section originally claimed the shipped default is catastrophic on the committed
evidence. That was overstated, and `scripts/align-mode-choice.mjs` refuted it.** The
measured reading on the committed mix fixtures (absP90 = absolute error, offset
preserved):

| stranger-than-heaven config | verdict | absP90 | worst | no-evidence lines |
|---|---|---|---|---|
| word two-pass — the app path for this mixed sheet | 0.729 | **4.13** | 9.16 | 30 |
| segment two-pass | 0.729 | 6.50 | 12.35 | 27 |
| segment medium | 0.729 | 8.36 | 12.35 | 21 |
| word **ja-only** — not an app path | — | **34.72** | 36.80 | 34 |

The documented 5.61 s word-mode figure belongs to the **isolated stem**, and on the
committed **mix** fixtures the app's actual word path is the *best* of the three. The
catastrophic 34.72 s config is word mode *without* the EN second pass, which the app
never runs for this sheet.

**The corrected finding is stronger than the original, because it is not a bug report
about one value but a proof that no constant can be right:**

```
guitar-loneliness    verdict picks word    (0.904 vs 0.755) | truth: word    1.93 vs 2.29
recollect            verdict picks segment (0.736 vs 0.453) | truth: segment 6.04 vs 13.50
stranger-than-heaven verdict ties    (0.729)                | truth: word    4.13 vs 6.50
```

Three songs, two different winners. `preferredWhisperTimestampMode` returning a constant
is therefore wrong *in principle* — provably wrong for at least one corpus song, whichever
value it picks. And the second, decisive result: **the app's own `placementConfidence`
verdict ranks the two modes exactly the way human-synced truth does, on all three songs
(3/3).** That is what makes the choice safe to automate rather than offer as a button —
see W1.1, now implemented in `src/ai-pipeline/alignModeChoice.ts`.

Three things remain true, and are why this is still the sharpest example in the audit:

- **It was not gated.** `tests/ai-pipeline/lrc-truth.test.ts` covered stranger in
  *segment* mode only. The word config was absent from the only instrument that could
  catch it, while `corpus-baseline.json` reported the same run as healthy
  (`needs_review 8/59`, all boundary counters 0–2). Nothing compared the two.
- **The remediation was a user button.** `AutoAlignFlow.tsx` offered "Try again with
  segment timestamps", gated on `unverifiedLines >= 6` — the diagnosis was always
  computed; only the tap was missing (see S9).
- **The cause is a known, dormant, already-written alternative.** Transcription is
  hard-wired to WASM (`inferenceBackend.ts:40-42`) because onnxruntime's WebGPU backend
  cannot produce long-form Whisper timestamps, so word mode rides transformers.js's
  long-form merge (stride 5 s) — the exact path `whisperChunked.ts` was written to avoid.
  That implementation is **wired but dormant** (`whisper.worker.ts:110,132` inside a dead
  branch) and was retired for a *different* reason (a WebGPU speed gate, not a WASM
  correctness one).

### The structural gap in one sentence

**The project has excellent machinery for aligning lyrics that have no timing, and no
machinery for verifying and repairing lyrics that already have some — which is most
lyrics.** `src/player/alignmentPolicy.ts:42`:

```ts
if (linesAreTimed(lines)) return null     // synced LRCLIB / .lrc / .srt: never auto-aligned
```

A song whose lyrics returned from LRCLIB already timed is excluded from the accuracy
machinery *by policy*. The app's response is a banner — *"Lyrics not lining up? These
timings came from a lyrics database"* → **Line them up** → manual offset drag
(`PlayerView.tsx:1806-1822`) — and the type system already knows the adjustment is
likely: `core/types/index.ts:170-177` records the same measurement ("measured median
0.24–0.73 s after one constant shift"), and `src/player/alignmentPolicy.ts:29-43`
repeats it to justify doing nothing.

`applyLrcPrior` — built precisely to reconcile claimed timings against acoustic
evidence, including a real fixture where **the aligner moved lines up to +12 s away from
a correct user LRC** (`tests/lyrics/lrcPrior.recollect.test.ts`) — is unreachable on
that path, because `AutoAlignFlow` is what the policy refuses to enter.

---

## 1. Blindspot audit

### S1 — The instrument removes the systematic offset, the most audible error

`scripts/audit-vs-lrc.mjs:56-71` and `tests/ai-pipeline/lrc-truth.test.ts:46-63`
subtract `median(evidence − truth)` before scoring. The comment says the offset is
"reported" — and it is printed, but **never asserted anywhere**. Measured: 0.31, 0.36,
1.20, 1.38, 1.40 s.

*What it lets through:* any uniform lag or lead scores 0.00 s. A regression that shifted
every line 0.5 s late — the single most user-visible defect class — passes every gate.

*Second-order:* since the offset is fitted from Whisper's own evidence, the
"transcript error" column measures the *dispersion* of Whisper's error, not its
magnitude. The documented attribution rule ("end-to-end ≈ transcript error → the aligner
is faithful") therefore cannot separate "Whisper is systematically late and we inherited
it" from "we are systematically late".

### S2 — Three "ground truths" are the pipeline's own output

| fixture / test | stated provenance | reality |
|---|---|---|
| `alignment-benchmark.test.ts:15-19` | "Ground-truth sung start times (seconds), **read off the Whisper word timeline**" | Whisper's timeline. Asserted MAE < 1.0 s — a mean, so one catastrophic line hides. The mp3 it came from is no longer on disk, so nobody can re-derive it. |
| `akfg-word-ground-truth.test.ts:70-77` | "The actual sung span of each line, **read glyph-by-glyph from the word-level transcript**" | Whisper's own glyph times. |
| `corpus-baseline.json`, `line-pairing-baseline.json` | written by `audit-corpus.mjs --write-baseline`, asserted with `≤` only | The app's own past output, as the pass/fail oracle. |

`alignment-benchmark.test.ts` is the sharpest case: it cannot detect a Whisper timing
error, and it *penalises the aligner for correcting one* — which is the aligner's job.
Round 5 validated a shipped fix against `truth[37]` from this file, i.e. certified a
correction against the artifact it was correcting.

### S3 — Thresholds are set to observations, not to requirements

| instrument | asserted | permits |
|---|---|---|
| `lrc-truth.test.ts` stranger segment ja-only | p50 ≤ 1.8, p90 ≤ **35 s**, >1 s ≤ **35/59** | 59% of the song more than a second off |
| `lrc-truth.test.ts` recollect | p50 ≤ **2.2 s**, p90 ≤ 7.0, >1 s ≤ **35** | a 2.2 s median error, 68% of lines >1 s |
| `lrc-truth.test.ts` guitar segment | >1 s ≤ **16/47** | a third of the song more than a second off |
| `akfg-ground-truth.test.ts` | ±2 s (±3 s on two lines), 5 lines excluded as `shared` | a line 1.9 s late |
| `labelHonesty.corpus.test.ts` | "good" label tolerance 1.5 s (2–3 s for captions) | certifies "good" on a line ≥1.5 s off |
| `DragRetimeStrip` (product claim) | 0.30 s mean, 0.82 s worst — **after the user drags** | n/a |

No test anywhere asserts a **mean, max, or worst-line** error against external truth, and
no test asserts a **% of lines within X ms**. When a threshold is set to the current
measurement instead of to the requirement, the requirement has been abandoned — and the
plan doc that built this instrument said so itself: the thresholds are "the measured
post-fix values plus small headroom" (`lrc-truth.test.ts:14-18`).

### S4 — The audio half of the pipeline has zero regression coverage and cannot be regenerated

- **No audio is in the repository.** `find tests/ai-pipeline/fixtures -name '*.mp3' -o -name '*.wav'` → nothing. `tests/ai-pipeline/fixtures/*.wav`, `.cache/`, and `public/e2e/` are all gitignored; `.gitignore` states *"Local E2E harness assets (staged audio is copyrighted — never commit)"*.
- **The transcripts carry no provenance.** No model id, no `transformers.js` version, no `timestampMode`, no language forcing, no prompt, no `ALIGNMENT_PIPELINE_VERSION`. So "the metric didn't move" is indistinguishable from "the fixture is stale".
- **26 tests silently skip on any other machine** (3.5% of the suite): `akfg-ground-truth.test.ts:64` (6), `akfg-word-ground-truth.test.ts:31` (6), `akfg-segment-align.test.ts:12` (10), `akfg-refine-resync.test.ts:16`, `user-downloads-audit.test.ts:121,156` (hard-coded `/Users/ninjaruss/Downloads/*.mp3`), `akfg-mp3.align.integration.test.ts:17`. That is ~19 of the ~30 external-truth tests, reported as *skipped*, not failed.
- **There is no CI.** `.github/workflows/` does not exist. `package.json` has `"test": "vitest run"` and wires **no scorecard** — `audit-corpus.mjs`, `audit-vs-lrc.mjs`, the scorecards and the e2e scripts are manual, and `tsx` (which they need) is not even a dependency.

*Consequence:* model size, `timestampMode`, language detection, `promptText`, chunking,
`expandCollapsedSegment`, **vocal separation**, and the anchor/onset passes can all change
with no test failing — because no test produces a transcript. The ground-truth plan
itself named this error class first: *"if Whisper's timestamps are skewed … every
internal metric still looks fine"* (`2026-07-13-alignment-ground-truth.md:8-13`).

### S5 — Six songs, one language pair, no EN-only, and a permanently un-fixable fixture dominating the headline

`corpus.json`: 18 rows over **6 distinct songs**; `lang` is 14 × `ja`, 4 × `mixed`,
**0 × `en`**. English-only is a documented, still-open gap. **880 sheet lines, of which
the boundary metrics measure 400 (45%)**; `stranger-than-heaven-segment-autolang`
measures **0**, so all 8 of its boundary assertions are `0 ≤ 0`.

`stranger-than-heaven`'s audio is an **alternate take** whose sung words differ from the
sheet, so ~20 lines have no evidence anywhere and score 30–38 s. Those lines sit at the
p90 of a 59-line sheet, so `expect(m.p90).toBeLessThanOrEqual(35)` can never fire: **a
metric that cannot move is guarding nothing**, while its "unchanged" status is reported
each round as a result.

Untested with no fixture at all: **backing vocals / harmonies / doubled leads**,
**non-4/4 or unusual timing**, **tempo drift**, **other languages**, **EN-only songs**,
**fully instrumental tracks**, **a live recording whose lyric sheet is the studio
version** (the mismatch class is present only *accidentally*, via stranger's alternate
take, and is treated as an accepted residual rather than a detectable state), and
**rap/fast dense delivery** (recollect nominally, with caps that allow p50 2.2 s).

### S6 — The corpus oracle cannot fail on accuracy, and its coverage is not itself guarded

`corpus-scorecard.test.ts:139-171` asserts `≤ snapshot` on structural counters
(`needs_review`, `compressed`, `pileup`, `zero_dur`, …). `checkBaseline`
(`audit-corpus.mjs:394-418`) flags only *numeric increases* — and `bnd_measured` is
emitted as a **string** (`audit-corpus.mjs:245`), precisely so it is exempt. So the
number of lines the boundary metrics can measure may collapse to 0 and nothing fails,
turning 8 assertions into tautologies; it is already 0 for one row.

Also silent: `labelHonesty.corpus.test.ts:148` — `if (!expectation && goodFloor === undefined) continue` — so `recollect-mixed-segment` and `recollect-mixed-word` **have no label-honesty test at all**. And `going-my-way.json`'s lyric sheet is byte-identical to the LRC with timestamps stripped (lyrics derived *from* the truth), and it is consumed by no test; `hybrid-align-scorecard.mjs:81-85` sets `ja: null` and skips it.
`fixtures/vocal-activity/akfg-instrumental-word.json` — a 325 s `source:'stem'` envelope, the only acoustically-derived fixture in the tree — has **zero references repo-wide**.

### S7 — Labels cannot say "I don't know", so ~46% of real errors are shown as "good"

`labelHonesty.ts:19-22`: *"ground truth … measured 41 'good' lines that start >1.5 s from
the truth; the gates below catch 22 of them."* The gates are strictly downward demotions
with zero collateral — a defensible engineering choice that makes the app
**structurally unable to surface 46% of its own errors**, and turns `good` into a claim
the evidence does not support. Independent measurement agrees: good-shares of
**0.36–0.70 per song** (`stemQuality.ts:83-88`), i.e. 30–64% of lines come back
unverified on real material.

`LineAlignmentQuality` is a three-value enum with no confidence and no error estimate, so
the UI can only escalate on gate-demoted lines, and it trusts them: the drag strip, the
off-timing chips and the "N lines may be off" banner all key off these labels.
"22 of 41" is recorded as a success in the code comment, not as a 54%-recall detector
whose misses need investigating.

### S8 — Manual corrections are documented as durable and are not

`core/types/index.ts:154` says anchors "re-fit locally around these via
`refitAroundAnchors`, and they survive re-align." `refitAroundAnchors` has **exactly one
production call site** (`PlayerView.tsx:783`). `applyRefinedAlignment`
(`phraseAlignment.ts:1406-1419`) spreads `...lyrics` forward — so the array survives — but
replaces `lines` and `lineAlignmentQuality` wholesale, and nothing re-applies the
anchors.

So a user's fix is silently destroyed by (a) the next auto-align, (b) the version-gated
re-refine that runs on **every song open** (`PlayerView.tsx:506-525`), and (c) automatic
gap recovery. The app then re-offers the line the user already fixed, because
`alreadyAnchored` only excludes lines still labelled `good` and the re-refine replaces
the quality array. Separately, the Edit-mode timestamp popover writes **no anchor at
all** (`PlayerView.tsx:1239-1297`), so popover edits are invisible to the whole anchoring
machinery. There is no undo for auto-align, gap recovery, offset align, tap-through save,
or replace-lyrics.

### S9 — Diagnosis is converted into prose, not action

The app already computes exactly what is wrong and what would fix it:

| computed signal | where | what the app does with it |
|---|---|---|
| `accurateRealignReason` → `'weak-labels'` / `'segment-blocks'` | `alignTimestampMode.ts:142-161` | a dismissible banner |
| `suggestsWordLevelAlignment` | `:112-119` | prose in Edit mode |
| `unverifiedLines >= 6` | `AutoAlignFlow.tsx:113` | offers the "Try again with segment timestamps" button |
| `likelyLyricsMismatch` | `lineDegeneracy.ts:73-87` | prose ("lyrics may not match"), with **no button** — and on `manual` tier the named button does not exist |
| `countRecoverableHoles` | `gapRecovery.ts:99` | a **"Re-scan"** button; auto-recovery is one-shot per `gapRecoveryVersion` |
| `needs_review` / good-share | `labelHonesty.ts` | "N lines may be off" |

Every one of these is a zero-input automation opportunity whose safety argument already
exists in the codebase: **accept-if-better**, as implemented by `spliceGapAlignment`
(`gapRealign.ts:309-414`, `PLACED_COVERAGE_IMPROVE_MIN 0.1`, `COVERAGE_REALIZE_TOL 0.15`).
Instead the diagnoses are written as sentences the user must translate into one to three
taps.

### S10 — No test asserts a timestamp the app will display

`AutoAlignFlow.autostart.test.tsx:91-99` replaces `alignLyrics` and
`mixedLanguageAlign` with stubs returning `startTime: 0, endTime: 1` for every line, and
asserts only mode/flags/`syncState`. Same mocking in
`AutoAlignFlow.gapReanalyze.test.tsx` and `AutoAlignFlow.unload.test.tsx`. So the app
could persist "every line is 1 s long starting at 0" with the whole suite green. The real
paths are exercised only by unasserted node scripts (`e2e-align.mjs`,
`e2e-align-stem.mjs`) requiring untracked audio.

And the one perceptual check that would catch a instrument-vs-render divergence has never
been run: round 5's plan required a browser spot-check
(`2026-07-13-accuracy-audit-round5.md:230`) and the close-out records *"Browser
display-layer spot-check: NOT completed this round."* A harness that can do it exists and
is used for flow verification only (`src/dev/e2eFlowHarness.tsx`, `?flow=1`;
`src/dev/e2eAlignHarness.ts`).

### S11 — The accuracy ceiling with zero actions is far below the product's own target

- Good-shares of 0.36–0.70 per song (S7) → most songs surface at least one follow-up prompt: `unverifiedLines >= 6` (`AutoAlignFlow.tsx:113`), or `weak / scoreable >= 0.35` (`alignTimestampMode.ts:131-160`).
- Autonomy today is genuinely zero-action only on **one narrow path**: untimed lyrics + stored audio + `lite`/`full` + a song opened directly from add-song. Timed lyrics never auto-align (S1/§0); lyrics attached *after* audio never auto-align (the flag is transient, `App.tsx:65`); `manual` tier is structurally N+1 taps.
- The largest-correction channel is capped: the drag strip offers at most **4 lines** (`anchorRefit.ts:100`), and tapped songs get no strip, no chips and no gap count at all (`alignmentMode === 'auto'` gates all three: `PlayerView.tsx:729,1082,1950`). Their only repair path is the timestamp popover — 3+ actions per line.
- Two dialogs can **interrupt an already-consented, already-running** run on `full`: the no-WebGPU prompt (`AutoAlignFlow.tsx:301-318`) and the long-separation ETA prompt (`:335-347`).
- Isolation can actively hurt — measured **15.4 s stem vs 2.8 s mix** (`stemQuality.ts:80-88`) — and is only detected **after** a full transcription, costing a second full pass plus a documented ~17-minute separation on a 6:33 track. It is then remembered per song via `audioIsolationVerdict`, i.e. learned from the failure rather than predicted.

### S12 — Language gating excludes the mixed case the merge machinery was built for

`MIXED_MIN_LINES_PER_SCRIPT = 3` and a ≥3-Latin-word rule (`whisperLanguage.ts:30-44`)
mean a Japanese sheet with two English hook lines is classified as pure Japanese; those
lines get a katakana-soup transcript, fail to anchor, and fall to interpolation or a
gap hole. The merge machinery that handles exactly this already exists and is
accept-if-better (`mixedLanguageAlign.ts:124-272`); it is simply never invoked for a
minority script.

### S13 — The tuner chain patches locally what one global decision could represent

~20 post-processing tuners run in a fixed order (`phraseAlignment.ts:1946-2122`),
each fixing a local symptom: merged groups, repeated stanzas, chunk snapping, tail
extension, interjection recovery, glyph transitions, onset backfill, degenerate-run
redistribution, gap-fill capping. The worst measured errors are consequences of *local*
decisions that later tuners fight:
`A2` verse cascade (5–10 s late, rows 23–31), `A4` wrong chorus occurrence (38 s off,
label-only, not corrected — `labelHonesty.ts:196-216` reports it honestly but nothing
moves the time), `B3` boundary bias where a line's inflated estimated end steals the next
line's onset. There is no objective function over the whole song; correctness is bounded
by `enforceLineMonotonicity` and a chain of guards.

A related asymmetry: `wordAligner.ts`, `readingAlignment.ts` and `readingReconciler.ts`
sit *off* the timing path (they consume line times for pairing and ruby), yet the
alignment machinery they use — `nwAlign`, `comparableKana`, kanji↔reading matching with
JMdict validation — is stronger than what the timing aligner uses. Meanwhile
`contentAligner.ts:33-57` carries **20 literal orthography aliases**, almost all measured
on one artist's live-take mishearings (`超え→越え`, `ローリングローリー`…), with a comment
recording that generalised kanji→reading normalization *regressed* the benchmark
globally (0.429 → 0.489 s). Untested for any other song; useless for any other song.

---

## 2. Direction problems

**D1 — We measure the aligner; the largest error term is upstream.**
Both instruments score line placement given a transcript. The conversation record shows
the consequences: eight rounds of tuner work, while `timestampMode` drifted into a
documented-worse default, the audio→transcript half acquired zero coverage, and the
windowed-transcription alternative was retired for a WebGPU reason and never revisited
for the WASM path it actually protects. The next accuracy win is more likely to come from
*evidence quality* — mode selection, transcript time-domain repair, windowed
re-transcription, separation, prompts — than from another tuner. No instrument currently
exists that could tell you that.

**D2 — Effort reinforces the mechanism it should replace.**
Drag-to-retime, the tap-anchor prompt, the timestamp popover, "Re-scan", and "N lines may
be off" are all excellent *correction* tools, and they are all *user labour*. Building
them well and measuring their own precision (0.30 s / 0.82 s) creates the impression that
sync is solved, while the automatic path never engages the common case (timed lyrics) and
the largest known error (the word-mode ramp) is handed over as a button. The request is
minimal input; the codebase has been optimising the *quality of required input*.

**D3 — "Known residual" is a terminal state.**
The alternate-take block, the class-A un-anchorable lines, and the verse cascade have been
carried as carve-outs for two months, guarded by thresholds set to their current values,
with "unchanged" reported as a result. Two of them are not alignment problems at all —
they are *"the lyrics you gave me are not the words in this recording"*, which is
detectable (whole-song coverage collapse) and actionable (re-fetch a duration-matched
version; version-aware sourcing already exists). Carrying them as silent interpolation is
a choice, and it is the wrong one for a product whose stated principle is honest
capability.

**D4 — The QA entry point has no accuracy axis, and the last two rounds followed it.**
`docs/QA-REFINEMENT-PROMPT.md` (last updated **2026-06-21**) is the documented QA
procedure. Its Phase 0 baseline is lint/vitest/build; Phase 3F says only *"verify …
alignment accuracy regressions against tests/ai-pipeline/"*; the severity rubric has no
timing dimension. Accuracy work last moved the pipeline on **2026-08-01**; since then the
commits are overlay migration, display menu, PWA, storage, a11y and a 52 KB UI inventory —
real improvements on a different axis, during which the truth instruments were not run.
A generic QA pass structured by this prompt cannot skip the UI; it can skip sync accuracy
entirely, and did.

**D5 — Accuracy work is stranded, and nothing notices.**
Four accuracy branches sit 282–405 commits behind `main`:

| branch | ahead | state |
|---|---|---|
| `acoustic-vocal-activity` | 15 | content **landed** (`vocalActivity.ts`, label-honesty gate 5) |
| `acoustic-onset-snapping` | 21 | content **landed** (`leadingEdgeAnchor.ts`) |
| `feat/anchor-based-auto-fit` | 8 | **partly stranded** — `timingAnchors`/`refitAroundAnchors` landed; `detectEdgeAnchors` (transcript-based *automatic* anchors — i.e. fewer taps) did **not** |
| `feat/forced-alignment` | 8 | documented **NO-GO** (correctly not merged) |

The automatic-anchor work is directly on this plan's critical path and was planned,
written, and abandoned. There is no accuracy backlog that rounds are accountable to, so
nothing surfaces it.

---

## 3. The contract that is missing

There is no stated accuracy requirement, which is why S3 could happen. Proposal — to be
**ratified by ear** in Phase 1, not adopted on paper — with starting numbers taken from
the project's own measurements:

| id | contract | proposed | rationale |
|---|---|---|---|
| **C1** | systematic offset, per song | **≤ 100 ms** | the app already treats tap latency (250–400 ms) as unacceptable; a constant bias is the same class of error and is trivially measurable |
| **C2** | lines within ±250 ms of the audible vocal onset | **≥ 85%** | the tightest bound the app's own drag tool was built to reach; today 44% on the best song |
| **C3** | lines within ±500 ms | **≥ 97%** | a 0.5 s miss is visible while singing along |
| **C4** | worst line without an explicit "uncertain" label | **≤ 1.0 s** | anything worse must be *labelled*, never silently shipped |
| **C5** | user actions from "audio + lyric text" to C1–C4 | **0** | the request |
| **C6** | user actions when C1–C4 are unreachable | **≤ 1 prompt per song**, reason stated, app's best guess pre-filled | the only legitimate input is a confirmation, never a construction |

C1–C4 are reported as **absolute** error against externally-sourced truth, never
offset-corrected, always as a per-line table plus worst case — never percentile-only.
(The offset-removed view stays as a *diagnostic*, because it usefully separates "we
inherited a constant lag" from "our relative structure is wrong". It just may not be the
number that decides.)

---

## 4. The plan

**Thesis.** The app already computes, honestly and precisely, what is wrong with almost
every misaligned song, and then hands each diagnosis to the user as a sentence. Almost
everything below is therefore **converting an existing diagnosis into an action**, using
the accept-if-better pattern the codebase already trusts (`spliceGapAlignment`) so that no
automation can make a song worse.

### W0 — Make the measurement honest (gates every claim below)

**W0.1 — Absolute-error metrics.** Extend `scripts/lib/lrcTruth.mjs` and `truthMetrics`
to return `globalOffset` (**asserted**), `absP50`, `absP90`, `absWorst`,
`fracWithin250`, `fracWithin500`, and the signed mean. Report the offset-removed residual
alongside, but assert on absolute.

**W0.2 — Retire the self-referential truths.** Delete or re-derive the Truth array in
`alignment-benchmark.test.ts` and `TRUE_SPAN` in `akfg-word-ground-truth.test.ts`. A test
that scores the aligner against Whisper must not be called ground truth.

**W0.3 — Fixture provenance + a staleness guard.** Add `{model, transformersVersion,
timestampMode, language, promptText, tier, whisperConfigHash, alignmentPipelineVersion,
producedBy, producedAt, audioFingerprint}` to every transcript fixture, and a test that
fails when the recorded config differs from the current config. Without this, "the metric
didn't move" means "the fixture is stale".

**W0.4 — Score the config that ships.** Add the stranger **word-mode** config to
`lrc-truth.test.ts`, gated on its own (currently failing) numbers, so the documented
defect is visible in CI instead of only in a code comment. Then fix it (W1.1).

**W0.5 — A corpus that can exercise the audio half.** Two tiers, respecting the
copyright constraint that already governs `public/e2e/`:
- **Tier A (committed, CI):** short audio the project can legally ship — its own
  recordings, or public-domain/CC0 material — covering sung JA, sung EN, mixed, fast/rap,
  backing vocals or ad-libs, a long vocal-free intro, an instrumental break, a repeated
  chorus, a live/alternate take whose sheet does not match, and quiet vocals under a loud
  mix. Plus **synthetic degradations of real singing** (music bed over the vocal, reverb,
  tempo/pitch shift, level changes) to reach messy conditions without shipping more
  copyrighted audio. Real Whisper runs over Tier A give the transcription stage its first
  regression coverage.
- **Tier B (developer-run, not CI):** a manifest with URLs, durations and content hashes
  for the existing commercial corpus plus a fetch script. `npm run audit:audio`
  reproduces today's numbers; the report is committed and a config-hash guard fails when
  it is out of date.

**W0.6 — An ablation harness.** Generalise `word-vs-segment-scorecard.mjs` and
`hybrid-align-scorecard.mjs` into `scripts/align-ablation.mjs`: C1–C4 per variant —
separation on/off, word/segment/medium, prompt on/off, each tuner individually disabled.
This is what D1 requires before choosing where to invest. (Note the stale premise: that
script still argues about a >180 s segment cutoff that `alignTimestampMode.ts:33-36` no
longer has.)

**W0.7 — Kill what cannot move.** Score the alternate-take block as a separate
`unanchorableFraction` so `stranger p90` responds to changes again. Make `bnd_measured`
numeric so boundary coverage is guarded. Close the silent skips: gate the missing
fixtures loudly (`skipIf` → a coverage assertion), add the absent `recollect`
label-honesty row, and delete or wire up the two orphaned fixtures
(`fixtures/vocal-activity/akfg-instrumental-word.json`, `going-my-way`).

**W0.8 — A measurement ledger.** Every asserted threshold names the measurement that
produced it and the requirement it serves; refutations are appended, not silently
replaced. First entry to source or withdraw: the **0.24–0.73 s** LRCLIB claim
(`core/types/index.ts:170-177`, `alignmentPolicy.ts:29-43`) — repeated in two places, cited
to justify the policy that suppresses the automatic path, and recorded in no audit, plan,
or test. The project's own note applies: *"every prior round in this project that shipped
a threshold on judgement had it later refuted by measurement"*
(`2026-08-18-version-aware-sourcing.md:12`).

### W1 — Zero-input accuracy (the critical path)

**W1.1 — Fix the transcript time domain instead of asking the user to pick a mode.**
The documented failure is a *ramp*: "+24 s decaying to +2 s from line #31 onward". That is
a deterministic artifact of the long-form merge, and the app already repairs transcript
artifacts rather than routing around them (`expandCollapsedSegment`, `clipImplausibleSegmentEnd`).
Do both, in order:
1. **Detect and invert the ramp.** Fit a monotone piecewise-linear drift between the
   transcript's time domain and the lyric evidence, and correct it (reusing the robust
   affine machinery already written for priors: `fitPriorTimeMap`, `lrcPrior.ts:71-131`).
   This attacks the root cause and is measurable against the committed stranger fixture
   today — no audio required.
2. **Make mode a per-song decision under accept-if-better. — LANDED 2026-09-28** (see
   Status log). The measurement this depended on is done, and it justified the design
   rather than merely permitting it: the app's own verdict ranks the modes the way truth
   does on 3/3 corpus songs, and the winner differs by song — so a constant cannot be
   right. Implemented in `src/ai-pipeline/alignModeChoice.ts`, wired into
   `AutoAlignFlow.start()` as one automatic escalation that reuses the audio already
   decoded and separated for the run, keeping the escalated result only on a decisive
   verdict gain. `preferredWhisperTimestampMode` still returns a constant; that is now
   the *first* rung rather than the final answer, and the remaining task is to replace
   the constant with a cheap per-song prior so the expensive escalation fires less often.
3. **Re-open the windowed path on the WASM justification.** `whisperChunked.ts` was
   retired because WebGPU word timestamps were unreliable *and* the speed win was only
   1.3×. Its real value is correctness on WASM, which was never the tested question; the
   gate in `docs/superpowers/plans/2026-07-11-chunked-webgpu-whisper.md` should be
   re-run for WASM long-form merging, where the +24 s ramp lives.

*Acceptance:* the stranger word-mode truth config (W0.4) moves from p90 36.1 s toward the
segment figure with zero user interaction, and the "Try again with segment timestamps"
button stops being load-bearing.

**W1.2 — Give every song its timing repaired automatically, not just untimed songs.**
The capability the user asked for, and the one that does not exist (§0). New
`verifyStoredTiming` pass, for `timingSource ∈ {lrclib, import, unknown}`, layered cheapest
first, idempotent and version-stamped exactly like `shouldAutoRecoverGaps`:

- **Layer 1 — global offset.** Estimate the constant shift aligning claimed line starts to
  the audio's vocal-activity envelope (`vocalActivity.ts`), using the per-line onset
  search already in `leadingEdgeAnchor.ts` (`nearestOnset`, `hasPreOnsetDip`). A pure
  translation cannot damage relative structure, is one-tap undoable, and directly
  addresses C1 — which today is unmeasured and unasserted. Apply when the improvement
  clears a measured margin and is corroborated; otherwise pre-apply it as a suggestion.
  (The envelope DSP is cheap — ~128 ms/min — and works on the mix, not only a stem.)
- **Layer 2 — prior-guided selective verification.** For lines the envelope cannot
  resolve, use what already exists: `createSliceTranscriber(...).transcribe(t0, t1, lang, promptText)`
  (`sliceTranscriber.ts:57-107`), where **`promptText` is that line's known lyrics** — the
  code already documents this as "biasing Whisper toward the expected words". Verify each
  line in a padded window around its *claimed* start rather than transcribing the whole
  song: a small, local, prompted question instead of a blind global one. Window
  construction has working rules and documented dead-ends in
  `scripts/lib/selectiveWindows.mjs` (open-ended windows smear; self-anchoring is
  vacuous; never re-time anchors) — reuse them rather than rediscovering them.
- **Layer 3 — reconcile, don't overwrite.** Run alignment **from** the prior with
  `applyLrcPrior` (`lrcPrior.ts:143`), which the entry policy currently makes unreachable
  for timed songs (it also requires `alignmentMode !== 'auto'`, `lrcPrior.ts:29`). The
  value is already demonstrated: the recollect fixture is a case where the aligner moved
  lines up to **+12 s away from a correct user LRC**.

*Acceptance:* `timingSource: 'lrclib'` no longer produces "Line them up" as the primary
path. Each Tier-A song is paired with deliberately perturbed timings — constant shift,
tempo scale, and a block of wrong lines — and the pass restores C1–C4 with zero user
actions.

**W1.3 — Make the user's corrections durable.** Implement what
`core/types/index.ts:154` already claims: re-apply `refitAroundAnchors` inside
`refineAlignmentWithPhrases` and in the mixed merge, treat anchored lines as immovable in
every start-moving tuner (the `anchoredMask` mechanism already exists in
`redistributeDegenerateRuns.ts:117-119`), and clear anchors when `lines` is replaced
wholesale or indices cannot be trusted. Make the timestamp popover write anchors.
*Acceptance:* a drag → re-align → re-open sequence keeps the drag; a test asserts an
anchored line's time survives within ±0.05 s.

**W1.4 — Detect lyrics/audio mismatch and offer the right version.** When whole-song
evidence coverage collapses below a floor (the song-scope analogue of
`isEvidenceDesertLine` / `enumerateGapHoles`), report *"these lyrics do not match this
recording"* instead of fabricating 30–38 s of timing. The remedy exists — version-aware
sourcing (`versionMarker.ts`, `rankByDuration`) — so this becomes a detected state with a
one-tap fix. This is the one case where the user genuinely must choose (C6), and it turns
a two-month-old terminal residual (D3) into a handled condition.

**W1.5 — Make the expensive decisions per-song and self-correcting.**
- **Isolation:** decide by evidence, not by tier default. The measured worst case is
  15.4 s stem vs 2.8 s mix, detected only *after* a full transcription, costing a second
  full pass and ~17 minutes of separation. Probe a short window on both sources, choose
  by the label evidence, and stop needing the "Re-run with vocal isolation" tap.
- **Gap recovery:** raise `MAX_HOLES_PER_PASS`/`MAX_GAP_PASSES` adaptively, drop the
  `gapRecoveryVersion` one-shot so it runs whenever recoverable holes exist, and aim
  slices at every ≥8 s untranscribed span. Accept-if-better makes this safe by
  construction.
- **Minority script:** when a mostly-monolingual sheet has ≥1 content line in the other
  script that fails to anchor, run a forced second pass and merge with
  `mergeMixedRefinedAlignments` (S12). Trigger lazily, after the first pass.

**W1.6 — Stop interrupting an already-consented run.** The no-WebGPU and long-ETA
prompts fire mid-run on `full` (`AutoAlignFlow.tsx:301-318, 335-347`). Decide before
starting, or proceed with the fallback and say so afterwards.

**W1.7 — Revive the automatic anchors.** `detectEdgeAnchors` (D5) derives start/end
anchors from the transcript, i.e. automatic replacements for taps the user currently
makes. Rebase, measure against W0.6, and land or close with a recorded verdict.

### W2 — Per-line uncertainty that can say "I don't know"

**W2.1 — Replace gate-demotion with a calibrated estimate.** Per line, produce a predicted
error band (`±0.15 s` / `±0.5 s` / `>1 s / unverified`) from the independent signals
already available: matched-span coverage and consistency, envelope agreement at the
onset, chunk-sharing, occurrence ambiguity, and the new W1.2 verification result.
Calibrate against human truth and **ship the reliability curve as a fixture**: of the
lines the app calls "±150 ms", what fraction are actually within 250 ms? That number is
the product's honesty and should be asserted.

**W2.2 — Fix the recall problem.** No line without independent corroboration may be
`good`; the current gates catch 22 of 41 known errors (S7). Then audit the new estimator
the same way — measure and assert recall *and* precision against truth, so "which lines do
we admit are uncertain" becomes a measured decision rather than a
collateral-minimising heuristic.

**W2.3 — Escalate on predicted user-visible error, not on flags.** Prompt for manual work
only when the predicted worst line breaches C4, so a clean song asks for nothing and a
poor song asks once with the app's guess pre-filled. (Today the drag strip offers 4 lines,
and tap-timed songs get no strip at all — S11.)

### W3 — Close the diagnose → act loop

For each computed diagnosis in S9, wire the action to the button that performs it, and
where the action is cheap and safe, run it automatically under accept-if-better:
`accurateRealignReason`, `suggestsWordLevelAlignment`, `likelyLyricsMismatch`,
`countRecoverableHoles`, `unverifiedLines`, `needs_review`. Also give every song the same
repair affordances by decoupling them from `alignmentMode === 'auto'` (S11) — the largest
gap in the manual-correction inventory, with no accuracy risk. This workstream is where
"minimal input" is actually won, because the app already knows what to do.

### W4 — Make the guarantee hold

**W4.1 — Put accuracy in the QA prompt.** Add a mandatory **Phase 0.5 — Sync accuracy** to
`docs/QA-REFINEMENT-PROMPT.md`, ahead of the UI phases: run the instruments, assert
C1–C4, and refuse to start UI work while accuracy is unmeasured or regressed. Add a timing
dimension to its severity rubric (P0 = a line >1 s off, or a systematic offset >250 ms).
This is the structural fix for D4.

**W4.2 — Real-browser accuracy check.** Use the existing harness pattern
(`src/dev/e2eFlowHarness.tsx`, `?flow=1`) to play a Tier-A song and assert the highlighted
line lands within C2's bound at sampled lines — the check round 5 planned and never ran
(S10).

**W4.3 — Gate the audio half in CI.** With W0.5's Tier A, add a workflow that transcribes
committed audio end-to-end and asserts C1–C4, and wire the scorecards into npm scripts
(`tsx` is not even a dependency today). This is the only change that gives the
transcription stage, separation and `timestampMode` any regression protection at all.

**W4.4 — Make the harnesses assert.** `scripts/audit-vs-lrc.mjs`, the scorecards and the
`e2e-align*` scripts print tables and assert nothing; promote the truth instrument from
manual script to gate, and make `e2e-align-stem.mjs` — the only real-stem accuracy run —
fail rather than print.

**W4.5 — An accuracy backlog with owners.** One list for the stranded branches (D5) and
the carried carve-outs (D3). A round may not close by declaring a residual unchanged
unless that residual has an owner and a next step.

---

## 5. Sequencing

| phase | content | gate to proceed |
|---|---|---|
| **1** | W0.1–W0.4, W0.8, W0.7; ratify C1–C4 by ear | `audit-vs-lrc.mjs` reports absolute error and asserts the offset; no self-referential "truth" remains; the staleness guard fails on a deliberate config change; the shipped word-mode config is scored in CI and **fails** |
| **2** | W0.5, W0.6, plus W1.1 (ramp repair first — it is measurable against committed fixtures today) | a CI job produces a transcript from committed audio; the ablation table exists; stranger word-mode p90 moves toward segment |
| **3** | W1.2, W1.3, W1.6 | C1 met with zero user actions on every Tier-A song; a user's anchor survives re-align, re-open and gap recovery |
| **4** | W1.4, W1.5, W1.7, W3 | mismatch is named not interpolated; isolation and gap recovery choose themselves; the diagnosis→action loop is closed |
| **5** | W2.1–W2.3 | the reliability curve is committed and asserted; recall on known errors is materially above 54%; the prompt budget (C6) is measured |
| **6** | W4.1–W4.5 | C5/C6 measured on a front-to-back walkthrough; the QA prompt contains the accuracy phase; the browser check runs |

Phases 1–2 are deterministic and cannot regress product behaviour — pure measurement and
one transcript-level repair. Phase 3 is where user-visible value lands, and it depends on
Phase 1 for any claim to be trustworthy.

---

## 6. Dead ends — do not re-attempt

- **A second aligner.** CTC forced alignment was spiked, baked off, and returned a
  documented NO-GO (`feat/forced-alignment`, `docs/superpowers/audits/2026-08-01-hybrid-ctc-refine-findings.md`).
  The remaining error is evidence quality and prior reconciliation, not search.
- **Loosening thresholds or re-snapshotting baselines to pass.** Every round that did this
  replaced the requirement with the observation (S3).
- **Offset-corrected scoring as the senior gate.** Keep it as a diagnostic; never as the
  deciding number.
- **Global envelope-only offset estimation, uncorroborated.** A prior round measured and
  rejected this class (`alignmentPolicy.ts:33-35`), which is why W1.2 Layer 1 is
  corroborated by per-line onset structure and escalates when it cannot be. What is
  missing is not the idea but the measurement (W0.8).
- **Un-gated kanji→reading normalization.** It was tried and globally regressed
  (0.429 → 0.489 s). Any generalization must *add candidate anchors* and be accepted only
  on measured improvement (S13).
- **Long-form windowing ≥30 s in one Whisper call.** The dead-ends are recorded in
  `whisperChunked.ts` / `selectiveWindows.mjs`; keep slices short and iterate passes.
- **Synthetic voices as a substitute for real messy recordings.** Degradations of real
  singing are legitimate robustness coverage; TTS is not, and must never be used to claim
  absolute accuracy.

---

## 7. Decisions needed from you

1. **Ratify the contract (C1–C4).** The proposed bounds come from the app's own
   measurements, not user research. If ±250 ms / 85% is too strict, say so now — every
   acceptance criterion below derives from it.
2. **Tier A needs audio you can legally ship, or your own recordings.** This is the one
   input the plan cannot produce alone, and it is what unblocks regression coverage for
   the transcription stage (S4, W4.3).
3. **Prioritise.** W0 is ~1–2 sessions of pure measurement and makes every later claim
   verifiable; starting at W1 will produce changes that cannot be honestly validated.
   Recommended order: W0.1–W0.4 → W1.1 (ramp repair — the largest known error, measurable
   against fixtures you already have) → W1.2 → the rest.
4. **Withdraw or source the 0.24–0.73 s LRCLIB claim** (W0.8). It is cited in two places
   to justify refusing to auto-align timed lyrics — the exact behaviour this plan
   overturns — and appears in no audit or test.
5. **Confirm the alternate-take fixture's status.** It currently sits at the p90 of the
   only song with truth coverage, making that threshold unfalsifiable. Either re-source a
   version-matched recording or move it out of the headline metric (W0.7).

---

## Status log

- **2026-09-28 — Phase 1 (W0 measurement integrity) and the first half of W1.1 landed.**
  No product behaviour changed except the automatic mode escalation.

  **W0.1 — absolute-error metrics, and the offset is now asserted.** `scripts/lib/lrcTruth.mjs`
  gained `scoreAgainstTruth`, which returns BOTH frames plus the evidence partition:
  `offset` (reportable and assertable), `absP50/absP90/absWorst/absMean`, `fracWithin250/500/1000`,
  `signedMean`, and `evP50/evP90/evPWorst` for evidence-backed lines only, with
  `nNoEvidence` bounded. `scripts/audit-vs-lrc.mjs` rewritten to use it and to print both
  frames — and extended to veil and recollect, which the CI gate scored but the manual
  instrument could not reproduce. `tests/ai-pipeline/lrc-truth.test.ts` rebuilt: it now
  asserts the ABSOLUTE frame, the offset, `fracWithin250`, and the evidence partition.
  The residual frame survives only as a diagnostic, never as the deciding number.

  The offset bounds are set per song by version status: tight (0.15–0.50 s) where the
  fixture is version-exact and the offset is therefore ours, loose (1.60 s) for
  stranger-than-heaven, whose LRC is a 237 s edit of our 233.57 s audio.

  **W0.4 — the shipped mode is gated.** Nine configs now, up from six, including the two
  word-mode mixed configs that no truth test covered. The word ja-only case is gated as a
  *visible bounded defect*, not a pass.

  **W0.2 — the self-referential truths are labelled as such.** `alignment-benchmark.test.ts`
  no longer calls Whisper's timeline "ground truth" (`whisperDomainRef`, with the two
  consequences spelled out: it cannot detect a Whisper timing error, and it penalises the
  aligner for correcting one). The Whisper-derived `TRUE_SPAN` in
  `akfg-word-ground-truth.test.ts` is renamed `EVIDENCE_SPAN` and asserted as the
  invariants it actually tests. Both keep their behaviour; only the claim changed.

  **W1.1 — automatic per-song timestamp-mode selection.** New pure policy module
  `src/ai-pipeline/alignModeChoice.ts` plus `src/ai-pipeline/qualityScore.ts` (the shared
  verdict, lifted out of `mixedLanguageAlign` so the merge and the mode policy cannot
  diverge). New instrument `scripts/align-mode-choice.mjs` measures verdict vs truth per
  mode. New tests: 22 unit + 3 integration that drive the real component and prove the
  escalation happens with no user action, that a worse second pass is discarded, and that
  a healthy word run does not pay for a second transcription.

  Measured effect on the corpus: recollect word mode (verdict 0.453, 43 of 53 lines
  unverified) now escalates to segment (0.736) and keeps it — truth absP90 13.50 → 6.04.
  guitar-loneliness does not escalate, because word mode is already the better mode there.
  stranger-than-heaven escalates and keeps word on an exact verdict tie.

  **W0.3 — fixture provenance and a staleness guard.** New
  `tests/ai-pipeline/fixtures/transcript-provenance.json` registers all 19 committed
  transcript fixtures, and `tests/ai-pipeline/helpers/whisperProvenance.ts` computes a
  fingerprint of the configuration actually in force (`wasm`/`q8`,
  `Xenova/whisper-small`/`medium`, default timestamp mode, forced-second-pass policy,
  `ALIGNMENT_PIPELINE_VERSION`) by importing the real modules rather than restating them.
  `tests/ai-pipeline/fixtureProvenance.guard.test.ts` (6 tests) requires every corpus
  transcript to be registered, refuses to let the unverified set grow silently (counted
  and asserted against a recorded baseline), and fails when a fixture's recorded config
  disagrees with the live one. All 19 are declared unverified, because their origin is
  genuinely unknowable — the audio is copyrighted and untracked, so nobody can re-derive
  them. That is now a recorded fact rather than an absence. Both guard directions were
  verified to FAIL when violated (a stale config, and an added entry).

  **W0.7 — `bnd_measured` made numeric, with a proven coverage floor.** It was emitted as
  a *string* precisely so it was exempt from the numeric guards, which allowed
  `stranger-than-heaven-segment-autolang` to be committed with **0** measurable boundary
  lines and eight vacuous `0 ≤ 0` assertions. It is numeric now; `scripts/audit-corpus.mjs`
  gains a `HIGHER_IS_BETTER` guard (coverage may not drop), and
  `corpus-scorecard.test.ts` gains a coverage floor plus an explicit
  `ZERO_COVERAGE_BY_DESIGN` set naming the one row allowed to score nothing. The baseline
  re-snapshot was audited cell by cell: **only the type changed, every other metric is
  byte-identical.** Both guards were verified to fail when coverage collapses and to pass
  when restored.

  **W0.8 — measurement ledger** (`docs/superpowers/audits/2026-09-28-measurement-ledger.md`):
  nine entries with instrument, reproducibility and the requirement each serves, including
  a refutation log. It records the two UNSOURCED claims that between them justify refusing
  to auto-align timed lyrics (the "0.24–0.73 s" LRCLIB figure and the "two Whisper-free
  estimators missed by ~0.8 s" figure) — decision item 4 below is therefore still open,
  but it can no longer be cited as if measured.

  **Not yet done, in this order:** W0.5 (Tier A committed audio — blocked on choosing audio
  the project can legally ship; it is the prerequisite for re-deriving any fixture, for
  W4.3, and for turning W0.3's 19 unverified entries into verified ones), W0.6 (ablation
  harness), W1.1.1/W1.1.3 (transcript ramp repair, and re-opening the dormant windowed
  path), W1.2–W1.7, W2, W3, W4.

### Round 2 (same day) — the ratified decisions, executed

**D3 (withdraw the unsourced claims) — DONE for the citations; policy flip deferred, deliberately.**
`src/player/alignmentPolicy.ts` and `src/core/types/index.ts` no longer present the
"0.24-0.73 s" LRCLIB figure or the "two Whisper-free estimators missed by ~0.8 s" figure
as measured justification. Both are now labelled unsourced in place, with the ledger as
the reference, and the comment says plainly why the first figure would not support the
refusal even if it were reproduced. **The behaviour at `alignmentPolicy.ts:42` is
unchanged** — and that is the honest sequence, not an omission: flipping it without the
replacement screen would either run nothing new or run full auto-align (minutes of
transcription) over lyrics that may already be right. Flipping it now would be worse than
the status quo. What unblocks it is the screen below.

**W1.2 Layer 1 (the cheap acoustic screen that replaces that policy) — BUILT AND
MEASURED, not yet wired.** `src/ai-pipeline/offsetEstimate.ts` estimates one constant shift
between claimed line starts and the audio's vocal onsets, using only the vocal-activity
envelope — no Whisper, no model download. Measured on committed Tier A audio with a known
0.48 s lag planted: recovered to within **0.030-0.050 s** on all five unmasked clips, and
it correctly **refuses** on a carrier masked inside the vocal band. 10 contract tests plus
7 audio-backed assertions, and the refusals are asserted rather than commented. Ledger L10.
Wiring it into the provider is the next step, after Tier A has real singing.

**D6(a) / W1.1.1 (transcript ramp repair) — REFUTED, and therefore NOT BUILT.**
Measuring the documented "late ramp from line #31 onward (+24 s decaying to +2 s)" against
committed fixtures for the first time found **no meaningful drift anywhere**: Theil-Sen
slopes of -0.007, +0.005, -0.010, -0.008, 0.000 and +0.001 s/line, none approaching the
1 s-across-the-song threshold. The sign swing at stranger #31-#50 sits entirely on lines
whose matched-span coverage is below the evidence floor — interpolated across the
alternate-take desert, not a drifting transcript clock. Building the repair would have
been a fix with no instrument able to verify it, i.e. the exact failure the audit found.
The instrument that establishes this (`scripts/align-drift-profile.mjs`) is now committed,
and its own first version was wrong in two instructive ways (least squares let a single
−36.8 s line manufacture a −0.209 s/line drift, and a 10-point fit manufactured another);
it now uses Theil-Sen with a minimum-n floor and reports NOT FITTED where there is not
enough evidence. Ledger L11. **W1.1.1 is blocked on W0.5, not queued.**

**D2 (Tier A audio) — INFRASTRUCTURE DONE; the singing is yours.** `scripts/make-tier-a.mjs`
generates six deterministic, legally shippable clips (2.6 MB, committed under
`tests/ai-pipeline/fixtures/tier-a/`) that exercise the AUDIO-FEATURE path against ground
truth known by construction: clean onsets, onsets under a loud out-of-band bed, a long
intro with no carrier, an instrumental break, a 14 dB level change, and a carrier masked
in its own band. `tests/ai-pipeline/tierA.audio.test.ts` asserts the envelope finds the
first onset after the intro, reads the break as unvoiced, still finds onsets 14 dB down,
and that the offset estimator recovers/refuses as above. This is the first audio in the
repository, and the first coverage the audio -> feature half has ever had.

They are labelled `purpose: "dsp-plumbing"`, `claimsLyrics: false`, and the manifest's
`pendingUserRecordings` records the gap in the corpus's own words: a synthesized carrier
has no words, so **nothing here can validate lyric alignment**, and no test in that file may
be cited for it. Absolute lyric accuracy still needs real singing. Record 8-10 clips of
your own into `fixtures/tier-a/source/` with their lyrics, and `--from-source` (the same
script's documented next step) emits deterministic degraded variants for the accuracy gate.

**A flaw in my own provenance guard, found while closing this loop.** Its
config-comparison test iterated zero entries — all 19 fixtures are `unverified`, so it
could not fail. That is the same defect the audit found elsewhere, and it is now fixed the
same way: an assertion that the verified set is empty *today*, so the vacuity is recorded
and must be updated deliberately, plus a constructed-entry test that proves each of the
eight config fields can break the fingerprint on its own. No real-Whisper harness was
added: no model is available in this environment, and committing a harness that has never
been run would be worth less than the assertion that proves the mechanism works.

**W0.6 (ablation harness) moved ahead of W1.1.1**, since W1.1.1 left the queue. It is now
the highest-value unblocked item, followed by W1.2 Layer 2/3 (prior-guided verification and
prior reconciliation), then the policy flip. W0.5's remaining half — real singing, and a
transcript re-derived against committed audio so the provenance guard has something
verified to compare — is the one thing no amount of code can finish.

### Round 3 — W0.6 ablation, and the measurement that settles D3

**W0.6 (ablation harness) — DONE.** `scripts/align-ablation.mjs` reports every existing knob
against human-synced truth in the absolute frame plus the evidence partition, over three
axes: timestamp mode / pass structure, prior reconciliation, and the label-honesty pass
(which is asserted to be label-only, as designed). This is the instrument direction
problem D1 was missing: before it, no table showed what any single knob was worth.

**Two findings, both new, both recorded in the ledger.**

1. **L12 — reconciling against a prior is the largest measured win in the project.**
   Across 8 song-mode pairs from a prior perturbed by a constant offset, reconciliation beat
   aligning from scratch **8/8 at every error size**, including an already-exact prior:
   mean absP90 **5.47 → 1.44**. Recollect segment two-pass goes from p50 1.77 / 21% within
   250 ms to p50 **0.07 / 83% within 250 ms**. Nothing got worse anywhere.

   **This settles D3 with a measurement rather than a withdrawal.** The policy at
   `alignmentPolicy.ts:42` does not merely rest on an unsourced claim — it is actively
   costly. And the machinery to fix it already exists and is already wired:
   `applyLrcPrior` runs inside AutoAlignFlow for any song with outside timing. The gap is
   **discoverability, not capability**: the player's banner steers the user to a manual
   offset drag instead of the prior-aware path sitting one screen away.

   **The caveat, recorded in the ledger as the condition on this entry:** the prior built
   for the measurement has truth's *relative structure*, with only a constant offset. That
   is what a duration-matched catalogue entry should be; it is not proven to be. So the
   entry licenses "reconciliation cannot lose to scratch when the prior's shape is right" —
   not "real LRCLIB entries have the right shape". Settling that needs a handful of real
   songs with duration-matched catalogue entries, which does **not** need the user's
   singing. It is now the highest-value next measurement.

   **Why I did not auto-apply it.** Two reasons, both deliberate. Running alignment costs a
   full transcription, so applying it silently on every song open would spend minutes of
   CPU and battery on songs the user just wanted to play; and auto-applying a *shift* from
   `offsetEstimate` would mutate stored timings on evidence from synthesized carriers only
   (L10). A half-verified UI or data change late in a session with no browser available to
   verify it is worse than a documented one — the same reasoning that makes W4.2 a
   requirement rather than a nice-to-have.

2. **L13 — whisper-medium's benefit is anchoring, not timestamp precision.** On the same
   lyrics, medium removes **7 lines' worth of evidence absence** (33 → 26) and cuts the
   evidence-backed p90 by 60% (4.46 → 1.79). The dominant error term in this corpus is
   lines the transcript never reaches at all, not the precision of the ones it does — so
   the "High accuracy" option is a **coverage** upgrade, not a fineness one. That reframes
   the deferred D9 cost decision.

**Ordering change.** W1.2's layers re-rank: **Layer 3 (prior reconciliation) is the
highest-value part and its code already exists**; Layer 1 (the offset screen) is what makes
auto-application safe and is built and measured; Layer 2 (prior-guided windowed
verification) still needs audio. So the next unblocked steps are, in order: settle L12's
caveat against real catalogue entries on a few real songs, then fix the player's
discoverability so the prior-aware path is one tap, then W1.5's coverage question.

### Round 4 — the acceptance test that "auto-corrected until accurate" requires

The product intent, stated plainly: *when a song has no timed lyrics, the aligner does its
best on the pasted text and is then auto-corrected until the sync is accurate.* That needs
a runtime acceptance test, and the app did not have one — its labels catch 22 of 41 known
errors and carry no error estimate.

**Built: `src/ai-pipeline/alignmentTrust.ts`** — a three-tier per-line verdict
(`verified` / `weak` / `unverified`) from evidence-only signals, plus
`isBetterAlignment` for a repair loop to accept a round with, plus
`repairableLineIndices` (worst-evidence-first) for it to aim at. 16 contract tests.

**Calibrated: `scripts/align-trust-calibration.mjs`**, and the calibration changed the
design in two ways I would not have guessed:

1. **Text evidence alone cannot certify anything, and the failure is the audit's own S2
   blindspot inside the module written to detect misalignment.** A text-only verdict put
   145 lines in `verified` whose worst member was **12.35 s** from truth — sitting exactly
   on its own evidence, where the evidence was 12 s wrong. Adding one acoustic check (does
   vocal energy RISE across the line's start, the same statistic `offsetEstimate` uses)
   takes that tier to 11 lines with a **2.55 s** worst case and 55% within 0.5 s. So the
   acoustic signal is not a refinement here; it is what makes the verdict a verdict.
2. **No config in the corpus converges — 0/8**, including the objectively good one (veil:
   p90 0.98 s, zero lines over 2 s). I deliberately did **not** lower the threshold to make
   it fire; that is the threshold-laundering the audit found. The consequence is a design
   change: the correction loop must iterate **while the verdict improves** and report the
   residual honestly, because it cannot terminate on quality today. Convergence becomes
   reachable by raising pipeline quality, and the levers are already measured: L12, L13, the
   shipped mode escalation, and a stem-quality envelope.

**A product implication I want on the record.** The top tier's reliability is 55% within
0.5 s. That is good enough to *target repairs* and to drive internal accept-if-better
decisions, and **not** good enough to show a user as a per-line assurance. So this pass must
not be surfaced as "verified" copy in the UI until the tier is materially tighter; the
honest user-facing signal remains the off-timing banner and the drag affordance.

**Next, in order:** (1) re-calibrate the acoustic half on a STEM envelope rather than the
mix — the code itself calls the mix the weaker source and part of the current strictness is
that weakness; (2) wire the loop: assess → repair the worst lines with the existing
gap-recovery machinery under accept-if-better → reassess → stop when a round stops
improving or the budget ends, then report the residual; (3) the discoverability fix for the
prior-aware path (L12).

### Round 5 — stem envelope: two gates, not one

Re-calibrated the acoustic half on a **stem** envelope instead of the mix, on the four
configs that have one. It did not confirm my hypothesis, and the correction is the useful
part: a stem does not tighten the top tier, it **widens recall 5.5x at equal p90** (6 → 33
verified lines, p90 1.91 in both, within-0.5 s 33% → 45%). For a convergence signal that is
the better property — a loop needs lines it can verify. My first table compared 4 stem
configs against 8 mix configs, which was not a comparison; corrected before recording.

**The real find is structural: convergence is capped by two independent gates.** A line the
transcript never reached can never be verified, so counting those lines in the verified
share made convergence unreachable on any song with transcript holes — while holes are this
corpus's dominant error term. Stranger-than-heaven's coverage caps it at 59% against a 70%
requirement, before the acoustic gate is consulted at all. `verifiedShare` is now measured
over **eligible** lines, with `noEvidenceShare` reported and bounded separately, and each
config now names its binding gate: **veil is placement-limited** (17% no-evidence, 14%
verified), **stranger is limited by both** (41% no-evidence).

That makes the remaining work specific instead of vague — coverage work on the
stranger/recollect configs (L13, gap recovery), placement work on veil — and it is why the
correction loop must be improvement-driven rather than threshold-driven: `converged` is
still 0/8, but now for reasons that can each be attacked.

**Next: wire the loop.** assess → repair the worst lines via the existing gap-recovery
machinery under `isBetterAlignment` accept-if-better → reassess → stop when a round stops
improving or the budget ends → report the residual. Then the discoverability fix for the
prior-aware path (L12).

### Round 6 — the convergence loop is wired

**`AutoAlignFlow.start()`** now runs the correction loop the product intent describes:
after the existing gap pass, it assesses the alignment with the truth-free verdict
(`assessAlignmentTrust`), and while the verdict reports repairable lines it runs another
targeted repair round, **keeping the round only if the verdict says it IMPROVED** — a
strictly worse round is reverted, and a round that merely ties stops the loop rather than
spending another window. Capped at `MAX_TRUST_ROUNDS = 2` on top of the existing pass. So
"align as best it can, then auto-correct until accurate" is now behaviour rather than
intent, and the extra transcription it costs is bounded and can never leave a song worse
than it already was.

Three things the tests taught me, all of which changed the code:

1. **My comparator scored LOSING EVIDENCE as an improvement.** A round that garbled the
   lyric rows left no matched evidence — and a line with no evidence cannot *contradict* its
   evidence, so "fewer contradicted lines" read the garble as a win. Coverage now ranks
   above contradiction in `isBetterAlignment`, and the case is pinned by a test.
2. **A tie must KEEP a repair, not discard it.** `!isBetterAlignment` as the revert test
   threw away legitimate gap fills whenever the verdict had nothing to judge with; reverts
   now use the strict `isWorseAlignment`. It is the third inversion of this kind found in a
   truth-free metric, and again a test found it rather than the field.
3. **I removed a veto I had added.** I first layered the verdict over the standalone gap
   pass as well, and a spec refuted it: it discarded a legitimate gap fill (a row
   re-transcribed to text the fixture's transcript does not contain, which the verdict reads
   as lost coverage). `reanalyzeGaps` already has a per-hole accept-if-better against
   measured coverage. **One accept test per pass, owned by the pass that has the evidence
   for it** — the verdict's job is the loop's rounds.

I also deliberately did **not** swap the calibrated verdict into the user-facing "N lines
may be off" count, though it is the better figure (the labels catch 22 of 41 known errors).
That changes a visible signal and flipped a spec asserting the app stays quiet on a clean
result; it belongs in its own change with its own measurement of the alert threshold.

**Remaining:** the discoverability fix for the prior-aware path (L12), and the calibration
work that would make `converged` reachable (`verifiedShare` 0/8 today, capped by two gates
named per config in L15).

### Round 7 — the prior-aware path is now one tap (L12 shipped)

The largest measured win in the ledger was reachable and unreachable at the same time:
`applyLrcPrior` already ran inside `AutoAlignFlow` for any song carrying outside timing, and
reconciling against those timings beat aligning from scratch on 8/8 song-mode pairs (mean p90
5.47s -> 1.44s). But the player's LRCLIB banner offered **only** the manual offset drag, which
is two taps from the path it should have been leading to.

The banner now leads with **"Re-align from these"** -> `beginAlignment('auto')`, the same
prior-aware entry Edit Mode's Auto-align uses, and keeps **"Line them up"** as the fallback
for timings that are merely offset. The button is gated on `canAutoAlign() && hasStoredAudio`
so a device without AI still gets the manual nudge; a `title` states that it transcribes
once and uses the existing timings as a guide, because that cost should be visible before the
tap, not after it.

Nothing transcribes until the user asks: the path is one tap, not zero. Three specs pin it —
the automatic route leads and the manual route survives, one tap opens the flow, and the
automatic route disappears where AI alignment is unavailable. That third spec was **vacuous
when I first wrote it** (`mockReturnValueOnce` on a plain arrow function is a no-op, so it
asserted nothing that could fail); the capability mock now reads a hoisted flag, which is what
makes the unavailable case actually testable.

**A note on the full-suite run.** With vitest's default file parallelism the run reported 7
failures, all in the slowest configs (stranger-than-heaven, 4-11s each). Every one passed in
isolation, and the whole suite passes **315 files / 2583 tests** with `--no-file-parallelism`.
So those are load-sensitive specs, not regressions — the same pattern as the round-6
separation-stall failure. Worth knowing before trusting a single parallel run on this suite.

### Round 8 — Tier B: the developer-run corpus, made reproducible and legible

Decision taken: **use the existing local audio** rather than record anything. So Tier A stays
the committed, CI-runnable half (deterministic, speech-like, word-less, honestly limited), and
Tier B becomes the singing half — hashed, documented, and developer-run.

**`scripts/tier-b-audio.mjs`** generates or verifies `tests/ai-pipeline/fixtures/tier-b/manifest.json`
over the eight real files in `public/e2e/`: six songs (guitar-loneliness, veil,
stranger-than-heaven, recollect, AKFG THE FIRST TAKE, going-my-way) and two isolated vocal
stems. Every entry records the sha256, the MEASURED duration and sample rate, which failure
modes it covers, its truth fixture, and — crucially — a `truthQuality` note that says whether
that truth is version-matched. Two entries are marked **ONE-SIDED** or circular
(stranger-than-heaven's 237s edit against 233.57s audio; going-my-way's lyric sheet derived
from its own LRC), because an unmatched truth quoted as if it were ours is how a bad number
becomes a belief.

`--write` regenerates from the files; `--check` verifies. Missing files are reported loudly and
are **not** an error — absence is the expected state on a clean checkout — while a *changed*
file is fatal, because every recorded number was measured against those bytes. The stems'
decoded durations match their mixes exactly (233.535s and 218.773s), which independently
confirms the pairing.

**One entry point:** `npm run audit:audio` verifies the corpus; `npm run audit:accuracy` runs
verify plus the four accuracy instruments. That is the reproduction path the ledger's
measurements now name.

**The legibility guard** (`tests/ai-pipeline/tierB.manifest.test.ts`) is the part that matters
most, and it is deliberately shaped by the audit's S4 finding: 26 tests silently skipped on a
clean checkout, taking ~19 of ~30 external-truth assertions with them, behind a green run. So
this file asserts what holds on any machine — structure, provenance discipline, hash agreement
for files that are present — and records how much of the corpus the machine could *not* use.
Absence is reported, never failed. A green run must not be readable as "the singing claims were
checked"; on a clean clone it means they were not, and says so.

Two of my own assertions failed on first run because my manifest metadata was too thin to be
informative (a cover note of `'Japanese'`, a `truthQuality` of `'matched'`). The fix was to
write real metadata, not to loosen the assertions — which is what they are for.

### Round 9 — the medium promotion is refuted, not shipped

I offered promoting `whisper-medium` as the biggest remaining user-visible lever, on the strength
of L13 (medium removed 7 lines' worth of evidence absence and cut the evidence-backed p90 by 60%).
You said yes. I measured first, as the plan requires, and **the promotion is wrong**:

- medium + **word** on the app's two-pass path: absP90 **12.35** against small's **4.13**, and
  evP90 12.45 against 3.30. Since word is the shipped default, this is the configuration a
  promotion would have shipped.
- medium + segment: absP90 8.36 against small's 6.50 — better coverage, worse tail.
- L13's evidence came from a **ja-only segment** run, which is not the path the app takes.
  Corrected in L16 to its narrow true form.

So nothing was wired. This is the third claim of mine that measurement overturned on contact, and
it is the clearest argument for the measurement layer this whole round-series built: the proposal
was plausible, cited a real measurement, and was still wrong.

**One limitation found on the way, recorded because it is load-bearing for future reuse.** The
truth-free verdict ranks no-evidence above the error tail. That is right for the correction loop
(a repair round that loses coverage is a regression) and wrong for choosing between two
transcripts or models (a coverage gain can come with a much worse tail): it agreed with truth on
word and disagreed on segment. It must not be reused for model selection on the strength of its
3/3 record on timestamp modes.

**What the data actually supports for this song is the configuration already shipped**: small +
word + the automatic mode escalation. The coverage problem remains, and there is now no measured
model-choice lever that improves it.

### Round 10 — item 1 refuted; the plan re-orders

I made the envelope offset screen item 1, called it "the single best lever", and justified the
ranking on the grounds that it needs no Whisper and so would help devices with no AI at all.
Validated on real singing before wiring, as this plan has insisted from the start, and it does
not work: **20 of 20 planted offsets refused, 0 recovered**, because at the truth the score curve
peaks 0.00s away on guitar-loneliness and **1.04s / 0.92s** away on veil. The statistic is
unsound on real music; the gates were right to refuse.

So it is not wired, and item 1 in its original form does not exist. This is the fourth claim of
mine that measurement overturned, and by some distance the most expensive to have shipped: a
screen loosened just enough to fire would have moved users' correct timings by up to a second.

**The re-order that falls out of it:**

1. **Prior-guided prompted windowed verification (was item 2, now primary).** It serves BOTH
   cases: for an already-timed song it can detect a catalogue offset and fix it, and for an
   untimed song it is the designed answer to the dominant error term (30 of 59 lines with no
   evidence). `sliceTranscriber.transcribe(t0, t1, lang, promptText)` already exists and is
   documented to bias Whisper toward the expected words, so a small window around a predicted
   line position — told what to listen for — is a far cheaper question than a full-song pass.
   It also reaches already-timed songs, which the app currently does nothing for.
2. **Surface the calibrated verdict in the UI** (was item 3).
3. **The quality defects** (items 4-7), unchanged.

The honest note: the app's working offset estimator is `fitPriorTimeMap` against transcript
evidence (the engine of the 8/8 result), and it costs a transcription. My cheap version was an
attempt to avoid that cost and it failed, so "correct already-timed lyrics" is deliverable only
through an evidence path — which is precisely what item 1 becomes.

### Round 11 — L18's inference withdrawn; the existing backstop works

Round 10's finding was that prompting makes Whisper echo the sheet verbatim, and I concluded
from that the shipped `accept-if-better` could not catch it — going as far as editing the code
comment to say so. Before changing behaviour I reproduced it through the shipped path rather
than my own hand-rolled window, and **the inference was wrong**:

| stranger hole [39..44], 25s slice | shipped `spliceGapAlignment` verdict |
|---|---|
| **prompted** (the echo) | **rejected** — the echo returned degenerate character-level timing, so `placementRealizesCoverage` refused it |
| unprompted | accepted |

So the comment in `gapReanalyze.ts` — "a hallucinated echo is still caught by accept-if-better
below" — is accurate, and my edit has been reverted to a correct statement. **Fifth claim of my
own that measurement overturned, and the second in two rounds.** The pattern is consistent enough
to name: I keep inferring a downstream consequence from an upstream measurement instead of
measuring the consequence.

What L18 still establishes, and it matters: the echo is real at the transcription level (verbatim,
coverage 0.00 -> 1.00, including on a window Whisper itself labels non-vocal). The backstop is
therefore load-bearing against a demonstrated failure rather than a theoretical one, and must not
be weakened or replaced with anything that measures coverage of the prompt text. Why it held here
(character-level tokens rather than repeated whole lines) is not fully understood, so this is an
open risk rather than a closed one.

**Item 2 is therefore viable after all**, and cheaper than I specified: `spliceGapAlignment`'s
`placementRealizesCoverage` already rejects prompt echoes, so prompted windowed verification can
reuse the existing acceptance test. What item 2 genuinely still needs is (a) verdict-driven line
selection rather than structural hole detection, so weak lines outside a recognised hole are
verified too, and (b) reaching already-timed songs, which never run auto-align at all.

**A new defect the same run exposed, in the opposite direction:** the *unprompted* splice was
ACCEPTED while placing five of six lines on the identical start time (157.30s) with coverage
0.00-0.17 — acceptance gated on a fall in `needs_review` even though the placement is a pileup
corroborating nothing, and `enforceLineMonotonicity` permits equal starts so nothing downstream
catches it. The corpus scorecard already counts pileups as a defect, so the gap splice's
acceptance test simply does not consult the metric the project already trusts. Recorded as L19;
not fixed, because it is outside the objective's list and its severity needs its own
measurement first.

### Round 12 — the accuracy phase is in the QA prompt (item 7, docs half)

`docs/QA-REFINEMENT-PROMPT.md` had not been updated since **2026-06-21** and contained no
accuracy phase at all. That is the structural reason two months of QA rounds measured the app
and never its sync: a prompt organised by UI phases cannot skip UI, and it can skip accuracy
entirely, which it did. It now carries:

- **Phase 0.5 — Sync accuracy (MANDATORY)**, ahead of every UI phase, naming the exact commands
  (`npm run audit:audio`, `npm run audit:accuracy`, the truth gate) and the four figures that
  matter: **absolute** p50/p90/worst, the systematic offset, the within-250 ms share, and the
  evidence partition. It states plainly why the residual frame and the evidence split are not
  interchangeable.
- **Six rules** drawn from what actually went wrong here: a threshold that cannot move guards
  nothing; never score against a self-referential truth; never remove a systematic offset
  before reporting error; **measure at the layer where the claim lives** (three of the five
  refutations in the ledger are that same mistake); every new threshold names its instrument;
  and run one real-browser sync check **or say explicitly that you did not**.
- A **timing dimension in the severity rubric**: a line more than 1s off is a P0, and a line
  labelled good while more than 1.5s from the vocal is a P1.
- The quick-start one-liner updated so the documented entry point cannot omit the phase.

**The browser check is NOT done, and this is the honest record of it.** No browser is available
in this environment, so the Phase 0.5 item that requires one — play a Japanese and a
mixed-language song and confirm the highlight lands with the vocal — remains unrun, exactly as
it did in round 5. It is now a standing requirement in the prompt rather than something a round
can quietly skip, but that is not the same as it having been performed.

**Remaining from the objective:** item 2 (now viable and cheaper, needs verdict-driven line
selection plus a route to already-timed songs), item 3 (needs its alert threshold measured
first, or it is a guess), item 5 (both prompts are pre-payment decisions rather than genuine
interruptions — the no-WebGPU probe needs moving to pre-flight, and the ETA prompt needs a
non-blocking form, which means changing `onLongEstimate`'s blocking contract), item 6, and the
pileup acceptance defect found in round 11 (L19).

### Round 13 — item 6 shipped; L19 narrowed out of existence

**Item 6 (one-tap re-align when the stored verdict is weak) — done.** The Play-mode banner
said *"Some line timings are approximate — tap a line as it plays to fix it, or fine-tune in
Edit."* — i.e. it named only manual labour while the app already knew better: the banner only
appears when `accurateRealignReason` is `'segment-blocks'`, meaning the stored transcript
grouped several lines into shared chunks, which is exactly what a re-transcription fixes. And
that path also reconciles against the existing timings (8/8 better than aligning from scratch,
mean absP90 5.47s -> 1.44s) and picks its own timestamp mode. So the banner now leads with a
**one-tap Re-align** (gated on `canAutoAlign() && hasStoredAudio`, with a title stating the
one-transcription cost) and keeps the manual advice behind it. Three specs cover it, including
that the automatic route disappears where AI is unavailable while the banner still explains why
the timings are off.

Writing those specs turned up something worth remembering: the fixture must pin
`ALIGNMENT_PIPELINE_VERSION`, because the version-gated re-refine on open otherwise recomputes
lines and quality from the stored transcript and rewrites the exact state a hand-built fixture
exists to create. Correct app behaviour; it just makes naive fixtures unreachable.

**L19 is not a defect, and I narrowed it rather than fixing it.** Measuring at the layer where
the claim lives: the pass's own `badAlignment()` fixture *is* a pileup and the suite asserts a
clean splice over it, so "the candidate is a pileup" cannot be the rejection test; and
corroboration across the affected lines went 1.02 -> 0.96, i.e. unchanged within noise. Whether
the pileup is worse for a listener than the interpolated spread it replaced is unmeasured, so a
pileup guard would be an unmeasured threshold — the thing this ledger exists to prevent. Recorded
as not-a-defect with the reasoning, so it is not re-raised and not "fixed" by guess.

**Remaining:** item 2 (viable, reuses the echo backstop; needs verdict-driven line selection and
a route to already-timed songs), item 3 (needs its alert threshold measured first), item 5 (the
pre-flight refactor specified in round 12 — the `willSeparate` computation has to move out of
`start()`), and the browser half of item 7, which cannot run here.

### Round 14 — item 3's precondition measured; half of it refuted

Item 3 was to surface the calibrated verdict in the off-timing banner in place of the 54%-recall
labels. I had made that conditional on measuring the alert threshold first, and the measurement
says no:

  repairable share   85%  100%  90%  98%  100%  100%  100%  100%     <- all eight configs
  absolute p90       1.93 2.29  0.98 4.13 6.50  8.36  13.50 6.04
  truth verdict      quiet alert quiet alert alert alert alert alert

No candidate threshold separates. `repairableShare >= 0.30` alerts on **everything**, including
the two quiet songs, because the verdict marks 85-100% of lines repairable on every song; the
`noEvidenceShare` and `verifiedShare` variants each miss at least one genuinely-bad config.

**The cause is saturation, and it is a statement about the pipeline, not the metric.** The
verdict has no dynamic range at song level because the pipeline leaves most lines without full
corroboration *everywhere* — the same underlying fact as `converged` being 0/8.

So item 3 splits, and only one half survives:

- **The banner keeps its existing signals**, which the measurement shows are the discriminating
  ones, and which item 6 has just given a one-tap action. Not changed.
- **The calibrated verdict belongs on the drag strip**, where the question is "which line is
  wrong" rather than "is this song wrong" — and it separates cleanly at that layer (verified p90
  1.91s against unverified 8.74s). That is the remaining half, and it is now specified rather
  than assumed.

This is the sixth claim of mine that measurement has stopped or reshaped. The pattern from round
11 holds: the fix is always to measure at the layer where the claim lives, and here that meant
measuring the aggregate instead of reusing a per-line result.

### Round 15 — item 3's surviving half: the verdict now widens the drag strip

Last round established that the calibrated verdict cannot drive a song-level alert (L20:
saturated, 85-100% of lines repairable on every song including the good ones) but separates
cleanly at line level. So it was wired where it separates — the drag strip.

Reading `selectAnchorTargets` turned up the concrete user cost of the label recall problem, and
it is worse than "the count is low": the filter is `tier < 2`, so **lines labelled `good` were
excluded from the candidate set entirely**. A line the labels confidently call good while sitting
seconds from the vocal could never be offered for re-timing — the app never invited the user to
fix its most confident mistakes. That is the 46% miss rate showing up as an outright blind spot
rather than an under-count.

`selectAnchorTargets` gained an optional `verdictFlagged` input, supplied from the STORED
transcript in `PlayerView` (no re-transcription, no model, no audio — the transcript is already
persisted). Labelled lines still rank first, so the existing order is unchanged and an omitted
argument is byte-identical to the old behaviour; verdict-flagged lines fill the remaining slots.
Five unit specs cover it, including the byte-identical case, the new admission, the ordering
guarantee, and that the cap still holds.

**Verification gap, stated rather than glossed:** the selection logic is unit-tested and the
`PlayerView` wiring is type-checked and smoke-tested (it runs on every player spec that renders a
song with a stored transcript), but no spec drives the wiring end-to-end to observe a
label-good-but-distrusted line becoming an actual drag target. That is the next test to write
here, and it needs a fixture whose labels say `good` while its transcript corroborates nothing.

**Remaining:** item 2 (verdict-driven line selection plus a route to already-timed songs),
item 5 (the pre-flight refactor), and the browser half of item 7.

### Round 16 — the wiring is now proven, and proven to bite

Round 15 shipped the drag-strip widening with an explicit caveat: `selectAnchorTargets` was
unit-tested and the `PlayerView` wiring was only type-checked. That gap is closed.

The fixture had to make the app's real precondition explicit: every line labelled `good` (so the
old filter admitted none of them) with a stored transcript that corroborates none of them, and
the song actually *playing on line 0* — because the play-mode strip keys on the ACTIVE line via
`selectActiveAnchorTarget`, which comes from playback rather than from the target list. My first
attempt omitted that and the strip never rendered, which is the correct behaviour and not a bug.

There is a **control** beside it: with the stored transcript removed, the verdict has nothing to
say and no strip may appear. That control is what makes the assertion mean the admission came
from the verdict rather than from the labels.

**And the test was verified to bite**: temporarily passing `verdictFlagged: []` makes it fail
(the strip never appears) and restoring it makes it pass. A test for a widening that cannot fail
without the widening would have been worth nothing — the same discipline the corpus-coverage and
provenance guards went through at the start of this work.

### Round 17 — item 5, first half: the no-WebGPU prompt is gone

Both prompts that interrupted a consented run were pre-payment decisions rather than genuine
mid-run questions, but they differ in how hard they are to remove.

**The no-WebGPU prompt needed no mechanism change, so it went first.** It used to stop the flow
after "Preparing audio" and ask whether to grind separation on the CPU. It is now decided
**cold**: separation is skipped, the flow says so, and nothing blocks. Two reasons the skip is
the right default rather than merely the quiet one:

- It is **measured-safe**: on this project's own audio a Demucs stem has produced 15.4s mean
  error against 2.8s on the raw mix (ledger L6), and the app separately catches a destroyed stem
  and falls back anyway. So the mix is never the worse choice by default, while a WASM
  separation is tens of minutes.
- The user **keeps the choice** through the idle screen's "Isolate vocals first" toggle and the
  Edit-mode re-run, and the per-song verdict is remembered.

Two specs asserting the old modal (including its Escape binding) were replaced by one asserting
there is no modal at all, that separation never runs, that the mix is what gets transcribed, and
that the skip is said out loud. The stale comment claiming "both questions" were arranged that
way was corrected, and now records why the ETA prompt is the harder one.

**What remains of item 5 is the ETA prompt, and it is genuinely harder.** It fires from
`onLongEstimate`, whose contract is a **blocking promise** — separation PAUSES until the user
answers. Making it non-blocking means changing that contract in `demucsSeparator`, not just the
UI. That is the next slice, and it is a deliberate change rather than a patch.
