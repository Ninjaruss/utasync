# Gap-Targeted Re-Transcription (Round 8) Implementation Plan

> Feature approved by user ("build the MVP now" — levers 1+2: clean ≤30s slice + forced language; NOT lever 3 model-swap, NOT lever 4 prompt-biasing which the installed transformers.js v3.8.1 can't cleanly do). Design basis: the two feasibility investigations (Whisper slice/prompt/tier + alignment architecture) summarized below.

**Goal:** When the aligner leaves a HOLE (a run of un-anchored lyric lines between two good anchors) even though the vocals are audible, re-transcribe just that audio window (short forced-language slice — sidesteps the long-form chunking/language-flapping bugs) and re-align the gap, keeping the result only if it improves. Fresh-Auto-align only (re-refine has no audio).

**Safety invariant:** the pass can NEVER make a song worse. Each gap re-transcription is accepted only if it strictly reduces the un-anchored (`needs_review`) count over the gap; otherwise the round-7 honest spread is kept. Surrounding good anchors are never in the splice range.

**Composition:** strictly additive on top of rounds 6/7. The round-7 run-coverage gate becomes both the hole "worth retrying" filter and the accept-if-better baseline; round-6/7 remain the graceful-degradation floor when a retry fails.

---

## Feasibility facts (verified — implementers rely on these)

- `transcribeAudio(audioData: Float32Array, sampleRate, opts)` (whisperTranscriber.ts) transcribes any buffer. Slice via `audioData.subarray(Math.floor(t0*sr), Math.floor(t1*sr))` (precedent: whisper.worker.ts:93). Returned chunk timestamps are slice-relative → add `t0` back.
- A **≤30s** single-window slice with a **forced language** takes the single-`generate` path — NO stride stitching, NO auto-language truncation (both documented long-form bugs avoided). Keep slices ≤ CHUNK_LENGTH_S (30). >30s re-enters multi-chunk stride path — avoid.
- Worker stays warm across calls (module singleton, 3-min idle release); same model tier ⇒ no reload between slices. MVP uses the SAME tier/highAccuracy as the main pass (no model swap).
- `highAccuracy`/medium forces segment timestamps (word mode hallucinates on medium) — MVP inherits the main pass's timestampMode, so this pairing is respected automatically.
- Re-refine path (PlayerView) has NO audioData — gap pass is fresh-Auto-align-only. Songs aligned WITH the pass persist the improved gap words in `transcriptWords`, so the benefit survives to playback.

Key source anchors: AutoAlignFlow.tsx start() ~132-348 (audioData 136, sampleRate 137, sheetRows 202, refined 319/333, transcriptWords 321/332, transcribeWithFallback 260, alignmentLanguage 203, store 340-348); RefinedAlignment interface phraseAlignment.ts:1921; refineAlignmentWithPhrases :1938; enforceLineMonotonicity :300; syncPhrasesFromValidatedLines :1827; mergeMixedTranscripts splice pattern mixedLanguageAlign.ts:176-193; run-coverage gate + findActivityRegions redistributeDegenerateRuns.ts:255-273 / lineDegeneracy.ts:64; LineAlignmentQuality core/types:82.

---

## Task G1 — pure gap-splice core (corpus-testable, low-risk)

New module `src/lyrics/gapRealign.ts` (keep it separate from phraseAlignment to stay focused/testable). Pure functions only — no audio, no Whisper.

**G1a. `enumerateGapHoles(refined): GapHole[]`** where `GapHole = { from, to, t0, t1 }`.
- Walk `refined.lineAlignmentQuality` for maximal runs of `needs_review` bounded by non-`needs_review` (`good`/`approximate`) anchors.
- `from`/`to` = run bounds (line indices); `anchorBefore = lines[from-1]`, `anchorAfter = lines[to+1]`.
- `t0 = anchorBefore?.endTime ?? 0`, `t1 = anchorAfter?.startTime ?? lastLineEnd`. Clamp t1 so `t1 - t0` is a sane window; if a hole window exceeds ~30s, the orchestrator (G2) will sub-window it — G1 just reports the [t0,t1] bounds and indices.
- Skip a run whose lines are all blank/interjection (already upgraded out of needs_review, but guard anyway).

**G1b. `holeWorthRetrying(hole, currentTranscriptWords): boolean`** — reuse the round-7 run-coverage computation: over `[t0,t1]`, current transcript run-coverage of the hole's line texts is LOW (< RUN_COVERAGE_MIN) — i.e. the sheet expects lyrics but the current transcript doesn't corroborate them there. (This is implied by needs_review; the value is also the BEFORE baseline for accept-if-better.) Return false for windows too short to bother (< ~4s).

**G1c. `spliceGapAlignment(refined, transcriptWords, sheetRows, from, to, gapWords, lang): { refined, transcriptWords, accepted }`** — pure:
1. `sub = refineAlignmentWithPhrases(sheetRows.slice(from, to+1), gapWords, lang, /* opts as the main call uses */)`.
2. Build candidate: splice `sub.lines`, `sub.lineAlignmentQuality`, `sub.anchorSources` into copies of `refined.*` at `[from..to]`.
3. Clamp: candidate `lines[from].startTime = max(startTime, anchorBefore.endTime)`, `lines[to].endTime = min(endTime, anchorAfter.startTime)`; then `enforceLineMonotonicity(candidate.lines)` over the whole array.
4. **Accept-if-better:** count `needs_review` over `[from..to]` in candidate vs current `refined`. Accept only if strictly fewer (tie-break: higher hole run-coverage against gapWords). If rejected, return `{ refined, transcriptWords, accepted: false }` unchanged.
5. On accept: transcript region-splice `transcriptWords = [...filter(w => w.endTime <= t0 || w.startTime >= t1), ...sanitizeTranscript(gapWords)]` re-sorted; `syncPhrasesFromValidatedLines(candidate.phrases, candidate.lines)`; return `{ refined: candidate, transcriptWords, accepted: true }`.

**Tests (tests/lyrics/gapRealign.test.ts + a corpus-style fixture test):**
- enumerateGapHoles finds a synthetic needs_review run bounded by anchors; ignores fully-good alignments.
- spliceGapAlignment: given a "bad" refined (gap lines needs_review, mis-placed) + a clean `gapWords` transcript for the window, the spliced result anchors the gap lines (fewer needs_review, within window, monotonic, anchors untouched) and is ACCEPTED. Negative: given gapWords that DON'T match (still garbled), the splice is REJECTED and refined is byte-identical.
- Reuse a committed fixture pair: a garbled global transcript (round-7's akfg garbled/instrumental fixture is a candidate) + a committed clean gap re-transcript JSON; assert the gap lines improve. This is fully deterministic (no Whisper).
- Gates: `npx vitest run tests/lyrics/ tests/ai-pipeline/ --exclude "**/.claude/**"` green; `npx tsx scripts/audit-corpus.mjs --check-baseline` UNCHANGED (G1 adds a module + tests, doesn't touch the main align path or any corpus row); `npx tsx scripts/audit-vs-lrc.mjs` byte-identical; tsc clean.

---

## Task G2 — AutoAlignFlow orchestration (integration-tested)

Wire G1 into the fresh-align path. New surface: audio slicing + a slice-transcribe variant + the loop.

- Insertion: AutoAlignFlow.start(), AFTER `refined`/`transcriptWords` are assigned (~line 339) and BEFORE `updated`/`db.put` (340). Gated on `audioData` present (always true on fresh align).
- `transcribeSlice(t0, t1)`: `audioData.subarray(floor(t0*sr), floor(t1*sr))` → `transcribeAudio(slice, sr, { ...transcribeOptions, language: forcedLangForRegion })` → `toWords()` → offset `+t0`. Force the region language: default to `alignmentLanguage` (or 'ja'/'en' if the sheet lines in the hole are single-script — reuse detectSheetLanguage over the hole's sheet texts; MVP may just use the main `alignmentLanguage`, note the choice). Keep the `transcribeWithFallback` crash-downgrade wrapper for slices.
- Loop: `for pass in 0..MAX_GAP_PASSES(2)`: `holes = enumerateGapHoles(refined).filter(holeWorthRetrying).slice(0, MAX_HOLES_PER_PASS(4))`; for each hole, sub-window to ≤30s if needed, `gapWords = await transcribeSlice(...)`, `{refined, transcriptWords, accepted} = spliceGapAlignment(...)`; track retried ranges (retry a range at most once); break the outer loop if no splice accepted this pass or total needs_review didn't decrease. Respect `cancelledRef`.
- Progress UI: surface a "recovering N sections…" phase (reuse existing setStage/setProgress; don't invent heavy UI).
- Integration test (tests/ai-pipeline/ or tests/player/): mock `transcribeAudio` to return a clean gap transcript for the slice window; assert the flow calls it for the detected hole, splices, and persists the improved alignment; assert it does NOT fire when there are no holes; assert accept-if-better rejects a mock that returns garbage.
- Gates: suites green; audit scripts byte-identical (the orchestration only runs in the app path, not in audit-corpus/audit-vs-lrc which call refine directly); tsc clean.

---

## Task G3 — fixture + verify + report + PR

- Commit a deterministic "gap re-transcript" fixture (generator, like make-garbled-fixture.mjs) so G1's corpus test has a permanent clean-gap input paired with the garbled global transcript. Optionally a corpus row exercising accept-if-better.
- Re-baseline only if a committed corpus row was added (G1/G2 shouldn't move existing rows).
- Full `npx vitest run --exclude "**/.claude/**"`; tsc; audit scripts final table.
- Append a round-8 section to docs/superpowers/audits/2026-07-14-approx-run-diagnosis.md: the feature, levers used (1+2), the deferred lever-4 (prompt-biasing awaits transformers.js upgrade), fresh-align-only limit, the accept-if-better safety invariant, browser spot-check still open.
- Push; open a new PR to main (round-7 is PR #14; this stacks after or targets main once #14 merges — check topology).

---

## Rules (all tasks)
- TDD; reuse existing helpers (refineAlignmentWithPhrases, enforceLineMonotonicity, syncPhrasesFromValidatedLines, run-coverage, findActivityRegions) — don't reinvent. Evidence-gated. No committed debug logging. Commits --no-gpg-sign. Two-stage review (spec + quality) per task.
- The accept-if-better guard is mandatory and must be tested (a garbage re-transcript must be rejected, leaving output byte-identical).
