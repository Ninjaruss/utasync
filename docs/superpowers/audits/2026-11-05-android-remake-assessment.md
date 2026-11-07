# Utasync — technical assessment and Android remake direction

**Date:** 2026-11-05. **Scope:** whole repository, plus the external constraints that bind an
open-source Android app. **Nothing was changed** outside this file.

This is the second assessment in three days. A 2026-11-03 audit already produced `CLAUDE.md`
and ADR-0001…0005, and those documents pre-register the decision this assessment was asked to
make. I have not re-litigated them where they hold. What follows says where they hold, where
the repository contradicts them, and what has changed since: **I found the licence-clean CTC
model that ADR-0003 says does not exist**, and I found that the experiment designed to settle
the question cannot be evaluated and will not become evaluable at its current cost.

Verification performed here: `npx tsc -b` (clean), `npm run lint` (0 errors, 5 warnings),
`npx vitest run` (4 failures — all timeouts, detail in B9), `node experiments/phase0/score.mjs`.

---

## A. Executive assessment

Utasync is a ~40,000-line React/TypeScript PWA with an unusually honest measurement culture
bolted onto an alignment pipeline that has outgrown its evidence. The practice experience is
good and close to finished. The preparation experience — the thing the product promises — is
not, and the repository already knows why, in writing, at a level of rigour most projects never
reach.

**Strengths, verified:**

- **The measurement ledger is the project's most valuable asset.** 38 entries,
  `docs/superpowers/audits/2026-09-28-measurement-ledger.md`, with explicit `UNSOURCED` and
  `CONTRADICTED` statuses, refutations appended rather than edited away, and self-corrections
  recorded under their own numbers (L30 corrects itself the same day; L25 and L28 withdraw
  earlier claims by the same author). Rule 2 — "an entry marked UNSOURCED may not be cited to
  justify refusing to change behaviour" — is the single best piece of engineering governance in
  the repo.
- **Honest code comments.** `src/player/alignmentPolicy.ts:33-57` says of its own behaviour:
  "THIS IS A TEMPORARY DEFAULT, NOT A DEFENSIBLE POLICY", then explains why its own former
  rationale was wrong. This is rare and it is worth preserving deliberately.
- **The two measured wins are real and large.** Vocal isolation took guitar's p90 from 10.73 s
  to 1.58 s on a live end-to-end run (L31). Refining against an already-timed LRC beat aligning
  from scratch on 8 of 8 pairs (L12).
- **The Android data model is right.** `android/data/.../Entities.kt` separates user anchors from
  computed timings and records alignment provenance per run. That is the correct shape and it
  should survive whatever engine wins.
- **Typecheck and lint are clean**, and the PWA's playback/practice layer (furigana, romaji,
  translation, tap lookup, A–B loop, speed) is substantially complete.

**Weaknesses, verified:**

- **The decision the whole roadmap waits on cannot be evaluated.** `score.mjs` prints: "No song
  has both blind human onsets and a Phase 0 run yet. **The gate cannot be evaluated from this
  report.**" The gate needs ≥10 songs of adjudicated blind onsets. There are 0. (B1)
- **CI no longer guards alignment accuracy at all.** Untracking the copyrighted fixtures
  (ADR-0004, correct in itself) silently excluded **35 test files** — every corpus ratchet,
  `lrc-truth.test.ts`, `labelHonesty.corpus.test.ts`, `alignment-benchmark.test.ts`. The
  accuracy ratchets now exist only on the owner's laptop. (B2)
- **Production alignment branches on two specific songs' lyrics**, at five call sites. (B3)
- **The commonest happy path is never verified.** Synced LRC + the user's own audio →
  `chooseAutoAlignment` returns `null`. Vision step 5, "if available timings are incorrect, the
  application attempts to repair them automatically", is not implemented at all. (B6)
- **Five weeks of work is untracked.** `CLAUDE.md`, all five ADRs, `android/`,
  `experiments/phase0/`, `benchmarks/sync/` — 61 files — are not in git. Last commit:
  2026-09-30. (B7)
- **The alignment pipeline is a 17-stage post-hoc corrector chain** over ~19,300 lines with
  ~167 named numeric constants, where stage order is load-bearing and documented as such. (B11)

**The one-sentence verdict:** the architecture plan (ADR-0002) is sound and I endorse it with
one revision; the blocker is not architecture, model choice, or Android — it is that nobody can
yet tell whether any of it works, and the instrument built to tell them costs more human
listening time than a solo project will ever pay.

---

## B. Verified findings

Confidence: **verified** = I reproduced it in this session. **documented** = the repository's own
instrument or docs assert it and I checked the artefact. **architectural** = a design judgement,
not a defect.

