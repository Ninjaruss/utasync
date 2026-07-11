# Two-Pass Bilingual Transcription Merge — Design Spec

**Date:** 2026-07-10
**Status:** Approved

## Goal

Recover the English sections of mixed JA/EN songs that a single forced-Japanese
transcription garbles. Whisper decoding English vocals under the Japanese
language token produces garbage ("Tore down the gates" → "Dream and a gaze"),
leaving those lines un-anchorable. The headroom experiment (findings
docs/superpowers/2026-07-10-webgpu-migration-findings.md and the round-3 findings
addendum) showed forced-**English** decoding on the existing small model recovers
those sections near-verbatim (the rap is exact; the otherwise-dead 160–198s
"Paved my way" region finally produces aligned English). This feature transcribes
mixed songs twice — once forced Japanese, once forced English — and merges the two
alignments per lyric line by language.

This is complementary to the whisper-medium "high accuracy" mode (which fixes the
verses/rap under a bigger model): two-pass specifically recovers the regions that
stay dead under forced-JA at any model size.

## Key property that shapes the design

Both passes transcribe the **same audio**, so their word timestamps are on a
**common clock** (a vocal at 100s is at 100s in either pass). Timeline
reconciliation — normally the hard part of merging two transcripts — is therefore
trivial: per-line selection produces already-comparable times, and the existing
monotonicity/redistribution passes clean up any rare crossings.

## Non-goals

- Per-chunk auto-language detection (ruled out: `@huggingface/transformers`
  long-form chunking truncates auto/omitted-language transcripts — see findings §C3).
- Combining two-pass with the medium model (two-pass always uses small; the
  medium high-accuracy toggle is a separate, single-pass lever).
- Languages beyond JA + EN (Latin-script lines are treated as English).
- Changing the core aligner (`refineAlignmentWithPhrases` is reused as a black box).

## Approach: align twice, select per line (Approach A)

Chosen over (B) merging transcripts before a single alignment — which needs
chicken-and-egg language-region detection and risks splice seams — and (C) a
dual-stream matcher — which is invasive to the just-stabilized core aligner.
Approach A treats the aligner as a black box, is fully corpus-testable, and
exploits the shared-clock property.

## Components

### 1. Mixed-sheet detection

`isMixedLanguageSheet(lineTexts: string[]): boolean` in
`src/ai-pipeline/whisperLanguage.ts` (the earlier cut-C3 helper, now built):
true when the sheet has ≥3 substantial lines of each script — JA-script lines
(`/[぀-ヿ㐀-鿿]/`) and Latin lines (≥3 `[A-Za-z']+` words). Drives whether the UI
toggle is shown and defaulted on. Single-language sheets never two-pass.

### 2. Two transcriptions

When two-pass is active, `AutoAlignFlow` calls `transcribeAudio` twice, both on
the small model:
- Pass J: `{ language: 'japanese', timestampMode: <existing choice> }`
- Pass E: `{ language: 'english', timestampMode: <same> }`

Progress UI reflects two transcription passes (e.g. "Transcribing (pass 1/2)…").
Reuse the existing per-pass progress plumbing; the second pass reuses the warm
worker (same small model, so the model-reload guard is a no-op between passes).

### 3. Two alignments

Run the existing `refineAlignmentWithPhrases(sheetRows, wordsJ, sourceLanguage)`
and `refineAlignmentWithPhrases(sheetRows, wordsE, sourceLanguage)` — same sheet,
same `sourceLanguage` (the song's primary, typically 'ja'), different transcripts.
Alignment J anchors the JA lines well and garbles the EN lines; alignment E does
the reverse.

### 4. Per-line merge (new pure unit)

`mergeBilingualAlignments(sheetRows, alignJ, alignE)` →
`RefinedAlignment` (same shape the pipeline already returns), in a new file
`src/lyrics/bilingualMerge.ts`:

- For each sheet line index i, choose the source alignment:
  - **By script (primary):** JA-script line → alignment J; Latin-script line →
    alignment E; a line with neither (interjection/blank) → J (the sourceLanguage
    pass).
  - **Quality tie-break:** if the script-selected pass rates the line
    `needs_review` but the other pass rates it `good`/`approximate` with higher
    coverage, take the other pass. (Handles a mostly-JA line with an inline
    English word, or a mis-detected script.) Coverage/quality come from the
    per-line `lineAlignmentQuality` the aligner already returns.
  - Carry that line's `startTime`/`endTime`, `lineAlignmentQuality`,
    `anchorSources` from the chosen pass.
- Each per-pass `refineAlignmentWithPhrases` result already carries final,
  redistributed times (redistribution/quality is the tail of that function). So
  the merge only needs to: (a) select per line, (b) run the exported
  `enforceLineMonotonicity` on the stitched lines, then (c) run the exported
  `redistributeDegenerateRuns` once over the stitched lines to smooth any new
  degeneracy created at pass-selection boundaries (two adjacent lines taken from
  different passes can leave a gap/overlap). No re-running of the whole aligner.
- Phrases: rebuild the sung-phrase layer from the merged lines using the same
  `syncPhrasesFromValidatedLines` the single-pass path already uses.

### 5. UI

A "Mixed-language (JA+EN) — slower" toggle in `src/ai-pipeline/AutoAlignFlow.tsx`,
mirroring the vocal-separation/high-accuracy toggle pattern:
- Shown only when `isMixedLanguageSheet(sheet lines)`.
- **Default ON** when shown (user can turn it off to save time).
- When on, the flow does the two-transcription + merge path; when off, the
  existing single-pass path.
- Independent of the high-accuracy toggle. Two-pass **always uses the small
  model**. While two-pass is active, the high-accuracy (medium) toggle has no
  effect on transcription (they target different problems, and 2× medium is out
  of scope); to keep this unambiguous in the UI, the high-accuracy toggle is
  disabled with a short note ("uses small model in mixed-language mode") whenever
  the mixed-language toggle is on.

## Data flow

sheet + audio → [mixed?] → yes: transcribe J + transcribe E → align J + align E →
`mergeBilingualAlignments` → merged `RefinedAlignment` → `applyRefinedAlignment`
→ stored lyrics. No: existing single-pass path unchanged.

## Error handling

- If the English pass fails (network/model), fall back to the single JA-pass
  result rather than failing the whole align — the song still gets JA-line timing.
- If detection is wrong (sheet not actually mixed), the toggle simply isn't shown
  and nothing changes.
- Blank/interjection lines default to the JA pass; never dropped.
- The merge is a pure function: empty/degenerate inputs return the JA alignment
  unchanged (no throw).

## Testing

- `scripts/audit-corpus.mjs` is the harness. Add a stranger-than-heaven two-pass
  fixture: commit the forced-English small transcript alongside the existing
  forced-JA one, add a corpus variant that runs the merge, and assert the EN
  sections' `bnd_measured` improves materially vs the single-pass forced-JA row,
  with **zero regression** on the pure-language songs (veil, akfg, my-eyes-only,
  guitar-loneliness) and on the JA lines of stranger.
- Unit tests for `isMixedLanguageSheet` (mixed vs JA-with-a-hook vs pure-EN) and
  `mergeBilingualAlignments` (script selection, quality tie-break, monotonicity,
  JA-pass fallback on EN-pass failure, pure-input no-op).
- The forced-English transcript is generated offline via
  `scripts/transcribe-file.mjs --language english` and committed as a fixture, so
  corpus audits stay MP3-free/deterministic.

## Sequencing note

Detection + merge unit (pure, corpus-testable) land before the UI/transcription
wiring, so the accuracy win is proven on committed fixtures before touching the
live two-transcription flow.
