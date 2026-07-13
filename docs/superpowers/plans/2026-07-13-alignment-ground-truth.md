# Alignment accuracy: ground-truth validation & refinement plan

## Problem

Four rounds of aligner fixes have all been validated against the **corpus
instrument**, which scores alignment against *Whisper's own transcript*. That
catches internal inconsistency but is blind to two whole error classes:

1. **Transcription-time errors** — if Whisper's timestamps are skewed
   (rate bugs, chunk-stitch drift, overstamps), the aligner faithfully aligns
   to wrong times and every internal metric still looks fine.
2. **Perceptual errors** — the user hears desync against the *playback*
   timeline, which no transcript-relative metric measures.

Live reports (AKFG uniformly off by seconds with vocal separation; STRANGER
fully desynced) kept surfacing issues the instrument scored as healthy.

## Ground truth

LRCLIB hosts community/human-synced LRC timestamps. Verified available:

| song | LRCLIB id | duration vs our MP3 | quality |
|---|---|---|---|
| guitar-loneliness | 996372 | 229.0 vs 228.98s | exact-version match |
| stranger-than-heaven | 35640737 | 237.0 vs 233.57s | near match — remove a fitted constant offset before scoring |

(AKFG First Take: no LRC for the First Take arrangement; veil: only shorter
edits. Excluded from truth scoring.)

Fixtures live in `tests/ai-pipeline/fixtures/lrc-truth/`.

## Phases

### Phase 1 — Truth instrument (this session)
`scripts/audit-vs-lrc.mjs`:
- Parse LRC → (time, text) pairs; match LRC lines to our lyric-sheet rows by
  normalized text (LCS/similarity — sheets and LRCs differ in blank lines and
  repeats; repeated lines match in order).
- Robust version-offset removal: median of (aligned_start − lrc_time) over
  well-matched lines; report the offset itself (a large one is a finding, not
  noise to hide).
- Metrics per run: median |residual|, p90, % lines > 1.0s off, worst 5 lines.

### Phase 2 — Attribution matrix
Score BOTH stages against truth for every configuration we can produce in
node (transcripts from the real MP3s via scripts/transcribe-file.mjs):
- transcript-level: for each truth line, distance from the LRC time to the
  nearest transcript evidence of that line's text → "Whisper timestamp error".
- alignment-level: our final line starts vs truth → "end-to-end error".
- Configurations: {word, segment} × {ja-forced, forced-en, mixed two-pass}.
Attribution rule: end-to-end error ≈ transcript error → aligner is faithful,
fix transcription; end-to-end ≫ transcript error → aligner drops accuracy,
fix alignment.

### Phase 3 — Fixes (driven by Phase 2 findings, gated by BOTH instruments)
Candidate areas, to be confirmed/refuted by data before touching code:
- long-form chunk-stitch drift in WASM whisper (stride/jump math),
- segment-chunk boundary quantization (chunks snap to whole seconds),
- proportional interpolation inside evidence gaps,
- vocal-separation path (rate fix landed; validate no residual shift).

### Phase 4 — Regression lock
- Add truth metrics as corpus rows (offset-corrected residual p50/p90) to
  corpus-baseline + CI scorecard test.
- Optional live E2E with vocal separation ON in the browser pane.

## Status log
- 2026-07-13: fixtures fetched; Phase 1 instrument (`scripts/audit-vs-lrc.mjs`) built and run.
- 2026-07-13 Phase 2 findings (attribution):
  - **Whisper evidence is good; the aligner squanders it.** Matched-line
    evidence sits p50 0.3-0.6s from human truth on both songs, but final
    aligned starts were p50 1.6-7.5s (stranger) / 0.45-0.81s (guitar).
  - Defect A — late-anchored lines blocked from snapping back:
    `backfillLateStartsToMatchedSpan` capped pulls at 2.5s and required a
    word-scale container, excluding the real 3-6s late clusters. FIXED
    (cap 10s, container cap 8s): stranger word p50 1.61→0.85s, mixed segment
    2.03→1.65s, guitar segment p90 5.32→4.59s. Corpus re-baselined (+1
    pileup/late counts — transcript-relative noise; truth is senior).
  - Defect B — remaining late-anchored lines (guitar #27/29/44/46, late
    1.9-4.9s vs own span) blocked by previous-line-overlap guards when both
    lines matched inside ONE subdivided mega-chunk. Next fix: order-aware
    pull (allow when span order i-1 < i is preserved inside the shared chunk).
  - Defect C — guitar #18-21: aligned exactly on their span but ~5s late vs
    truth → evidence itself mis-timed or a repeat-occurrence misassignment
    (LCS matched a later chorus repeat). Needs repeat-aware investigation.
  - Defect D — stranger lines 44-51 (word mode): no usable evidence
    (transcript dead zone) → 40s interpolation error; only better transcripts
    (mixed segment pass covers it: those lines are ±0.5s there) fix this.
    Config guidance: mixed sheets should prefer the segment two-pass.
  - Caveat: stranger LRC is a 237s edit vs our 233.6s audio; mid-song residual
    clusters (+8s around lines 20-33) may be version drift, not aligner error.
    Guitar (exact version) findings are trustworthy.
- 2026-07-13 later — Defects B & C FIXED:
  - B: dropped the container-starts-before-prev-span rejection in
    `backfillLateStartsToMatchedSpan` (the boundary clamp to prevSpanEnd is
    the real ownership guard); guitar #27/#44 recovered.
  - C was NOT a repeat misassignment: Whisper emits COLLAPSED chunks (a whole
    line stamped into 0.2-0.4s at the utterance's end; guitar #18-19 stamped
    95.0-95.4 vs sung from ~89.7). New `expandCollapsedSegment` in
    sanitizeTranscript expands sub-0.06s/glyph chunks backward at 0.2s/glyph,
    bounded by the previous chunk's end.
  - Truth error after B+C: stranger segment two-pass (the app's real config
    for this song) p50 2.03s→0.73s, >1s lines 35→25; guitar segment p90
    5.32s→2.92s. Corpus re-baselined (+1-count transcript-relative wiggles).
  - Remaining (documented, unfixed): stranger intro #0-2 (marker-chunk
    bounding), interlude #40-42 / rap-block residuals (possibly LRC version
    drift — needs exact-version truth to confirm), guitar #20 (one 4.1s chunk
    carrying three lines' text — under-segmented evidence).
- Next: Phase 4 truth metrics in CI scorecard; live re-validation with vocal
  separation ON; consider exact-version LRC sources for stranger.