| # | Severity | Finding | Evidence | Files | Confidence |
|---|---|---|---|---|---|
| B1 | **Blocker** | The ADR-0003 gate is unevaluable. 5 songs have arm-D runs; 0 songs have blind human onsets. The one song with draft marks (`will-death-poetry`, 18 lines, `listeningPasses: 1`, `secondPassCompleted: false`) has no Phase 0 run. | `node experiments/phase0/score.mjs` → "The gate cannot be evaluated from this report." | `experiments/phase0/score.mjs`, `benchmarks/sync/annotations/*` | verified |
| B2 | **High** | CI runs no alignment-accuracy gate. 35 test files are excluded when the private fixtures are absent, which is every CI run and every fresh clone. `ci.yml`'s own comment admits it: "The CPU-bound corpus ratchets … are among them." | `tests/privateFixtures.mjs` → 35 `PRIVATE_FIXTURE_TESTS`; `vite.config.ts` test.exclude | `vite.config.ts`, `tests/privateFixtures.mjs`, `.github/workflows/ci.yml` | verified |
| B3 | **High** | Production alignment behaviour branches on two specific songs' lyric lines. `ENTWINED_ROLLING_RE = /心絡まって.*ローリング/` and `RUN_LINE_RE = /凍てつく(?:世界\|地面).*走り出した/`, used at 5 sites to skip a corrector and to widen a search window by +4 s. This is corpus overfitting compiled into the shipped app, and it is copyrighted lyric text in `src/` — a case ADR-0004 does not cover (it lists only tests, scripts and docs). | grep | `src/lyrics/phraseAlignment.ts:38-39, 217, 1075-1076, 1100, 1117` | verified |
| B4 | **High** | LRCLIB `/api/get` is called with only `track_name` and `artist_name`, although the caller holds `targetDurationSec` and passes it to *local* scoring. LRCLIB's docs: "The provided duration is crucial. LRCLIB will attempt to provide the lyrics only when the duration matches … ±2 seconds." Omitting it discards the server-side version check and keeps only a weaker local heuristic — the exact failure mode ("wrong master") the product must avoid. One-line fix. | `lrclib.ts:162` builds params without duration; [lrclib.net/docs.md] | `src/sources/lrclib.ts:156-174` | verified |
| B5 | **Medium** | No client identification and no request pacing. `fetchJson` sets no headers at all, so no `User-Agent`/`X-User-Agent`/`Lrclib-Client`. LRCLIB documents ~45 req/min for an unidentified client vs ~180 for a registered one, asks for 200–500 ms between requests and sequential sending, and requires honouring `Retry-After` ("may result in a temporary ban"). Utasync fires up to `MAX_SEARCH_QUERIES = 24` searches at concurrency 3 plus exact calls at concurrency 4, with no delay and no `Retry-After` handling. | code read + [lrclib.net/docs.md] | `src/sources/fetchJson.ts`, `src/sources/lrclib.ts:20-24, 47-64` | verified |
| B6 | **High (product)** | Already-timed lyrics are never verified or repaired. `chooseAutoAlignment` returns `null` whenever `linesAreTimed(lines)`. So on the commonest path — LRCLIB synced lyrics plus the user's audio — the app ships whatever the catalogue said. Meanwhile L12 (8/8) and L36 (arm D moves veil's LRC 0.36 s earlier, corroborated by an independent stem arbiter at +0.31 s) both say the LRC needs refining *and* that refining works. The code comment concedes the point: "that is an argument FOR verifying them, not against it." | code read + ledger L1, L2, L12, L36 | `src/player/alignmentPolicy.ts:19-62` | verified |
| B7 | **High (process)** | 61 files untracked, including every document that governs agent behaviour (`CLAUDE.md`, ADR-0001…0005), the entire Android app, the entire Phase 0 experiment and the benchmark corpus. Last commit 2026-09-30; the ADRs are dated 2026-11-03. One `git clean` or disk failure destroys the project's current direction. | `git ls-files --others --exclude-standard \| wc -l` = 61; `git log -1 --date=iso` | — | verified |
| B8 | **Medium-high** | `android/` has never been compiled and nothing will compile it. No `gradlew`, no `gradle-wrapper.jar`, and `android/README.md` names `.github/workflows/android.yml` as "the first real build" — that file does not exist. `:app`, `:data`, `:playback` were authored without an Android SDK, by the README's own admission. 916 LOC total. | `ls`; `.github/workflows/` contains only `ci.yml` | `android/README.md`, `.github/workflows/` | verified |
| B9 | **Medium** | 4 test failures on the current working tree, all `Error: Test timed out in 20000ms` in the two heaviest two-pass corpus tests (`stranger-than-heaven-segment-autolang`, `stranger-than-heaven-mixed-segment`), which each took 21.8 s and 24.1 s. These are **not** assertion failures and not an accuracy regression — the suite's own 20 s cap is below what these tests need under parallel load. Memory recorded this class of flake as "FIXED at config level"; it is not fixed for these two. | `npx vitest run` → `Test Files 2 failed \| 317 passed`, `Tests 4 failed \| 2625 passed` | `tests/ai-pipeline/corpus-scorecard.test.ts:103`, `tests/ai-pipeline/labelHonesty.corpus.test.ts:150` | verified |
| B10 | **Medium** | No library export exists. ADR-0002 assigns the PWA exactly two remaining jobs: bug fixes and "an export path (LRC + JSON library export)". `exporter.ts` offers per-song LRC and SRT only. There is no way to get a library out of the PWA and into Android, which is the migration path the ADR depends on. | grep for `exportLibrary`/JSON export → none | `src/lyrics/exporter.ts` | verified |
| B11 | **Architectural** | `refineAlignmentWithPhrases` runs 17 sequential timing correctors then 6 label-upgrade loops, and the ordering is load-bearing: "Runs AFTER all quality/label logic — shortening a line's tail widens the NEXT line's validation window … so capping earlier would churn needs_review labels." ~167 named numeric constants live in `src/ai-pipeline` + `src/lyrics`. Each stage was added to fix an observed case; none can be removed without re-running a gate that CI no longer has (B2). | code read | `src/lyrics/phraseAlignment.ts:1959-2135` | verified |
| B12 | **Medium** | `tests/` is outside every tsconfig project and holds "about 81 type errors" by `ci.yml`'s own note. The test suite — including the accuracy instruments — is unchecked code. | `ci.yml` comment; `tsconfig.app.json` scope | `.github/workflows/ci.yml:14-16` | documented |
| B13 | **Architectural** | Recording identification rests entirely on title/artist text similarity plus duration. There is no audio fingerprinting anywhere (`grep -i 'acoustid\|musicbrainz\|chromaprint\|fingerprint' src/` → no matches). The version-marker scorer's own constants are self-declared as unmeasured: "AGREE/CONFLICT are starting values chosen by judgement, NOT measurement." | grep | `src/sources/versionMarker.ts:88-98` | verified |
| B14 | **Low** | Cloze drilling (fill-in-the-blank vocabulary drilling) is shipped and reachable from the player's Display menu. It is a study feature outside both core experiences and it carries UI surface in the most crowded menu in the app. | `src/player/DisplayMenu.tsx:178-205` wires it | `src/cloze/`, `src/player/DisplayMenu.tsx` | verified |
| B15 | **Low** | `package.json` still says `"name": "utasync-temp"`, `"version": "0.0.0"`. For an app heading to F-Droid/Play, versioning is a release requirement, not cosmetics. | read | `package.json:2-4` | verified |

---

## C. Technical decisions worth reconsidering

**C1. "CTC forced alignment is a dead end." Reopen it — the blocker has dissolved.**
ADR-0003 records the CTC spike as giving "the best line medians measured here (p50 0.08–0.41 s)"
but being abandoned with bad tails, and notes the fatal practical problem: "The MMS aligner is
CC-BY-NC-4.0 and cannot ship." Both the earlier NO-GOs were on MMS, in a browser.

