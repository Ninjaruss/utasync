# Approx-run pileup diagnosis (2026-07-14)

User spot-check (post-round-5) surfaced two live-app symptoms:
1. Runs of `approx` lines squashed into a few seconds (AKFG rows piled at
   3:48–3:51; stranger rows at 3:29–3:32), some rendering zero duration
   ("3:32–3:32", "4:15–4:15").
2. Suspected "false positives": confident-looking (no-chip) lines adjacent to
   the bad runs, while the banner claims only "2 lines off-timing".

Method: 4-agent investigation workflow (2 song replays, quality-label bias
sweep, packing mechanics), 36 evidence-backed claims; the load-bearing ones
verified by cross-finder convergence plus direct code inspection
(redistributeDegenerateRuns.ts:139–166, phraseAlignment.ts:1504–1515,
EditMode.tsx:327–330/385–390, mixedLanguageAlign.ts:100–129,
ALIGNMENT_PIPELINE_VERSION). Scratchpad repro scripts are cited in the
workflow journal (session `cfdadf63`, run `wf_2e99f383-adc`).

## Headline findings

### H1. The screenshots are pre-round-5 output — and round-5 fixes cannot reach stored songs

- The stranger screenshot's shape (209/209 pileup, 212–212 zero-dur, correct
  212–217/217–224 anchors, banner=2) is byte-reproducible from the
  **pre-round-5 word-mode path** (CLASS-T1 EN-pass no-op → JA-only merge).
  Current round-5 code anchors those rows via the segment EN pass to within
  0.7s of LRC truth — no pileup, in either mode.
- **`ALIGNMENT_PIPELINE_VERSION` is still 19** (set in round 4). Round 5
  changed alignment behavior without bumping it, so
  `shouldRefineStoredAlignment()` returns false and PlayerView never
  re-refines songs aligned by the round-4 app.
- Worse, the re-refine path replays the **stored merged transcript**. For a
  pre-round-5 mixed word-mode song that stored transcript is effectively the
  JA-only word transcript (the broken merge picked JA everywhere), so even a
  version bump replays the broken tail. Mixed songs need a fresh Auto-align
  (re-transcription), not a re-refine.
- AKFG: the on-disk transcripts (all byte-identical FirstTake copies —
  "UserRockRoll_*" are misnamed) align the block cleanly on both round-4 and
  round-5 code. The screenshot therefore came from a **divergent in-app
  Whisper run** (evidence desert + garble in 190–260s). A synthetic
  desert+garble word transcript reproduces the exact screenshot shape
  (6 lines at 228.0–229.0s, 0.1–1.2s each, all `approx`). Re-running
  Auto-align will likely fix that song outright; CI has **no garbled/desert
  fixture class** — every corpus transcript is healthy, which is why the
  scorecard never saw this.

### H2. The pileup generator: `redistributeDegenerateRuns` packs with no floor

`redistributeRun` places each line at `expectedDuration × scale`,
`scale = min(1.5, activityCapacity / totalExpected)`, cursor-packed from each
activity region's left edge (redistributeDegenerateRuns.ts:139–166):
- No per-line minimum: when activity capacity is small (evidence desert with
  one hallucinated blip), every line gets an arbitrarily small sliver —
  `minLineDuration` is only used for degeneracy *detection*, never enforced
  during packing. Reproduced: 22-line run scaled ×0.365 → 0.44s "Stranger
  than heaven" slivers (min floor 2.52s).
- Last-region clamp emits `start == end` rows once the cursor exhausts the
  final region — the literal zero-duration lines.
- "Activity" is Whisper-word presence (`findActivityRegions`, 4s gap split),
  never acoustic VAD: hallucinated chunks create false activity that attracts
  entire runs; a 0.4s misheard blip after an instrumental captures the run
  tail. whisper-medium's hallucinated tail chunk at 245.8–247.0s (beyond the
  233s audio!) attracts stranger's last two lines on current code.

### H3. Zero-duration rows survive three separate ways

1. Cursor exhaustion above (stored, not a render artifact — Play view and
   Edit list read the same stored times).
2. `expandSquashedLineHighlights` guarantees its 1.2s floor only when
   `nextStart − start ≥ 1.2`; inside a pileup room ≈ sliver width so it skips
   exactly the lines it exists to fix. Bonus float bug: a zero-span *last*
   row computes room `1.1999999999999886 < 1.2` and is skipped.
3. Mixed songs: `mergeMixedRefinedAlignments` stitches AFTER each pass's
   expansion and re-clamps `end = min(end, next.start)`
   (mixedLanguageAlign.ts:123–129) with no second expansion — on current code
   both modes ship stranger row 45 as `183.5–183.5`, quality `good`.

### H4. The `approx` chip and the banner are dishonest around bad runs

- Blanket upgrade (phraseAlignment.ts:1885–1888): any redistributed line
  overlapping ANY transcript word is upgraded `needs_review → approximate`.
  A 0.02s sliver overlapping a noise blip reads "approx"; the off-activity
  remainder stays `needs_review`. Result: piles wear approx chips.
- The "N lines off-timing" banner counts **needs_review only**
  (EditMode.tsx:327–330). Measured: stranger app-default config shows
  banner=2 while 17 truth-matched lines are >2s off; segment ja-only banner=3
  vs 36 lines >2s off. `needs_review` lines are often better-timed than
  `approximate` ones.
