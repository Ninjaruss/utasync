# Line-Boundary Accuracy for Auto-Align and Re-Align

**Date:** 2026-07-07
**Status:** Approved (interviewed 2026-07-07)

## Problem

On popular Japanese songs and mixed Japanese/English songs, auto-aligned lyric
lines sometimes end a little early or a little late relative to when the line
is actually sung. This breaks the user's ability to trust line boundaries as
anchors. The defect has been observed in **both** passes: the initial
auto-align (`alignLyrics` in `src/ai-pipeline/contentAligner.ts`) and the
"Accurate readings" re-align (`refineAlignmentWithPhrases` in
`src/lyrics/phraseAlignment.ts`). The main known-bad example is
**STRANGER THAN HEAVEN** (Snoop Dogg / 藤原聡 / Ado / Tori Kelly), a heavily
mixed JP+EN song.

## Goal

Across a corpus of popular Japanese and mixed-language songs, line start/end
times must track the sung audio closely enough that users get correct anchors:
no line ends noticeably early (cutting off the sung tail) or late (bleeding
into the next line), in either alignment pass.

## Decisions from interview

- **Audio source:** user-provided MP3s (already in `~/Downloads`); audio is
  never committed. Transcripts are generated once and committed as fixtures.
- **Ground truth:** heuristic metrics only — no hand-labeled timestamps.
- **Scope:** test **and fix** in this effort, guarded by the corpus baseline.
- **Mixed lyrics priority:** full English lines interleaved with Japanese
  lines (Stranger than Heaven is the reference case).
- **Lyrics:** pasted by user, cleaned of Genius artifacts, committed as
  fixture text files (matches existing fixture practice).

## Approach

Extend the existing deterministic corpus instrument
(`scripts/audit-corpus.mjs` + `tests/ai-pipeline/fixtures/corpus.json` +
baseline CI guard) rather than building a new harness.

### 1. Corpus expansion

Add to `corpus.json` (transcripts produced by one real Whisper run per song
per timestamp mode via `scripts/audit-auto-align.mjs`, then sanitized and
committed):

| Song | Language | Modes | Source |
|---|---|---|---|
| stranger-than-heaven | mixed ja+en | word + segment | `~/Downloads/stranger-than-heaven-theme-song-…mp3` (cached segment transcript exists in `.cache/auto-align-audit/`) |
| guitar-loneliness | ja | word + segment | `~/Downloads/guitar-loneliness-and-blue-planet-…mp3` |
| ~~akfg-rocknroll~~ | — | — | dropped during implementation: all cached `UserRockRoll_*` / `RockRoll` transcripts turned out to be byte-identical to the committed FirstTake fixtures (commit 2e82e1b), adding no coverage |

Existing entries (veil, akfg-firsttake ×2, my-eyes-only) stay unchanged.
Lyrics fixtures already added:
`tests/ai-pipeline/fixtures/stranger-than-heaven/lyrics.txt`,
`tests/ai-pipeline/fixtures/guitar-loneliness/lyrics.ja.txt`.

Note: the Stranger than Heaven MP3 may be a trailer/theme cut while the
pasted lyrics are the full song; the harness must report unmatched trailing
lyric lines as a distinct category (lyrics-beyond-audio) rather than counting
them as alignment failures.

### 2. Boundary metrics (new scorecard columns)

Added to `scripts/audit-corpus.mjs`, computed per song **and per pass**:

- **early-end count:** lines whose end time is > 0.35 s before the end of the
  last transcript word matched to that line (the "cut off early" defect).
- **late-end count:** lines whose end time overlaps transcript words matched
  to the *following* line (the "runs long" defect).
- **mid-word boundaries:** line starts/ends landing strictly inside a
  transcript word's span.
- **gap distribution:** p50/p95 of inter-line gap (next start − this end);
  negative values are overlaps.
- Existing metrics (unmatched lines, low-confidence lines, reading errors,
  pairing metrics) unchanged.

Metrics count only well-matched lines (lines with an LCS/coverage match to
transcript words); unmatched lines are reported separately as today.

### 3. Per-pass attribution

Each song is scored twice per transcript mode:

1. **Pass A — initial auto-align:** raw `alignLyrics` output.
2. **Pass B — accurate re-align:** after `refineAlignmentWithPhrases`.

The scorecard shows both columns side by side so every boundary defect is
attributed: introduced by A and not repaired by B, repaired by B, or
introduced by B.

### 4. Fix loop

1. Run the expanded scorecard; rank defect classes by frequency × severity
   across the corpus.
2. For each class: write a failing fixture-based unit test first
   (TDD, in `tests/ai-pipeline/`), fix in `contentAligner.ts` /
   `phraseAlignment.ts` / related modules, confirm the test passes.
3. Re-run the full scorecard after each fix; no existing metric may regress.
4. When the success bar is met, `--write-baseline` and keep
   `--check-baseline` in CI (`corpus-scorecard.test.ts`) so future changes
   cannot silently regress boundaries.

## Success bar

On well-matched lines across the whole corpus, both passes:

- **zero** late-end overlaps into the next line's matched words;
- **zero** early-ends > 0.35 s;
- mixed JP+EN lines (Stranger than Heaven) match at a rate comparable to
  pure-JP songs (unmatched-line rate not more than ~1.5× the corpus median);
- no regression in any pre-existing scorecard metric.

If a residual defect is caused by Whisper transcript quality itself (missing
or mis-timed words) rather than alignment logic, it is documented in the
findings with evidence and excluded from the bar.

## Out of scope

- Whisper model or transcription changes.
- UI changes (re-align entry points, anchor editing UX).
- Hand-labeled ground-truth timing.
- Browser e2e automation (possible follow-up).

## Testing

- The scorecard itself is the primary instrument; it runs deterministically
  from committed fixtures (no audio, no Whisper) via
  `npx tsx scripts/audit-corpus.mjs`.
- Each fixed defect class gets a permanent unit test.
- CI guard: existing `corpus-scorecard.test.ts` baseline check extended with
  the new boundary metrics.