That licensing blocker no longer stands. `nvidia/parakeet-tdt_ctc-0.6b-ja` is a 0.6B
FastConformer-TDT-**CTC** hybrid trained on ReazonSpeech v2.0 (35k+ hours of Japanese), and its
model card states: **"License to use this model is covered by the CC-BY-4.0."** CC-BY-4.0 is
permissive, allows commercial use and redistribution with attribution, and — importantly for
distribution — is **not** an NC or ND licence, so it does not trigger F-Droid's Non-Free Assets
anti-feature (which is defined as covering "any Creative Commons license with a 'Non-Commercial'
(NC) or 'No Derivatives' (ND) restriction"). An int8 ONNX export already exists in the
sherpa-onnx model release (`sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8`, 625 MB), and
sherpa-onnx itself is Apache-2.0 with official Kotlin/Android support.

One caveat I verified rather than assumed: **sherpa-onnx does not document a forced-alignment
API.** That matters less than it sounds. CTC forced alignment is Viterbi over the model's
per-frame log-probabilities against a known token sequence — on the order of 150 lines of your
own code, not a library feature. You need the acoustic model's log-probs and its tokenizer;
sherpa-onnx gives you both. ADR-0003's decision rule says "Only C passes → find a permissively
licensed CTC model before building." That model is found.

**C2. "Already-timed lyrics are accepted as-is." Reverse it — it is the product gap.**
See B6. This is the highest-value change in the repository and it is a *removal* of a
restriction, not a new feature. The prior should become the spine of the design: never the
answer, always the starting window.

**C3. Whisper as the primary alignment method.** The prompt asked me to challenge this directly,
and the evidence challenges it harder than I would: L18 (lyric-prompted Whisper fabricates),
L32 (stored transcripts flatter the pipeline by a wide margin vs live), L3 (word timestamps mean
5.61 s / p90 16.90 s on one config), L16 (whisper-medium is not uniformly better). Full
transcription answers "what was sung" when you already know the answer, and then you spend
17 stages repairing the damage. **Transcription should be the fallback for the no-lyrics case,
not the primary path.** Keep it; demote it.

**C4. Vocal isolation as a default.** Keep it on, but stop describing it as a general accuracy
win. L35 is explicit: "isolation does NOT help the whole song: it is a TAIL fix, and on an
already-decent song it makes most lines WORSE." Measured cost ~1.4× audio length. On Android
that is a battery and thermal decision, so it should be conditional on the tail problem actually
appearing, not unconditional.

**C5. Web-era decisions that should not be carried to Android.** Device tiers from WebGPU probing
(`capability.ts`, `getDeviceTier`); the two co-existing onnxruntime-web builds served under
separate URL prefixes and their 100+ lines of Vite plumbing; kuromoji source-patching for
`require('path')` and `DecompressionStream`; Cache Storage model buckets subject to eviction;
`yieldToEventLoop` workarounds for suspended `requestIdleCallback` in hidden tabs. All of these
are browser scar tissue. None has an Android analogue. This is the strongest argument for
ADR-0002 and it holds.

**C6. AcoustID/Chromaprint fingerprinting — do not adopt yet.** It is the textbook answer to
"identify the correct recording", but: Chromaprint is LGPL (a packaging constraint, not a
blocker), AcoustID requires an application API key, and F-Droid states flatly that "F-Droid does
not sign up for any API keys. Even if provided by a third party, we include them in both binary
and source code releases." A key shipped in public source is a key that gets revoked. More
importantly, **nobody has measured that text+duration matching is the problem.** B4 says the
duration check that *does* exist is not even being sent. Fix that first and measure what is left.

---

## D. Recommended architecture

**I endorse ADR-0002 (native Android: Kotlin, Compose, Media3, Room, WorkManager, one ONNX
runtime, no backend, no accounts) with one revision and one addition.**

Why it is preferable to the credible alternatives, briefly:
- *Wrapping the PWA (TWA/Capacitor)* keeps every constraint in C5 and buys nothing — the problems
  are not UI-shell problems.
- *KMP or a Rust/C++ core* buys cross-platform reuse of an alignment engine **that has not been
  chosen**, and charges a toolchain for it immediately. Revisit if iOS is ever on the table.
- *Server-side alignment* would make the hard part easy and is the one option I would take
  seriously if privacy and F-Droid were not constraints. They are, and the user's audio leaving
  the device for a karaoke app is a bad trade.
- *Porting `src/ai-pipeline/` line by line* carries forward the weakest part of the codebase —
  17 order-coupled stages and 167 constants whose justifying measurements CI cannot run.

**The revision: do not create `:inference` as a general module yet, and keep `:align` the centre
of gravity.** ADR-0002 lists `:app`, `:playback`, `:prepare`, `:align`, `:inference`,
`:japanese`. The three that exist in skeleton (`:app`, `:playback`, `:data`) plus `:align` are
the right set for now. `:align` is already pure Kotlin/JVM and JVM-testable, and its window
planner reproduces `knownTextAlign.mjs` exactly (48/48 windows on veil, difference 0.0 s) — that
is the single best piece of engineering in the Android tree and the model for everything else.
**Every alignment decision belongs in pure-Kotlin `:align`, behind an interface, with the
inference call injected.** Then the engine choice (C vs D) is one implementation of one
interface, the gate can be run on the JVM in CI, and losing the bet costs one class.

**The addition: a `:truth` fixture module.** The thing that killed the last three months is that
accuracy cannot be checked automatically (B1, B2). Make committable truth a first-class module
with CC-licensed audio and onsets in it, so `./gradlew :align:test` is a real accuracy gate.

**Component-by-component disposition:**

| Concern | Decision | Why |
|---|---|---|
| Playback, background audio, notification controls | **Media3 `MediaSessionService` + ExoPlayer** | ADR-0002, standard, no alternative worth considering |
| Library, lines, anchors, run provenance | **Room, schema as written** | `Entities.kt` is already correct; anchors separate from computed timings is the key invariant |
| User timing fixes | **Hard constraints, never overwritten; refit between anchors** | ADR-0002; already modelled; `anchorRefit.ts` is the one PWA algorithm worth porting as-is |
| LRC parsing, sheet↔LRC matching, prior windows, line clock | **Port — already done in `:align`, 381 LOC, 16 tests** | Verified equivalent to the JS; this is reuse that paid off |
| Alignment engine | **One interface in `:align`, implementation chosen by the gate** | See E |
| Inference runtime | **One ONNX runtime. sherpa-onnx (Apache-2.0, Kotlin bindings) if CTC wins; ONNX Runtime Mobile directly if Whisper-DTW wins** | Two runtimes in one app is the mistake `vite.config.ts` is still paying for |
| Vocal isolation | **Port, but make it conditional and opt-in-ish** | C4 |
| Japanese NLP (furigana, romaji, tokens, JMdict lookup) | **Defer to Phase 3; then reimplement, do not port** | kuromoji/kuroshiro are browser-patched (C5); Android has mature alternatives and this is practice-side, not preparation-side |
| The 17-stage corrector chain | **Do not port** | B11; its justification is unrunnable |
| YouTube | **Drop, per ADR-0005** | Correct and well-argued; NonFreeNet risk plus un-alignable audio |
| Backend / accounts / analytics | **None** | ADR-0002; nothing in the product needs them |

**Where UI, logic, alignment and storage separate:** `:app` holds Compose and nothing else;
`:playback` owns the player and exposes position; `:data` owns Room; `:align` is pure functions
over `(lines, prior, audio features)` with no Android imports — which is what lets the accuracy
gate run as a JVM unit test. Playback↔lyric sync should be a cold `Flow` of player position in
`:playback` sampled by the UI against a `LineClock` from `:align`; do not let the aligner know
about the player. The PWA's import path is a JSON library export (B10) read by `:data`.

---

## E. Alignment strategy — the detailed recommendation

### E1. The principle

**The lyric text is known, and when a catalogue entry exists the approximate timing is known
too. Every stage should consume that information instead of regenerating it.** The two largest
measured wins in this repository both follow that principle (isolation gave the aligner better
audio; the LRC prior gave it better starting positions, 8/8). Almost every round that produced
nothing was tuning the *correction* of a from-scratch answer: windowed verification made things
worse and then produced "0 better, 0 worse" (L22, L23); the shipped gap pass accepted "zero
splices" across three songs (L24); the `♪` filler failed all three pre-registered criteria
(L37). That is the generalisation to carry into Android.

### E2. Discovery and recording identification

A four-step ladder, cheapest and most trustworthy first:

1. **Sidecar `.lrc`/`.srt` next to the audio file** → use as-is, mark `timingSource` as
   user-supplied, do not second-guess it. (This is already the right behaviour in the PWA, and
   it is the one case where B6's current policy is correct.)
2. **Embedded tags** (`USLT`/`SYLT`, Vorbis `LYRICS`/`UNSYNCEDLYRICS`) → text, and timing if
   `SYLT` is present. The PWA reads tags for metadata only; it does not read embedded lyrics.
   Worth adding: it is free and offline.
3. **LRCLIB**, with the request built properly: `track_name`, `artist_name`, **`album_name`**
   and **`duration`** on `/api/get` (B4). LRCLIB then enforces the ±2 s version match
   server-side, which is the single highest-leverage correctness fix in the discovery path.
   Then `/api/search` as fallback, ranked by duration, with version markers as a tiebreak.
4. **Paste / import** → always available, never blocked.

Required alongside: send `User-Agent` (Android can, unlike the browser), honour `Retry-After`,
space requests 200–500 ms, and cut `MAX_SEARCH_QUERIES` hard (B5). Consider registering an
`Lrclib-App-Id` — it is free, public-safe, and raises the ceiling to ~180 req/min, unlike an
AcoustID key (C6).

**Comparing candidates rather than taking the first:** keep `pickBestCandidate` /
`findCloserCandidate`, which are already correct in shape, but re-rank on *duration first* once
the real file length is known (it always is, for a local file — unlike the YouTube case these
functions were written for).

**Detecting a bad sheet** is currently only done implicitly, by alignment failing. Add two cheap
explicit checks before alignment: line count vs duration plausibility, and (for synced
candidates) whether the LRC's last timestamp is within a few seconds of the audio length — the
check that would have caught `stranger-than-heaven`'s "237 s LRC against 233.57 s audio" without
any model at all.

### E3. Timing generation

Two paths, and the first is the one that matters:

**Path A — a synced prior exists (the common case).** Refine, do not re-derive.
For each line, place a window from the **prior only** (never from the aligner's own previous
output — this is what makes per-line errors non-cascading, and `Windows.kt` already does it),
then find the line's start inside that window with a known-text aligner. This is arm D of
Phase 0 exactly, and it is the shape I recommend regardless of which model wins, because the
window planner is the part that is already ported, tested and verified equivalent.

**Path B — no synced prior (text only).** You need a coarse global placement before windows mean
anything. This is where transcription earns its keep: one cheap pass to get a rough
text↔time correspondence, then treat *that* as the prior and run Path A. Do not try to get the
final answer from the transcript.

**Which model inside the window — the open bet.** Two candidates, and the gate decides:

| | Arm C: CTC forced alignment | Arm D: Whisper known-text cross-attention DTW |
|---|---|---|
| Model | `nvidia/parakeet-tdt_ctc-0.6b-ja`, **CC-BY-4.0**, ReazonSpeech 35k h, int8 ONNX 625 MB | `whisper-small` q8, MIT |
| Runtime | sherpa-onnx, Apache-2.0, Kotlin bindings | ONNX Runtime Mobile |
| Evidence for | best line medians ever measured here, p50 0.08–0.41 s (ADR-0003) | measured anchored to the audio: planted ±0.8 s recovered within 250 ms on 96–100% of lines on guitar/veil (L36) |
| Evidence against | bad tails on the MMS spike; never tried with a skip token or prior bounds | **cost: 4–5.5 s per line on 2 CPU cores, >2 GB peak memory** (L36, confirmed by `score.mjs`) |
| Alignment code | ~150 lines of Viterbi you write (sherpa-onnx documents no alignment API — verified) | exists, in JS, in `knownTextAlign.mjs` |

The cost line is why I would not simply crown arm D. **5 s/line × 50 lines ≈ 4 minutes of
compute and >2 GB peak for one song** — on a phone that is a preparation experience nobody
enjoys and a memory profile that will be killed. CTC forced alignment is one forward pass over
the audio plus a cheap Viterbi: it is *structurally* an order of magnitude cheaper, which is
exactly the property Android needs. Arm C is now both licence-clean and the cheaper design.
That is a material change to ADR-0003's situation and it deserves the one spike it was never
given.

### E4. Validation — use only the flags with measured recall

The repository has spent rounds on confidence estimation and has exactly two validators with a
measured true-positive and false-positive rate. Use those; distrust the rest.

1. **`pinned`** — the line's start landed within 0.1 s of its window edge, meaning it followed
   the prior rather than the audio. Caught 8 of 10 planted failures and flagged 0 of 136 stable
   lines (L37). Free. Already implemented in `knownTextAlign.mjs` and expressible in `:align`.
2. **Prior independence** — nudge the prior ±0.8 s and re-run; if the answer moves, the line is
   not anchored to the audio. 96–100% recovery on guitar/veil, 81% on going-my-way (L36). Costs
   a second pass, so run it on the flagged subset only.

Both are **truth-free**, which is the property that matters: they work on the user's own song, on
the device, with no annotations. That is a genuinely good result and it should be the basis of
what the app tells the user. `labelHonesty.ts` and `alignmentTrust.ts` (583 LOC combined) should
be *replaced* by these two, not ported — their gates are the ones CI can no longer check.

**What the user sees:** two states, not five. "Synced" and "needs a look, here are the N lines".
A flagged line falls back to its prior (L38's rule, which is correct by construction: a pinned
start equals the window edge, an artifact of where the window was cut, so the prior is never
worse).

### E5. Recovery

1. **User anchors are hard constraints.** Already modelled (`AnchorEntity`). Tap-to-anchor
   during playback is the cheapest possible correction UI and the PWA has already proven it
   (`anchorRefit.ts`, `detectEdgeAnchors`).
2. **Refit between anchors**, monotonic, never crossing one.
3. **Global offset** as a single control for the whole-song-shifted case — cheap, obvious to the
   user, and it handles the version-edit case (`stranger`) better than any aligner will.
4. **Re-prepare with a better engine later**, comparing against the stored `AlignmentRunEntity`
   and keeping anchors. This is why the run-provenance table is in the schema and it is the right
   call.

### E6. What I would delete

`gapRecovery.ts` + `gapReanalyze.ts` (569 LOC): L24 measured the shipped pass as accepting
**zero** splices across three songs, "barely moving anything at all". `sliceTranscriber` /
windowed verification: L23, "0 better, 0 worse". `whisperPrompt.ts` lyric-prompt biasing: L18,
it fabricates. The two song-specific regexes (B3). That is ~800 lines removable *on the
repository's own measurements*, with no gate needed to justify it — the gate already ran.

---

## F. Feature assessment

| Feature | Verdict | Why |
|---|---|---|
| Local audio import, library, offline storage | **Preserve** | Core, works, ADR-0005 |
| Background playback + notification controls | **Improve (Android: new)** | The PWA cannot do it properly; Media3 can. A karaoke app that stops when you lock the screen is broken |
| Synced lyric display, line highlight | **Preserve** | The practice experience is the good half |
| Furigana, romaji, translation | **Preserve** | Directly serves the learning promise |
| Line navigation, repeat, A–B loop, speed | **Preserve (core)** / **Defer (A–B loop *playlists*)** | Repeat and speed are the vision; saved multi-segment loop playlists + their export (~660 LOC in `abLoopExport.ts`, `abLoopPlaylist.ts`, `abLoopPlaylistStore.ts`) are a power-user layer |
| Tap-to-look-up dictionary popover | **Preserve, defer to Phase 3** | Well-executed, genuinely serves "interact with vocabulary without interrupting listening". Not preparation; it can wait |
| LRCLIB discovery | **Improve** | B4, B5 — send duration and album, identify the client, pace the requests |
| Embedded-lyrics reading (`USLT`/`SYLT`) | **Add** | Free, offline, and the only source that is guaranteed version-exact |
| **Repair of existing timings** | **Add — the single most important gap** | B6. Vision step 5 does not exist |
| Auto-alignment from scratch | **Redesign** | E3 Path B: demote to the fallback for the no-lyrics case |
| The 17-stage corrector chain | **Remove** | B11, E6 |
| Gap re-transcription, windowed verification, lyric-prompt biasing | **Remove** | Measured inert or harmful (L18, L23, L24) |
| Confidence labels / `alignmentTrust` / `labelHonesty` | **Replace** | With `pinned` + prior-independence (E4), the only two with measured recall |
| Vocal isolation | **Preserve, make conditional** | C4 — a tail fix, not a general win, at 1.4× audio length |
| Tap-sync editor, drag-to-retime, timestamp popover | **Redesign down to one** | Three correction UIs for one job. Tap-to-anchor during playback is the one that pays for itself |
| Edit mode (911 LOC) | **Redesign** | Should be anchors + a global offset, not a timing spreadsheet |
| YouTube playback + captions, lyrics.ovh | **Remove on Android** | ADR-0005, well-argued |
| Cloze drilling | **Remove** | B14. Outside both core experiences, and it occupies the busiest menu |
| Landing page, PWA install, service worker, model cache management | **Remove on Android** | Platform provides all of it |
| Device tiers from WebGPU probing | **Remove** | C5 |
| Library JSON export | **Add to the PWA** | B10 — ADR-0002 depends on it and it does not exist |

---

## G. Android and F-Droid feasibility

**Practical requirements, verified against current F-Droid documentation:**

- **FLOSS only.** "All applications in the repository must be Free, Libre and Open Source
  Software." The app is MIT. Fine.
- **Build from source with a 100% FLOSS toolchain.** "The complete application building process
  requires a 100% FLOSS toolchain including Debian-packaged tools"; proprietary build tools
  "strictly forbidden, including Oracle's JDK". AGP + Gradle + OpenJDK is fine. Dependencies must
  come from source or a trusted Maven repo — Google Maven is explicitly listed, so Compose,
  Media3 and Room are fine.
- **No API keys.** "F-Droid does not sign up for any API keys." This is what rules out AcoustID
  (C6) and makes LRCLIB's optional, public `Lrclib-App-Id` the acceptable form of identification.
- **Model licensing.** CC-BY-4.0 (Parakeet-ja) and MIT (Whisper) both avoid the **Non-Free
  Assets** anti-feature, which is defined as applying to assets "under a license that restricts
  commercial usage or making derivative works (for example, any Creative Commons license with a
  'Non-Commercial' (NC) or 'No Derivatives' (ND) restriction)". **This is precisely why MMS
  (CC-BY-NC-4.0) cannot ship and Parakeet can.** Check the ReazonSpeech corpus terms before
  relying on this — the model card does not restate them, and I did not verify them.
- **Downloading models after install.** **Unsettled, and I will not pretend otherwise.** The
  Inclusion Policy rule is about executables: "Applications must not download additional
  executable binary files … without explicit user consent", with consent defined as opt-in and
  "it must not be harder to decline than to accept". ONNX weights are data, not executables, and
  there is **no anti-feature for runtime data downloads** — the list is Ads, Disabled Algorithm,
  Known Vulnerability, Non-Free Addons, Non-Free Assets, Non-Free Dependencies, Non-Free Network
  Services, No Source Since, Tethered Network Services, Tracking. Community discussion treats
  model downloads as an open question. **Recommendation:** download the model on first use behind
  an explicit opt-in that meets the executable-consent bar anyway (the PWA's
  `modelDownloadConsented` already has the right shape), keep it off the critical path, and ask
  the F-Droid team on the forum *before* submission rather than after. A 625 MB APK is not an
  option, so this must be resolved.
- **NonFreeNet.** Applies to apps that "promote or depend entirely on a proprietary network
  service". ADR-0005's reasoning is right: YouTube would earn it. LRCLIB is a free service, but
  note that **LRCLIB's docs state no licence or terms for the data** — I checked, and it is not
  there. Since the app works fully offline with pasted or sidecar lyrics, LRCLIB is not a
  dependency the app depends on *entirely*, which is the test. Keep it that way: never let the
  app be useless without network.
- **Reproducibility.** F-Droid verifies by rebuilding and matching binaries to source. Keep the
  build boring: no build-time downloads (the PWA's `prebuild` model download is exactly what to
  avoid), pinned dependency versions, no code generation from network sources.

**Outstanding decisions:** (1) the model-download question above; (2) whether to ship a
`:japanese` dictionary (JMdict is CC-BY-SA 4.0 — fine, but ~30 MB each, so same download
question); (3) `INTERNET` permission — currently absent from the manifest, which is a nice
default to defend.

**Distribution recommendation:** **GitHub Releases first, F-Droid second, Play later or never.**
Releases give you a signed APK and real users this month with no policy review. F-Droid is the
right long-term home for this app and its audience, and the work to qualify (above) is modest —
but do not let it gate the first release. Play adds a developer fee, a data-safety declaration,
and target-API treadmill pressure for an app that needs none of Play's distribution reach to find
its audience. Donations: a `FUNDING.yml` / Liberapay link in the README is the whole of what is
warranted. No in-app purchases, no accounts — they would require exactly the backend ADR-0002
correctly refuses.

---

## H. Prioritized roadmap

Phases are ordered so that **every experiment that could invalidate the next phase runs before
it.** Acceptance criteria are falsifiable.

### Phase 0a — make the truth affordable (1–2 days, mostly the owner's ears)

The blocker (B1) is not technical. Fix the instrument, not the engine.

- **0a.1 Restructure the gate to a stratified sample.** The current design needs ≥10 songs ×
  ~50 lines × 2 listening passes ≈ 1,000+ marks, adjudicated, from one person. That is why there
  are 0. Replace with **10 stratified lines per song**: line 1, a chorus repeat, a re-entry after
  an instrumental, two lines the flags distrust, and five uniformly sampled. 10 songs × 10 lines
  = 100 marks. Statistically weaker per song, 10× cheaper, and spread across the 10 songs the
  gate actually requires. Record the change as an ADR superseding ADR-0003's gate wording — a
  pre-registered gate may be changed, but only in writing and before the scoring.
- **0a.2 Unblock PJS.** `experiments/phase0/pjs/buildCorpus.mjs` is written and verified on a
  synthetic fixture; it is blocked only because Google Drive is unreachable from an agent
  session. The owner can download PJS v1.1 in two minutes. It is CC BY-SA 4.0, so **its onsets
  and audio can be committed**, which is what finally gives CI a real accuracy gate (B2).
- **Acceptance:** `node experiments/phase0/score.mjs` prints a section 1 table with numbers in
  it for ≥5 songs. That single line of output is the gate on this whole phase.

### Phase 0b — the engine bake-off (2–3 days)

- **0b.1 Score arms B and D** on the marks from 0a against the 5 songs that already have runs.
- **0b.2 Spike arm C properly** — the one it never got: `parakeet-tdt_ctc-0.6b-ja` via
  sherpa-onnx, Viterbi forced alignment over the CTC log-probs, windowed around the prior, with
  a blank/skip allowance for instrumental frames. Pre-register the gate before the first run
  (CLAUDE.md rule 3). Time-box: one day. Measure **latency and peak memory** alongside accuracy —
  arm D's 5 s/line and >2 GB are disqualifying on a phone, and that must be in the comparison.
- **Acceptance:** one arm meets ADR-0003's contract (≥85% of starts within 250 ms, no unflagged
  line over 1 s, beats the LRC as-is on p90) **and** runs a 50-line song in under 60 s inside
  1 GB. Write the ADR that replaces ADR-0003 either way, including "neither passed".

### Phase 1 — the Android shell actually builds (3–5 days)

- Generate the Gradle wrapper, add `.github/workflows/android.yml`, make `:app`, `:data`,
  `:playback` compile for the first time (B8).
- **Acceptance (from ADR-0002, unchanged — it is a good criterion):** highlight within 30 ms of
  `player.currentPosition` across a full song, as an instrumented test; background playback with
  notification controls; no `INTERNET` permission.

### Phase 2 — preparation on Android, prior-first (2–3 weeks)

- LRCLIB with duration + album + client identification + pacing (B4, B5); embedded `USLT`/`SYLT`;
  sidecar `.lrc`; paste.
- The winning engine behind one `:align` interface, Path A only (refine an existing prior).
- `pinned` + prior-independence flags; two user-facing states.
- Tap-to-anchor + global offset. Anchors as hard constraints.
- PWA library JSON export (B10) and the Android importer.
- **Acceptance:** on the 10-song benchmark, ≥80% of songs prepared with no manual correction at
  the gate's tolerance; every song that fails has its bad lines flagged (zero unflagged failures
  over 1 s); preparation under 90 s per song on a mid-range device; the `:align` gate runs in CI.