- `approximate` is systematically EARLY in degenerate configs (median signed
  error −7.9s to −14.7s on stranger ja-only) because packing hugs region
  left edges — matching the user's "approx parts are always a bit off".

### H5. The false-positive (no-chip wrong) mechanism is real

- `recomputeLineQuality` certifies lexical presence in a ±6s-lead/8s-tail
  window around the FINAL placement — not onset accuracy. Lines up to ~10s
  off (or 0-duration row 45) score `good`; chorus repeats match the wrong
  occurrence and read `good` at −38s (stranger word row 51).
- The initial displacement is injected by `projectPhraseTimingToLines` and
  compounded by `validateAndRetryLineTimings` on lines pass-1 had placed on
  their evidence (stranger segment rows 24–28: +6.9→+9.95s), then frozen by
  the backfill clamps:
  - `prevFloor = prev.start + 0.3` pins a good line behind a zero-width
    neighbor (guitar row 29);
  - the straddle guard `continue`s instead of falling back to `prevSpanEnd`
    (guitar row 44, a fix would cut 2.9s→0.9s);
  - `LATESTART_MAX_PULL_S = 10` excludes exactly the worst rows (10.35–10.55s
    late with cov 0.93–1.00 evidence).
- Note: the user's two suspected examples in the stranger screenshot
  ("call home" 3:32–3:37, "Tested my fate" 3:37–3:44) were actually CORRECT
  (within ~0.5s of truth) — the pile rams against correct anchors, making
  them look complicit. The class is real; those instances weren't it.

## Proposed fix round (ranked)

1. **Ship-blocking plumbing**: bump `ALIGNMENT_PIPELINE_VERSION` with PR #12;
   document that mixed songs aligned pre-round-5 need a fresh Auto-align
   (stored-transcript limitation) — consider a UI nudge when
   `alignmentPipelineVersion < 19` on a mixed song, or persisting both pass
   transcripts to make re-refine honest.
2. **Honest degenerate display**: enforce a per-line floor in
   `redistributeRun` (respect `minLineDuration`, or spread at floor across
   the whole window and keep `needs_review` when capacity is insufficient);
   never emit `start == end`; fix the expansion room-check (pileup interiors
   + `>= MIN_HIGHLIGHT_S - ε`); re-run expansion after the mixed merge stitch.
3. **Honest labels**: gate the `onActivity` upgrade on meaningful coverage
   (span duration ≥ some fraction of floor AND word overlap), not any-overlap;
   count squashed/approximate in the off-timing banner (or a second banner
   line for "N lines approximate").
4. **Drag clamps**: straddle-guard fallback to `prevSpanEnd`; allow
   above-cap pulls when coverage ≈ 1.0 (span-corroborated, mirroring the
   round-5 onset-pull precedent); revisit `prevFloor` pinning behind
   zero-width neighbors.
5. **Quality re-score placement term**: require the line's own span evidence
   to be near the placement for `good` (e.g. |start − span.firstTime| bound
   when coverage ≥ 0.5), demote wrong-occurrence chorus matches.
6. **CI coverage**: add a garble/desert transcript fixture class (synthetic
   perturbation of a healthy fixture is sufficient — the repro scripts show
   the recipe) and guard `align_zero_dur`/pileup on it.

Items 2–5 each have measured repro cases cited above to become TDD tests.

---

## Round 6 — before/after (Task F)

All numbers from the deterministic instruments. "before" = round-5 close
(commit `a494b7e`, values from `2026-07-13-round5-findings.md` §6); "after" =
post-round-6 ratchet. Every fix was TDD'd from a repro cited above, spec- and
quality-reviewed, and gated on the LRC ground truth + corpus scorecard.

### LRC ground-truth alignment error (align p50 / p90 seconds)

