# Robust Alignment on Messy Audio — Design Spec

**Date:** 2026-07-09
**Status:** Approved

## Goal

Make the auto line-level aligner and the word-level aligner robust on songs with
imperfect audio, mixed JA/EN lyrics, and multiple (sometimes overlapping)
vocalists — as general improvements, not song-specific fixes. The driving
fixture is stranger-than-heaven, but every change must hold or improve the four
clean corpus songs (veil, akfg-firsttake, my-eyes-only, guitar-loneliness).

## Diagnosed failure modes (via the stranger-than-heaven fixture)

1. **Pileups** — runs of unanchorable lines crammed into a ~0.3s point
   (lines 44–50, six lines at 153.88–154.18). Playback flashes them all at once.
2. **Absorption** — one line stretched across a long instrumental gap
   (line 53: 163.4–202.4s, 39 seconds).
3. **Compression** — lines squeezed to ~0.3s between anchors (lines 19–21, 38–43).
4. **Overlapping vocalists** — the transcript is non-monotonic where two
   vocalists sing simultaneously (two interleaved word streams sharing
   timestamps around 143–145s); the matcher assumes one monotonic stream.
5. **Near-miss mishearings** — phonetically close but lexically failing
   ("Strange in the heaven" vs "Stranger than heaven", "made a way boy" vs
   "made a weapon").
6. **Upstream transcription bug** — the app forces a single Whisper language
   for the whole song (`whisperLanguageFor` → `'japanese'` for JA songs), so
   English sections of mixed songs decode under the Japanese language token and
   come out garbled. This is the root cause of much of failure modes 1 and 5.

Word-level sync failures follow directly: when the line window is a 0.3s pileup
or a 39s absorption, per-word timing inside it is meaningless.

## Component 1 — Graceful-degradation redistribution pass

A new final deterministic tuner at the end of the `refineAlignmentWithPhrases`
chain in `src/lyrics/phraseAlignment.ts`. It only re-times degenerate runs and
never touches anchored (`good`) lines.

### Detection

A maximal run of consecutive non-`good` lines is degenerate when it shows any of:

- **Pileup**: 2+ consecutive line starts within ~0.4s of each other.
- **Compression**: a line's duration is below a per-text floor
  (~120ms per mora for JA / per estimated syllable for EN).
- **Absorption**: a line's duration far exceeds a plausible ceiling for its
  text (e.g. >2.5× expected sung duration or >18s).

Exact thresholds are tuned against the corpus during implementation.

### Redistribution

- The window is bounded by the nearest anchored neighbors (previous line's end,
  next line's start); song edges bound the first/last runs.
- Within the window, compute transcript **activity regions**: spans containing
  transcript words. Gaps longer than ~4s are treated as instrumental and
  excluded, so absorbed lines shrink instead of covering dead air.
- Distribute the run's lines across activity regions in order, proportional to
  each line's estimated sung length (mora count JA, syllable estimate EN).
- Absorbed lines shrink to their expected duration, snapped to the activity
  region nearest their matched fragment (if any).
- Monotonicity is preserved by construction; the pass is a no-op when the run
  is already sane or when there is no bounding anchor on either side (fully
  unmatched song: distribute evenly over all transcript activity).

### Quality labels

- Redistributed lines that land on transcript activity upgrade
  `needs_review → approximate`.
- Lines placed with no supporting activity keep their existing flag but get
  sane timings.

### Word-level fallback

Within redistributed (and generally unanchored) lines, per-word timing falls
back to proportional distribution across the line window. Verify
`src/ai-pipeline/wordAligner.ts` already degrades this way; fix if not.

## Component 2 — Messy-transcript robustness

### 2a. Overlapping-vocalist handling

Investigate how `sanitizeTranscript` (src/ai-pipeline/aligner.ts) and the
content matcher behave on out-of-order transcript words. Make matching
tolerant: sort words by start time, and allow matching to consider both
interleaved streams (duplicate temporal coverage) rather than aborting or
mis-scanning the monotonic pass. No stream is discarded — either stream may
hold the lyric being matched.

### 2b. Phonetic fallback matching for EN lines

When lexical matching fails for a Latin-script line, score candidate transcript
spans by phonetic-skeleton similarity (lightweight metaphone-style
normalization: lowercase, collapse vowels, merge voiced/unvoiced consonant
pairs, drop duplicates). Threshold-gated so it only claims an anchor on strong
similarity — it must recover "Strange in the heaven" ↔ "Stranger than heaven"
without inventing anchors on the clean corpus songs. Anchors claimed this way
are labeled at most `approximate`, never `good`.

## Component 3 — Mixed-language transcription (upstream)

- Detect a mixed-language sheet: both substantial Latin-script lines and JA
  lines present (thresholds tuned during implementation; e.g. ≥3 substantial
  lines of each script).
- For mixed sheets, stop forcing one Whisper language — omit `language` so
  Whisper auto-detects per 30s chunk. Single-language sheets keep the current
  forced-language behavior (`whisperLanguageFor`).
- **Empirical gate**: before wiring into the app, re-transcribe the
  stranger-than-heaven MP3 (user's Downloads) via `scripts/lib/nodeWhisper.mjs`
  with auto-detect, add the result as a *new* corpus fixture variant alongside
  the current transcript, and compare scorecards. Wire into the app
  (`whisper.worker.ts` / `whisperTranscriber.ts` / `AutoAlignFlow`) only if it
  measurably wins. Keep the old garbled transcript as a permanent stress
  fixture for Components 1–2 either way.

## Testing

- `scripts/audit-corpus.mjs` remains the harness. Add `align_pileup` and
  `align_compressed` scorecard metrics so these failure modes are tracked, and
  re-snapshot the baseline (`--write-baseline`) once improvements land.
- CI guard (`tests/ai-pipeline/corpus-scorecard.test.ts`) enforces zero
  regressions on the four clean songs.
- Unit tests per new pass (redistribution detection/placement, phonetic
  skeleton matcher, non-monotonic transcript handling), following the existing
  tuner test patterns.
- TDD per pass: failing test from the observed corpus behavior first, then the
  fix.

## Sequencing

C1 → C2 → C3. Components 1–2 must work on bad transcripts regardless (that is
the point of graceful degradation), and C3's experiment may then re-fixture
stranger-than-heaven with better ground truth.

## Error handling

All passes are deterministic and gated: on unexpected input (no transcript
words, no anchors, empty lines) each pass is a no-op rather than throwing.
Thresholds are conservative so clean songs are untouched (verified by the
baseline guard).