### Phase 3 — practice and polish (2–3 weeks)

Furigana/romaji/translation, tap lookup, repeat and speed, Path B (no-lyrics transcription
fallback), conditional vocal isolation. Then F-Droid submission.

**Explicitly deferred:** cloze drilling, A–B loop playlists, multi-language immersion
dictionaries, anything YouTube.

---

## I. Risk register

| Risk | Severity × likelihood | Why it is live | Mitigation |
|---|---|---|---|
| **The gate stays unevaluable and the project stalls again** | High × **High** | It has already happened: ADRs dated 2026-11-03 pre-register a gate that `score.mjs` says cannot be run, and the annotation cost is the reason | Phase 0a. This is the whole point of putting it first |
| **Untracked work is lost** | Catastrophic × Low-Medium | 61 files, including every governing document and the entire Android app, exist on one disk (B7) | `git add` today. Branch and push |
| **Both arms fail the gate** | High × Medium | It is a real possibility, and ADR-0003 already names the consequence: "simplify the existing pipeline rather than rewrite it" | Phase 0b writes the ADR either way. The fallback is honest and cheap: ship Path A with the LRC prior and manual anchors, and let the user's ear be the aligner |
| **On-device cost makes preparation unusable** | High × Medium | Measured: arm D 4–5.5 s/line, >2 GB peak, killed in a 3 GB VM (L36); isolation ~1.4× audio length | Make latency and memory gate criteria in 0b, not afterthoughts. This is the main argument for arm C |
| **F-Droid rejects the model download** | Medium × Medium | Genuinely unsettled in F-Droid's own docs (G) | Ask on the forum before building the download flow. Fallback: GitHub Releases only, which is the recommended first channel anyway |
| **Accuracy regressions ship unnoticed** | High × **High** | Already true: 35 accuracy tests do not run in CI (B2), and 4 of the ones that do run fail on timeouts (B9) | Committable CC-licensed fixtures (0a.2) + the `:align` JVM gate |
| **LRCLIB rate-limits or bans the client** | Medium × Medium | No identification, no pacing, no `Retry-After`, up to ~28 requests per lookup against a documented ~45/min (B5) | Phase 2. Cheap and entirely within the project's control |
| **Overfitting recurs** | Medium × High | It is the project's documented pattern — "every prior round that shipped a threshold on judgement had it later refuted by measurement" — and two song-specific regexes are in production right now (B3) | Workflow change 3 below |
| **Solo-maintainer bandwidth** | High × High | 796 commits in 3.5 months, then 5 weeks with none committed | Prefer removal over addition. E6 removes ~800 lines on measurements that already exist |
| **Copyright exposure** | Medium × Medium | ADR-0004 is "partially implemented": git history still contains the lyric files, and inline excerpts remain in tests, scripts and now `src/` (B3) | Fix `src/` (B3) now; treat the history rewrite as the owner's call, as the ADR says |