| config | before (r5) | after (r6) | driver |
|---|---|---|---|
| guitar-loneliness word | 0.40 / 1.62 | 0.40 / 1.62 | unchanged (no degenerate run here) |
| guitar-loneliness segment | 0.73 / 1.96 | **0.73 / 1.93** | D1 straddle fallback (#44 2.9→0.9s; >1s 14→13) |
| stranger word ja-only | 0.85 / 37.74 | **0.64 / 36.10** | B floor + D clamps (p50 down; p90 still class-A tail) |
| stranger segment ja-only | 5.93 / 33.79 | **1.44 / 33.79** | D2 high-cov cap exception (verse cascade #23–30 recovered) |
| stranger word mixed 2-pass | 0.56 / 3.64 | **0.56 / 2.82** | B post-merge re-floor + D clamps |
| stranger segment mixed 2-pass | 0.56 / 7.86 | **0.56 / 6.48** | B post-merge re-floor + D2 |
| stranger segment medium ja-only | 0.70 / 12.92 | **0.70 / 9.34** | B floor + D2 (residual head class-A + A5#2) |

Six of seven configs improved; the seventh (guitar word, which has no
degenerate run) held. Nothing regressed. The headline win is
**stranger segment ja-only p50 5.93 → 1.44** — the D2 high-coverage cap
exception recovers the verse-cascade rows (~23–30) that round 5 deferred as
"high-risk." lrc-truth.test.ts now locks this config's p50 at ≤ 1.8 (its p90 is
left loose — 33.79s is the un-anchorable class-A chorus tail, not our defect).

### Fix → commit map

- **A** `721529f` — ship plumbing: `ALIGNMENT_PIPELINE_VERSION` 19 → 20, and a
  guard so a stored `mixed`-language song aligned pre-v20 is NOT silently
  re-refined from its lossy stored single-pass transcript (surfaces the
  re-run-Auto-align nudge instead). Fixes H1.
- **B** `c1859b0` + `fdb4c3d` — honest degenerate display (H2/H3): per-line
  packing floor (`redistributeRun` never emits below `min(minLineDuration,
  fairShare)`; spreads at floor + `needs_review` when capacity can't fit),
  no more `start == end` rows, epsilon-tolerant expansion room-check, and a
  re-run of the display floor after the mixed-merge stitch.
- **C** `fd146a8` — honest labels (H4): the `needs_review → approximate`
  upgrade now requires the packed line to be on activity AND ≥ 0.55 of its
  floor; the off-timing banner counts `needs_review` (or approximate-below-
  floor) instead of `needs_review`-only. Label-only — timing byte-identical.
- **D** `8df30eb` (D1 straddle-guard fallback) + `da54ae8` (D2 high-coverage
  cap exception) + `a16a617` (D2 doc/naming polish) — late-start backfill drag
  clamps (H5). D3 (prevFloor pinning) was not-applicable on HEAD once B
  eliminated the zero-width neighbour it keyed on.
- **E** `9489379` — garbled/desert transcript fixture class (H1/CI gap):
  `akfg-garbled-word` (deterministic perturbation of the healthy word
  transcript) with a focused honesty guard asserting `align_zero_dur=0`, no
  sub-floor pileups, honest labels.

### Corpus honesty deltas (proxy metrics vs. the LRC senior gate)

The scorecard moved in the expected honesty direction; every "worse-looking"
cell is a floor/label artifact while the LRC timing above improved or held
(audited per-cell at the ratchet — see the round-6 commit body):

- **Zero-duration rows eliminated** (Task B): `align_zero_dur` 1 → 0 on
  stranger word-medium, mixed-segment (the 183.5–183.5 row 45), and mixed-word.
- **Sub-floor pileups gone** (Task B): `align_pileup` down on stranger segment
  (5→1), word-autolang (9→0), segment-autolang (10→2), segment-medium (1→0),
  mixed-segment (2→0), mixed-word (2→0).
- **Compression relieved** (Task B floor-spread): `align_compressed` down on
  most configs (e.g. word-medium 28→8, word-autolang 59→39). It rises on
  mixed-segment (6→8) only because a former zero-dur row and a display-floor-
  reclaimed row now sit at the 1.2s floor (< 0.55×minLineDuration) — a real
  improvement (zero/sliver → visible) that the proxy counts as "compressed."
- **Honest labels** (Task C): `align_needs_review` rises where slivers used to
  wear dishonest `approximate` chips — stranger word 2→8, segment 3→8,
  word-autolang 7→46, segment-autolang 1→28, word-medium 5→12, segment-medium
  0→7, mixed-word 3→4. These are the piled/spread lines telling the truth.
- **D1 boundary artifact** (Task D): guitar-loneliness-segment `bnd_midword_p2`
  0 → 2 — the straddle fallback splits Whisper's merged chunk
  `何回になりたいなりたい` at the neighbour's true span end, so both sides land
  inside the merged token (chunk-granularity cosmetics, LRC #44 2.9→0.9s).
- **Garbled fixture baselined** (Task E): `akfg-garbled-word` snapshots
  `align_zero_dur=0`, `align_pileup=0`, `align_compressed=0`,
  `align_needs_review=5` (honest) — the exact shape the fixes guarantee on a
  garbled/desert transcript.

All round-6 carve-outs (`ALLOWED_MEASUREMENT_ARTIFACTS` in
corpus-scorecard.test.ts) were folded into `corpus-baseline.json` via
`--write-baseline` and cleared; `--pairing --check-baseline` exits 0.

### Deferred / still open

- **Class-A alternate-take tail** (stranger #32–51, ~20 lines): no transcript
  evidence in any of the five fixtures; drives the ja-only p90 33.79/36.10 and
  is un-fixable at source. Unchanged, guarded loosely.
- **A7 verse-cascade residual**: D2 recovered the p50 (5.93→1.44) but the
  ja-only p90 tail is still the class-A block above; the head rows #0/#1 remain
  interpolation-only (class-A).
- **Segment-mixed unevidenced tail**: #2's 0–26s mega-segment (13.7s error) and
  the bridge cluster #44–47 are partially class-A EN audio; the B post-merge
  re-floor made them honest (no zero-dur) but can't invent evidence.
- **A2 #44 / CLASS-T4**: chunk-granularity boundary cosmetics — no net win
  without sub-chunk onset timing (D1 supplied the neighbour's span for #44; the
  rest wait on intra-chunk detection).
- **English-only corpus song**: still a coverage gap (needs new audio +
  transcript).

### H1 shipping note

The version bump (19 → 20, commit `721529f`) is what actually lets round-5 and
round-6 fixes reach songs stored by an older app: `shouldRefineStoredAlignment`
now re-refines them. The one hazard H1 flagged — a pre-v20 **mixed** song whose
stored merged transcript is the lossy JA-only tail — is handled by the guard
that surfaces the "re-run Auto-align" nudge instead of silently replaying the
broken transcript. Single-language stored songs re-refine cleanly.

### Not done this round

- **Browser display-layer spot-check**: NOT completed — the in-app browser's
  per-origin approval needs an interactive user; this session ran autonomously.
  Manual step: run the dev server, play one Japanese and one mixed-language
  song, confirm the degenerate runs now render with a visible floor (no
  zero-duration rows), the off-timing banner count matches the visibly-off
  lines, and approx chips only sit on genuinely-approximate lines. All fixed
  behavior is covered by the deterministic instruments; this guards only the
  render layer.

---

## Round 7 — placement fixes (instrumental packing + over-long tails)

A second user spot-check surfaced two residual symptoms that round 6's honesty
floors made *visible* but did not fix at the placement layer:

1. **Verse on the instrumental** — a whole verse's highlights firing during an
   instrumental break, where Whisper had hallucinated a few noise moras. → Fix 1.
2. **Over-long highlight cascade** — a mid/late line staying lit ~6–11s while the
   sung phrase is ~3s, the highlight running long into the following rest. → Fix 2.

Both fixes are region-selection / `endTime`-only; neither changes a line START,
so the LRC ground-truth start-error table is **byte-identical to the round-6
close** (verified below).

### Fix 1 — run-coverage gate on activity regions (commits `fd4b21f`, `8cade51`)

`findActivityRegions` treats ANY transcribed word as activity, and no acoustic /
VAD / `no_speech_prob` signal survives to the alignment stage (see limit (a)), so
a hallucinated blip during an instrumental forms a false activity region that
`redistributeRun` packs a whole degenerate run onto. The only usable signal on
the re-refine path is **lexical run-coverage**: keep an activity region only when
its words char-LCS-corroborate ≥ `RUN_COVERAGE_MIN` (0.15) of the RUN's expected
characters (the framing is run-coverage, not region-coverage — a lone `ような`
blip covers 67% of its own region but ~2% of the run), OR the region carries
≥ `DENSE_REGION_MIN_WORD_TIME_S` (1.5s) of transcribed audio (the density
OR-clause protects cross-script real vocals — English verses that JA-mode Whisper
returns as unmatchable katakana — from the lexical gate's blind spot; a real
vocal region carries 2.0–27.1s of audio, every instrumental blip ≤ 1.2s). When
the filter empties the region set the layout falls back to spreading the run
across the whole window at floor with `onActivity=false` — an honest
`needs_review` spread instead of a false `approximate` clustered on noise. Only
words inside kept regions feed the `onActivity → approximate` upgrade, so a line
merely passing over a rejected blip stays flagged.

Fixture before/after (pre-Fix-1 = `redistributeDegenerateRuns.ts` at `fd4b21f~1`):

| fixture | row | pre-Fix-1 | current | truth |
|---|---|---|---|---|
| garbled (single blip in a desert) | 15 | 228.0s `approximate` (on the blip) | 190.3s `needs_review` | ~190s |
| instrumental (sparse noise region) | 16 | 245.0s `approximate` (on the noise) | 197.1s `needs_review` | ~203s |

In both, the whole run (garbled 15–20, instrumental 16–20) previously packed
into the few-second blip/noise region wearing false `approximate` chips; now it
spreads across its true window at floor, honestly `needs_review`.

### Fix 2 — cap over-long unanchored gap-fill tails (commits `bb86914`, `432bde4`)

Pass-1 `projectPhraseTimingToLines` hands an un-anchorable line the whole
`[prevEnd, nextStart]` slab (`end = min(ownEnd, nextStart)`), and
`clipSilencePaddedLineTails` cannot reclaim it when a forced-language pass
hallucinated continuous words over the gap (its silence check is keyed on raw
words). No stage bounded a highlight to its expected sung length.
`capUnanchoredGapFillTails` bounds a line's `end` to `expectedLineDuration` when
(1) the end is gap-defined, (2) the line is not a held-vowel / interjection line,
(3) its own matched-span coverage is < 0.15 (the decisive gate — a well-evidenced
long line is untouched), and (4) it is over-long. **Ends only** — starts and the
next line are never moved, so the freed tail becomes an un-highlighted
instrumental rest. Two call sites: the single-pass tuner chain (gated off the
mixed passes, whose per-language transcript reads spurious cov 0 on the other
script) and the mixed two-pass merge against the MERGED transcript. Verified
caps: stranger segment-mixed row 54 `6.74s → 5.0s`, row 37 `4.20s → 2.25s` (both
cov 0); the cov-0.84 wide row 2 and the high-cov extended AKFG rows are untouched.
Because it moves only `endTime`s and the capped rows sit below the 18s
`align_long_dur` threshold, it moves **nothing** in the corpus scorecard and
leaves LRC start-error byte-identical.

### Rejected dead-end — "early-start pull"

Prototyped pulling a late-placed line's START back toward its earliest
span-evidence when that evidence sat well before the placement. It **regressed**
stranger segment-mixed p50 `0.56 → 0.68`: the lines it targeted are already
correctly placed, and their late span-evidence is a *spurious repeated-chorus
match* (the same lyric recurring later in the song), so pulling the start toward
it moves a correct line onto the wrong occurrence. Documented here so a future
round does not re-attempt it — the late span-evidence on those lines is noise,
not a missed onset.

### Honest limits (unchanged, restated for round 7)

- **(a) No acoustic signal exists.** The `@huggingface/transformers` stack
  discards the audio before alignment and it is absent on re-refine; there is no
  VAD / `no_speech_prob` / energy signal to distinguish an instrumental from
  sung vocals Whisper simply missed. A run whose vocals were never transcribed is
  **un-placeable** — Fix 1 only stops the *confident mis-pack* onto hallucinated
  noise and degrades it to an honest floor-spread `needs_review`. It cannot
  invent the missing onset.
- **(b) The user's exact "Stranger than heaven 11s" is device-specific.** It
  depends on that user's in-app Whisper transcript, which is not reproducible
  from the committed fixtures. Fix 2 helps it only if that line has weak
  in-window coverage (cov < 0.15) and a gap-defined over-long tail; if the line's
  onset itself is mis-transcribed, limit (a) applies.

### New permanent guard — `akfg-instrumental-word`

Round 6's `akfg-garbled-word` is a transcript DESERT with a single blip; it did
not specifically exercise "a run must not pack onto an instrumental *activity
region*." `scripts/make-instrumental-fixture.mjs` (deterministic; `--check` mode)
deletes sheet rows 16–20's real vocals + the ♪ marker (midpoint window
[198,260]s) and inserts four sparse single-mora katakana noise chunks
(ネ/ヌ/ホ, ~1.3s of audio total) forming one ~9s region at 245–254s AFTER the
block's true position. `tests/ai-pipeline/instrumentalFixture.guard.test.ts`
asserts the run does not cluster onto that region, spreads across its window,
overlaps no part of the noise, and stays `needs_review` — proven RED on
`fd4b21f~1` (row 16 packs to 245.0s `approximate`) and GREEN on HEAD. Baselined
as corpus row `akfg-instrumental-word`.

### Ratchet — moved corpus cells (Task 16, 2026-07-15)

`--write-baseline` moved exactly two cells plus the new row; every move is a
Fix-1 region-selection honesty gain (Fix 2 moved nothing):

- `akfg-garbled-word.align_needs_review` 5 → 6 — the run no longer buys a false
  `approximate` on the 228s blip (row 15 stays `needs_review`); +1 *honest* flag.
- `stranger-than-heaven-word-medium.align_needs_review` 12 → 11 — rows 57/58
  pulled from 242.98s/244.52s (≈20.5s / 16.5s late) to 221.77s/223.59s, i.e.
  within **0.7s / 4.4s** of LRC truth (222.5s / 228s); row 57 upgraded
  `needs_review → approximate` *at its true position* (a real improvement, not a
  masking — verified against `lrc-truth/stranger-than-heaven.json`).
- `akfg-instrumental-word` — new row, all-honest snapshot (`align_needs_review`
  5, `align_zero_dur`/`align_pileup`/`align_compressed`/`align_long_dur` 0).

The round-7 `ALLOWED_MEASUREMENT_ARTIFACTS` carve-out (garbled 5→6) was folded
into `corpus-baseline.json` and cleared; `--pairing --check-baseline` exits 0.

### LRC ground-truth (byte-identical to round-6 close)

| config | align p50 / p90 (r6 = r7) |
|---|---|
| guitar-loneliness word | 0.40 / 1.62 |
| guitar-loneliness segment | 0.73 / 1.93 |
| stranger word ja-only | 0.64 / 36.10 |
| stranger segment ja-only | 1.44 / 33.79 |
| stranger word mixed 2-pass | 0.56 / 2.82 |
| stranger segment mixed 2-pass | 0.56 / 6.48 |
| stranger segment medium ja-only | 0.70 / 9.34 |

No start time changed, so `lrc-truth.test.ts` thresholds are unchanged (round-6
headroom retained; no config gained actionable slack to tighten).

### Still open (round 7)

- **Browser display-layer spot-check**: still NOT completed (autonomous session;
  the in-app browser's per-origin approval needs an interactive user). Manual
  step unchanged from round 6 — plus: confirm a run over an instrumental now
  spreads honestly rather than lighting the verse during the break.
- Everything under round 6's "Deferred / still open" (class-A alternate-take
  tail, unevidenced segment-mixed tail, English-only corpus gap) is unchanged —
  limit (a) bounds all of them.

## Round 8 — gap-targeted re-transcription (recover garbled gaps)

**The user's question.** "When the vocals over a stretch are perfectly clear but
the aligner still leaves that whole verse un-anchored (a garbled gap), can we go
back and recover it — instead of only spreading it honestly?" Rounds 6/7 made a
bad gap *honest* (no zero-width rows, no verse lit over an instrumental) but never
tried to *fix* the transcription that caused it: a mid-song verse where Whisper's
long-form pass produced a desert/garble (chunk-stride stitching + per-chunk
auto-language truncation are the documented long-form failure modes) left the
sheet lines with no corroborating words, so they fell to `needs_review` and the
round-7 spread was the best we could do.

**The answer: yes.** A garbled gap *can* be recovered when the audio itself is
clean. The lever is a **short, single-window, forced-language re-transcribe of
just the hole**: slice the ≤30s of audio between the two good anchors that bound
the gap and re-transcribe *that buffer alone* with the language forced. A ≤30s
single window takes Whisper's single-`generate` path — **no** stride stitching and
**no** auto-language truncation — so the exact long-form bugs that garbled the
gap in the first place are structurally sidestepped. The e2e test proves it end
to end on the committed garbled AKFG fixture: the real refine strands lines 15–20
as a `needs_review` hole (placed coverage ~0), and a clean forced-`ja` slice
re-align lands all six lines back on their true positions (sub-second) with
placed coverage 1.0.

**Levers used vs. deferred** (from the feasibility investigation's four options):

- **Lever 1 — clean ≤30s slice.** Used. `MAX_SLICE_S = 30`; a wider hole is
  clamped to its first 30s (the window opens right after a good anchor, so the
  early lines are the most re-anchorable), keeping every slice on the safe
  single-window path.
- **Lever 2 — forced per-hole language.** Used. A single-language song forces its
  one language; a mixed song detects the hole's own (near-always single-script)
  run and forces *that*, sidestepping the per-chunk language flapping that garbled
  the full mixed pass. A genuinely bilingual hole falls back to `'mixed'` (a single
  ≤30s window still auto-detects without multi-chunk flapping).
- **Lever 3 — higher model tier per gap.** Deferred (not in the MVP). The gap pass
  inherits the main pass's tier / `highAccuracy` / timestamp mode; no per-gap
  model swap.
- **Lever 4 — lyric prompt-biasing.** Deferred. The installed transformers.js
  v3.8.1 leaves `prompt_ids` unwired, so biasing the decoder toward the known
  sheet text isn't cleanly possible; revisit on a library upgrade.

**Architecture** (strictly additive on rounds 6/7):

- **G1 — pure core** (`src/lyrics/gapRealign.ts`): `enumerateGapHoles` (maximal
  `needs_review` runs bounded by good anchors, blank/interjection runs skipped),
  `holeWorthRetrying` (round-7 run-coverage < `RUN_COVERAGE_MIN` **and** window ≥
  4s), and `spliceGapAlignment` (re-align the hole rows against the fresh gap
  words via the same `refineAlignmentWithPhrases`, clamp inside the anchors,
  `enforceLineMonotonicity`, then **accept only if better**). No audio, no Whisper
  — corpus-testable.
- **G2 — orchestrator** (`src/ai-pipeline/gapReanalyze.ts`): `reanalyzeGaps` runs
  the sweep with the slice transcription **injected** as `transcribeSlice`, so it
  is deterministically unit- and e2e-testable with a mock. AutoAlignFlow supplies
  the real closure (`audioData.subarray → transcribeAudio → offset words`).
- **Wiring** — `AutoAlignFlow.start()` inserts the pass after `refined` /
  `transcriptWords` are assigned and before persist, gated on `audioData` present.

**The safety invariant (the whole point).** A gap re-transcription is accepted
only if it **strictly reduces the `needs_review` count over the gap AND its
placement-aware coverage does not regress** — i.e. the new placement realizes the
corroboration the fresh gap words could achieve over the window. Without the
coverage clause a label drop alone could accept a *worse* placement (right text in
the wrong order strands a line far from its evidence while one line still anchors
and the count falls); the clause rejects that. On reject, `spliceGapAlignment`
returns the input **byte-identical** (same references). So the pass **can never
make a song worse** — a failed retry falls straight back to the round-7 honest
spread. Caps bound cost and churn: **2 passes**, **4 holes/pass**, **30s** slices,
each line-range retried **at most once**.

**Limits.**

- **Fresh Auto-align only.** The gap pass needs `audioData`; the PlayerView
  re-refine path has none, so it does not run there. Songs aligned *with* the pass
  persist the improved gap words in `transcriptWords`, so the benefit survives to
  playback.
- **Not a hallucination cure.** The pass can't fix a gap where the audio itself is
  genuinely unintelligible — but a short forced-language window *reduces*
  hallucination relative to the long-form pass, and the accept-if-better guard
  discards any re-transcription that doesn't actually corroborate the sheet.
- **Browser spot-check still open** (see below): the e2e proof is deterministic
  (mock at the `transcribeSlice` seam); an end-to-end run on real MP3 audio in the
  app has not been done in this autonomous session.

### Tests (round 8)

- **G1 unit + corpus** (`tests/lyrics/gapRealign.test.ts`): hole enumeration,
  worth-retrying gate, accept-if-better splice, the two safety rejects
  (garbled words; correct-but-reversed words), and a corpus-style splice over the
  committed garbled AKFG transcript.
- **G2 orchestrator** (`tests/ai-pipeline/gapReanalyze.test.ts`): fill, garbage
  reject, no-holes no-op, per-pass cap, no-retry-of-rejected-range, cancellation,
  progress, and per-hole language forcing (mixed + fallback).
- **G3 end-to-end** (`tests/ai-pipeline/gapReanalyze.e2e.test.ts`): the seam G2
  deferred — the REAL chain `refineAlignmentWithPhrases → reanalyzeGaps →
  spliceGapAlignment → refineAlignmentWithPhrases` with only `transcribeSlice`
  mocked. Proves (1) a real garbled hole is FILLED (`filledCount = 1`, six lines
  `needs_review → good`, placed coverage 0.0 → 1.0) and the gap lines land on their
  **true positions** (sub-second), and (2) the safety composition: a garbage slice
  → `filledCount 0` and the full result byte-identical to the no-gap pass.
  **Fixture choice:** the clean gap transcript is built **in-test** from the
  sheet's own ground-truth lines (reusing the committed garbled transcript for the
  hole); no standalone clean-gap fixture file was added — a committed JSON would
  only re-serialize `lyrics.ja.txt` (duplication that could silently drift) while
  adding zero information, since the sheet already IS the ground truth.

### Verification (round 8 close)

- **`npx vitest run`** — 182 files / 1287 tests pass, 2 skipped (no flakes).
- **`npx tsc -b`** — clean.
- **`npx tsx scripts/audit-corpus.mjs --pairing --check-baseline`** — exit 0, **no
  regressions**. Round 8 is additive: it adds a module + an orchestrator + tests
  and touches no shared align path, so no corpus cell moved and no baseline was
  re-ratcheted. (The gap pass runs only in the app path; `audit-corpus` /
  `audit-vs-lrc` call `refineAlignmentWithPhrases` directly and never invoke it.)
- **`npx tsx scripts/audit-vs-lrc.mjs`** — byte-identical to the round-7 close
  (guitar 0.40/1.62, 0.73/1.93; stranger 0.64/36.10, 1.44/33.79; mixed 0.56/2.82,
  0.56/6.48; medium 0.70/9.34).

### Commits (round 8)

- **G1** (pure core): `a303c79`, `0fcef8b`, `36d674e`.
- **G2** (orchestrator + wiring): `1596b52`, `39a2472`.
- **G3** (e2e test + this report): this task.

### Still open (round 8)

- **Browser display-layer spot-check** — still NOT completed (autonomous session;
  the in-app browser's per-origin approval needs an interactive user). New for
  round 8: load a song whose mid-verse Whisper garbled, Auto-align it fresh, and
  confirm the "Recovering N unaligned sections…" phase fires and the recovered
  verse now highlights on-beat rather than spreading honestly through the gap.
- **Lever 4 (prompt-biasing)** awaits a transformers.js upgrade that wires
  `prompt_ids`; **lever 3 (per-gap higher tier)** is a possible future MVP+.

## Round 9 — addressing the boundaries (stored-song recovery + lyric-prompt biasing)

Round 8 shipped gap recovery but left **two honest limits** in its "still open":
recovery ran only during a *fresh* Auto-align (never on already-stored songs), and
lyric prompt-biasing was deferred on a library-version wall. Round 9 lifts both,
and separately ships round-7's placement fixes to stored songs via a version bump.
Every gap re-transcription still passes through round-8's **accept-if-better**
(`spliceGapAlignment`): a re-align is adopted only if it strictly reduces
`needs_review` **and** placement-aware coverage does not regress. That single
invariant is what makes running recovery on *stored* songs (B1) and steering the
decoder through an *undocumented* prompt hatch (B2) both safe — a bad
re-transcription is rejected **byte-identical**, so either path can only help or
no-op, never worsen a song.

### B1 — stored-song gap recovery (the "fresh-align-only" limit, lifted)

Stored songs now recover garbled gaps **without a full re-align**. The recovery
math is unchanged — it reuses round-8's `reanalyzeGaps` — via a shared
`createSliceTranscriber` (R9-1) extracted from `AutoAlignFlow`'s inline slice
closure (behavior-identical: audit-vs-lrc byte-identical, `AutoAlignFlow.*` green,
net line reduction). For a stored song the routine **decodes the stored audio on
demand** (`getAudioFile` → `decodeAudioFileToMono`) and **reconstructs a
`RefinedAlignment`** view from the persisted fields (lines, phrases,
`lineAlignmentQuality`, anchor sources, confidence, mode, phrase layout, sheet
snapshot) — everything `enumerateGapHoles` and `spliceGapAlignment` read is already
on disk. `applyRefinedAlignment` is called with `{...lyrics, transcriptWords:
recovered}` so the recovered words are not dropped.

**Version-independent trigger.** The gate is a **new persisted
`gapRecoveryVersion`** (`GAP_RECOVERY_VERSION`, starts at 1), deliberately
*separate* from `ALIGNMENT_PIPELINE_VERSION`. It has to be: round-6-onward songs are
already at pipeline v20+ and so **never re-refine on open** (`shouldRefineStoredAlignment`
only fires below the current version), meaning a recovery trigger keyed off the
pipeline version would never fire for exactly the stored songs that need it.
Instead the trigger is derived from the song's own stored **holes + audio**.

**Both paths.**

- **AUTO (once on open).** In PlayerView's enrichment effect, gated on
  `!willAutoAlign` **and** local audio present **and** `(gapRecoveryVersion ?? 0) <
  GAP_RECOVERY_VERSION` **and** at least one worth-retrying hole in the reconstructed
  refined view. It runs after (and independent of) the version-gated re-refine block,
  and is **skipped when a fresh Auto-align will run** (that path already recovers).
  `gapRecoveryVersion` is **stamped even when `filledCount === 0`** so the auto pass
  never churns — a song with an unrecoverable gap is marked "tried at v1" and left
  alone until a future `GAP_RECOVERY_VERSION` bump. Cancel-aware; **mixed songs
  included** (accept-if-better protects them).
- **MANUAL.** The EditMode off-timing banner gains a **"Recover N sections"** action,
  shown when `hasLocalAudio && recoverableHoleCount > 0` (count derived from the same
  stored lines + quality + `transcriptWords`). It re-runs recovery **even if
  `gapRecoveryVersion` is already current** — a manual click overrides the once-guard —
  shows the "Recovering N…" progress, persists, and refreshes the lines.

A race guard (R9-2 review, `bf26149`) stops the auto pass and a manual click from
recovering the same song concurrently, and stamps `gapRecoveryVersion` on a fresh
align too so a just-aligned song isn't re-scanned on its first open.

Commits: `e0cf227`, `bf26149` (+ R9-1 `5d711d2`, `40018f1`).

### B2 — lyric-prompt biasing (the deferred lever, now shipped guarded)

Each hole's **known sheet lyrics** are fed to Whisper as a decoder prompt, biasing
the re-transcription toward the words we already know belong there. Round 8 deferred
this because no *released* transformers.js wires the documented `prompt_ids` option
(it is a stub even in 4.2.0). Round 9 ships it through the **`decoder_input_ids`
escape hatch** instead: the ASR pipeline forwards kwargs to `model.generate`, which
honors `decoder_input_ids`, so a worker helper `buildWhisperPrompt` assembles the
`<|startofprev|> … <|startoftranscript|> <|ja|> transcribe <|notimestamps|>` id
sequence from the pipeline's own tokenizer + generation-config internals.

- **Feature-gated.** If any required internal is absent (tokenizer /
  generation-config ids), it logs once and falls back to the **unprompted** slice —
  it never crashes.
- **Segment-mode only.** The prompted path forces segment timestamps; word-mode's
  prompt-prefix trim is missing in 3.8.1 and would emit phantom words.
- **Window-scoped.** The prompt is the hole's sheet lines only, scoped to the
  transcribed window (R9-3 review, `71eae51`), well within Whisper's 448-token
  context (holes are ≤4 lines).
- **Safe by construction.** Round-8 accept-if-better rejects a prompt-echo
  hallucination — a decoder that parrots the prompt text at the wrong times scores
  low placed-coverage and is rejected byte-identical — so, like B1, prompting can
  only help or no-op. A test asserts a prompt-echo mock (right words, wrong times)
  is rejected.

Commits: `9f5bab9`, `71eae51`.

### R9-4 — version bump 20 → 21

`ALIGNMENT_PIPELINE_VERSION` 20 → 21 (`phraseAlignment.ts`), so
`shouldRefineStoredAlignment` re-refines round-6-aligned (v20) non-mixed auto songs
on open and applies **round-7's placement fixes** (run-coverage gate + tail cap,
both in the refine path). Single-pass, no Whisper — cheap. This is **independent of
`gapRecoveryVersion`**: the version bump ships placement math to stored songs; the
recovery version ships gap re-transcription. Mixed v20 songs still skip re-refine
(mixed guard intact), getting the `needsMixedRealign` nudge plus now the manual
Recover button. Commit: `647de68`.

### Verification (round 9 close)

- **`npx vitest run --exclude "**/.claude/**"`** — **185 files pass / 1 skipped;
  1334 tests pass / 2 skipped**. No flakes on this run.
- **`npx tsc -b`** — clean.
- **`npx tsx scripts/audit-corpus.mjs --pairing --check-baseline`** — exit 0, **no
  regressions**. Round 9 is additive / UI / version-only and changes no refine math,
  so no corpus cell moved and no baseline was re-ratcheted.
- **`npx tsx scripts/audit-vs-lrc.mjs`** — **byte-identical** to the round-7/8 close
  (guitar 0.40/1.62, 0.73/1.93; stranger 0.64/36.10, 1.44/33.79; mixed 0.56/2.82,
  0.56/6.48; medium 0.70/9.34).

### Commits (round 9)

- **R9-1** shared `createSliceTranscriber`: `5d711d2`, `40018f1`.
- **R9-2 (B1)** stored-song recovery (auto + manual): `e0cf227`, `bf26149`.
- **R9-3 (B2)** lyric-prompt biasing: `9f5bab9`, `71eae51`.
- **R9-4** version bump: `647de68`.
- **Report** (this section): this task.

### Still open (round 9)

- **Browser display-layer spot-check** — still NOT completed (autonomous session;
  the in-app browser's per-origin approval needs an interactive user). For round 9:
  open an *already-stored* song with a garbled mid-verse and confirm the AUTO
  once-on-open recovery fires (or the manual "Recover N sections" banner button
  works) and the verse re-anchors on-beat.
- **The deferred library upgrade.** Watch **transformers.js issue #1590**. The
  upgrade would unlock WebGPU + WASM timestamp accuracy — but it does **NOT** wire
  `prompt_ids` (still a stub even in 4.2.0), so B2 rightly ships through the
  `decoder_input_ids` hatch today rather than waiting on it.
