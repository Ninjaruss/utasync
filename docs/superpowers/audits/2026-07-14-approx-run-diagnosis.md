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