---

## J. Recommended next actions

**1. `git add` everything, today.** Five weeks of work — `CLAUDE.md`, all five ADRs, the Android
app, the Phase 0 experiment, the benchmark corpus — is untracked on one disk (B7). The documents
that govern every future agent session are among them. This is thirty seconds of work standing
between the project and losing its direction. Keep the lyric fixtures out, which `.gitignore`
already handles.

**2. Download PJS and mark 100 onsets.** This is the only thing standing between the project and
a decision (B1). The PJS builder is already written and verified; the stratified 10-lines-per-song
scheme (0a.1) brings the human cost down from ~1,000 marks to ~100. Until `score.mjs` prints a
section 1 with numbers in it, every further line of alignment code is a guess — and the
repository's own history says guesses here get refuted.

**3. Spike arm C with the licence-clean CTC model.** `nvidia/parakeet-tdt_ctc-0.6b-ja` is
CC-BY-4.0 and sherpa-onnx is Apache-2.0 with Kotlin bindings, which removes the exact blocker
ADR-0003 recorded ("The MMS aligner is CC-BY-NC-4.0 and cannot ship"). CTC gave the best line
medians ever measured in this project and it is structurally an order of magnitude cheaper than
arm D's 5 s/line. One day, gate pre-registered, measuring latency and memory as well as accuracy.

