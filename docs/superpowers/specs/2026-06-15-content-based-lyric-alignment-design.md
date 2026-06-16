# Content-Based Lyric Alignment — Design

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan

## Problem

Auto-align maps a Whisper word-level transcript onto lyric lines. The current
`alignTranscriptToLines` distributes lines *proportionally* by an estimated
token weight, then reads real timestamps from the assigned word slice. It never
looks at whether transcript content actually matches the lyrics.

Measured on a real song (Persona 4 "My Eyes Only", a mixed Japanese/English
track) against ground-truth sung times read off the Whisper timeline:

| Method | Mean absolute error |
|---|---|
| Proportional, char-weight (original) | 4.15 s |
| Proportional, token-weight (shipped fix) | 2.91 s |
| **Content-based (LCS) prototype** | **0.53 s** |

The transcript genuinely resembles the lyrics (Whisper transcribes both the
sung Japanese and sung English), so matching content to content and reading the
matched word's real timestamp is dramatically more accurate than any
proportional distribution. This design promotes content-based alignment to the
primary method, keeping the proportional method as a fallback.

## Goals

- Primary alignment by matching transcript content to lyric content.
- Keep proportional alignment as an automatic fallback when content match is weak.
- Surface a confidence signal; warn the user when we fall back.
- Hold content-mode accuracy under 1.0 s MAE on the captured benchmark.

## Non-goals

- Audio re-analysis / vocal-activity detection (VAD).
- Changing the Whisper worker or transcription parameters.
- Per-word (intra-line) highlighting. Lines remain the alignment unit.

## Architecture

### New module: `src/ai-pipeline/contentAligner.ts`

```
alignByContent(
  lineTexts: string[],
  words: TranscriptWord[],
  existingLines: TimedLine[] | undefined,
  sourceLanguage: Language,
): { lines: TimedLine[]; confidence: number }
```

Algorithm (approach A — LCS anchor + interpolate):

1. **Normalize** both sides to a comparable character stream: lowercase, keep
   Latin letters `[a-z]` and Japanese characters (kana + kanji), drop
   whitespace/punctuation/other.
2. **Build streams.**
   - Lyric stream: each kept char tagged with its line index.
   - Transcript stream: each kept char tagged with a time interpolated across
     its word's `[startTime, endTime]`.
3. **LCS DP** over the two char streams (`O(L·T)`, ~200×240 here) to obtain a
   monotonic set of matched `(lyricChar, transcriptChar)` pairs.
4. **Anchor** each line to the earliest matched transcript time among its chars.
5. **Robustify** (handles repeated refrain lines that LCS can match to the wrong
   copy): drop anchors that decrease vs. the previous kept anchor or deviate
   sharply from the local monotonic trend; the dropped lines are interpolated.
6. **Interpolate** unanchored lines between neighboring anchors, distributing by
   the token weight from the proportional method (`weightOf`). Leading lines
   scale from 0; trailing lines hold the last anchor.
7. **Rests / `endTime`**: reuse the existing clamping — a line ends at its own
   last matched/sliced word, never overlapping the next line's start.

`confidence` = fraction of lyric characters that were matched (coverage), in
`[0, 1]`.

### Orchestration: `alignLyrics` (in `aligner.ts`)

```
alignLyrics(lineTexts, words, existingLines, sourceLanguage)
  -> { lines: TimedLine[]; mode: 'content' | 'proportional'; confidence: number }
```

1. `sanitizeTranscript(words)` (existing).
2. `alignByContent(...)`.
3. If `confidence >= CONTENT_CONFIDENCE_THRESHOLD` (default `0.5`, tunable
   against the benchmark) → use content lines, `mode: 'content'`.
4. Else → `alignTranscriptToLines(...)` (existing proportional), `mode:
   'proportional'`.
5. Return lines + mode + confidence.

The existing `alignTranscriptToLines` and `sanitizeTranscript` are unchanged;
they become the fallback path and a shared preprocessing step.

### Data flow & UI

- `AutoAlignFlow.tsx` calls `alignLyrics` instead of `alignTranscriptToLines`.
- Persist `confidence` on the song via a new optional field
  `LyricsData.alignmentConfidence?: number`.
- When `mode === 'proportional'` (we fell back), the done screen shows a warning:
  *"Alignment is approximate — the audio didn't closely match these lyrics.
  Consider tap-sync or double-checking your lyrics."*
- No change to the highlighter; it keys off `startTime` as today.

## Error handling / edge cases

- **Empty transcript or empty lyrics** → existing untimed-lines behavior.
- **Zero content match** (instrumental, wrong lyrics) → `confidence` ≈ 0 →
  proportional fallback + warning.
- **Repeated lines** → robustify pass drops mis-matched anchors; interpolation
  fills them monotonically.
- **Transcript hallucinations** → already removed by `sanitizeTranscript` before
  either path runs.

## Testing

Unit tests (`tests/ai-pipeline/contentAligner.test.ts`):
- Exact-match synthetic transcript → near-zero error, high confidence.
- Repeated refrain lines → monotonic, no wrong-copy jump.
- Partial match → reasonable anchors + interpolation.
- Zero match → low confidence (drives fallback).

Regression benchmark (`tests/ai-pipeline/alignment-benchmark.test.ts`):
- Check in the captured real transcript (`fixtures/my-eyes-only.transcript.json`),
  the lyrics, and ground-truth start times.
- Assert `alignLyrics` selects `content` mode and MAE < 1.0 s. Locks in 0.53 s.

## Open/tunable items

- `CONTENT_CONFIDENCE_THRESHOLD` default `0.5`; tune against the benchmark and
  a low-match synthetic case so real songs pick content and junk picks fallback.
- Robustify outlier rule (backward + local-trend deviation); thresholds tuned on
  the benchmark.