---

## Development-process audit, and three workflow changes

### Where effort produced measurable product improvement

- **Vocal isolation** — guitar p90 10.73 s → 1.58 s, live, end to end (L31). The largest single
  accuracy win in the project's history.
- **The measurement ledger itself**, and specifically the discovery that stored transcript
  fixtures flatter the pipeline (L32: fixture p90 2.29 s vs live 10.73 s). That one finding
  invalidated an entire class of earlier result and is why later rounds are trustworthy.
- **The stem forced-truth arbiter** (L30) — the first instrument able to attribute error between
  the app and the catalogue LRC, including catching its own non-independence the same day.
- **Using the LRC as a prior** (L12, 8/8) and the Phase 0 window planner, which is now ported to
  Kotlin and verified equivalent (48/48 windows, 0.0 s difference).
- **Cross-pass consensus selection** — mean 3.38 s → 2.89 s on Recollect, fixing a whole-section
  8 s drift.
- **The `pinned` flag** (L37) — 8/10 planted failures caught, 0/136 false alarms, at zero cost.

### Where repeated iteration produced little or nothing

- **Windowed verification: two full rounds, net zero.** L22 measured it making real sync *worse*
  (a 13.16 s catastrophe); L23 fixed the harm and then measured "0 better, 0 worse — every
  accepted verification left the metrics untouched", at a cost of 8 Whisper calls per song.
- **Gap re-transcription: shipped, always-on, inert.** L24, three songs: "the local gate accepted
  **zero** splices … it is barely moving anything at all." Two rounds of plans (rounds 8 and 9)
  built it.
- **Lyric-prompt biasing** — L18: it fabricates, and the acceptance test could not tell.
- **Forced alignment, twice declared dead** — once in the MMS Phase-1 bake-off, once as
  "selective anchored CTC refine NO-GO" — with the single most important reason for the second
  verdict being the model's licence, which I have now found a clean alternative to. Two NO-GOs
  that closed a thread that should have stayed open.
- **The 17-stage corrector chain and ~167 constants.** Roughly 20 rounds of accuracy work across
  June–September, and the repository's honest summary of its own position is the aligner
  test-bias finding: the self-snapshot scorecard and offset-normalized two-song gate were biased,
  and an honest probe showed 40 of 59 lines more than 1 s off.

**The pattern, stated plainly:** every effort that gave the aligner *better information* paid
off. Almost every effort that *corrected the aligner's output better* did not. Every win listed
above is in the first category; every dead end listed above except the forced-alignment NO-GOs is
in the second. That is the most useful thing this history has to say, and it is the argument for
E1.

### Three workflow changes

**Change 1 — make the accuracy gate affordable, and put it in CI.**
*Evidence:* the gate has been unevaluable since it was written (B1); 35 accuracy test files do
not run in CI (B2); the project's own audit found its tests biased toward its previous output.
*Implementation:* (a) stratify the annotation scheme to 10 lines per song (0a.1); (b) commit
CC-licensed audio + onsets via the PJS builder that already exists (0a.2); (c) move the gate into
pure-JVM `:align` tests so `./gradlew :align:test` is the gate. *Why it reduces error and time:*
it converts the project's one real bottleneck from "several hours of the owner's concentrated
listening, repeated per change" into "a CI job", which is the difference between a gate that runs
and a gate that is written down.

**Change 2 — commit the governing documents, and make the repository able to notice when they
are missing.**
*Evidence:* `CLAUDE.md` and all five ADRs are untracked (B7); the measurement ledger's own Rule 2
exists only on one laptop; `android/README.md` cites a CI workflow that does not exist (B8).
*Implementation:* commit them; add one CI step that fails if `CLAUDE.md` or `docs/adr/0001-*.md`
is absent, and one that fails if a `README` references a `.github/workflows/*.yml` that does not
exist. *Why:* the governance that makes this project's agent sessions productive is currently
one `git clean` from gone, and documentation that cites non-existent infrastructure is how an
agent spends an afternoon looking for a build that was never wired.

**Change 3 — forbid song-specific carve-outs mechanically.**
*Evidence:* `ENTWINED_ROLLING_RE` and `RUN_LINE_RE` branch production alignment on two specific
songs' lyrics at five call sites (B3); the ledger's own history is that judgement-set thresholds
get refuted; CLAUDE.md rule 2 already requires a ledger line per gating constant but nothing
enforces it. *Implementation:* one test that fails on any CJK string literal in `src/` outside an
allowlist of script-class ranges and linguistic particles, and extend it to fail on a new
`const UPPER_SNAKE = <number>` in `src/ai-pipeline` or `src/lyrics` that has no ledger reference
in a comment. *Why:* these two rules make the repository's two existing standards —
no-overfitting and no-unmeasured-thresholds — self-enforcing, which is the only form of standard
that survives a solo maintainer's busy week. I am deliberately not proposing a fourth process:
CLAUDE.md, the ADRs and the ledger are already the right set, and they need enforcement, not
company.

---

## Recommended direction, the open question, and the smallest experiment

**Direction.** Build the native Android app as ADR-0002 describes, with the alignment engine
living behind one interface in pure-Kotlin `:align`, and with the **catalogue LRC as the spine of
the design: always the prior, never the answer.** Refining an existing prior inside per-line
windows placed from the prior alone is the shape to build, because it is the only shape this
project has measured a win from twice, and because it degrades gracefully — a line the refiner
cannot anchor falls back to a timing that was already roughly right. Reopen CTC forced alignment
as the engine inside that window: it is now licence-clean (`parakeet-tdt_ctc-0.6b-ja`, CC-BY-4.0,
on Apache-2.0 sherpa-onnx), it produced the best line medians ever measured here, and it is
structurally far cheaper than arm D's 5 s per line. Delete the gap pass, the windowed
verification, the prompt biasing and the song-specific regexes — ~800 lines that this
repository's own measurements have already condemned.

**The most important unresolved technical question.** Not which model, and not Android.

> **Does refining an existing catalogue LRC actually move line starts closer to the singing,
> measured against human ears?**

Everything downstream — which arm, which runtime, how much the app may promise the user — is
decided by that one number, and it has never been measured. L12 says refinement beats from-scratch
alignment; L36 says arm D moves veil's LRC 0.36 s earlier and an independent arbiter agrees on
sign and size; but no instrument in this repository has yet compared *the LRC as-is* against *the
refined LRC* at a human-marked onset. Both prior results could hold while the answer to this
question is "the refinement is noise".

**The smallest practical experiment.** No new code, no new model, about half an hour of
listening.

Five songs (`guitar-loneliness`, `veil`, `going-my-way`, `recollect`, `stranger-than-heaven`)
already have completed arm-D runs in `.cache/phase0/runs/` and version-matched catalogue LRCs.
Mark **blind human onsets for 10 stratified lines per song — 50 marks total** — using the
existing `npm run benchmark:sync -- review <song>` tool, which already hides predictions. Then
run `node experiments/phase0/score.mjs` and read one row: arm B (LRC as-is) versus arm D
(refined), absolute error against those 50 marks.

- **D beats B** → the architecture above is validated, Phase 0b's bake-off is worth running, and
  Android development can start on a decided foundation.
- **D does not beat B** → stop. Ship the LRC as-is with tap-to-anchor correction, which is a
  smaller and more honest product, and do not spend weeks on an inference engine that adds
  nothing.

That is a 50-mark experiment standing between this project and the first well-founded decision it
will have made about its own core promise. Nothing else should be built first.
