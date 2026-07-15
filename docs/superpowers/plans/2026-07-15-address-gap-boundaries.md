# Round 9 — Address Round-8 Boundaries Implementation Plan

> Approved by user. B1 = **Both** (auto-run once + manual button). B2 = **build the guarded lyric-prompt biasing**. Design basis: two feasibility investigations (re-refine gap recovery; prompt-biasing hatch) summarized below.

**Goal:** Lift round-8's two honest limits — (B1) gap recovery is fresh-Auto-align only; (B2) no lyric prompt-biasing — plus ship round-7's placement fixes to stored songs.

**Safety carryover:** every gap re-transcription still goes through round-8's accept-if-better (`spliceGapAlignment`): accepted only if fewer `needs_review` AND placement-aware coverage doesn't regress → can NEVER worsen a song. This is what makes B1 (running on stored songs) and B2 (undocumented prompt hatch) both safe: a bad re-transcription is rejected byte-identical.

**Branch:** `gap-retranscription`. Commits `--no-gpg-sign`. Two-stage review (spec+quality) per task. No committed debug logging.

---

## Verified facts (implementers rely on these; cite the investigations)

- `reanalyzeGaps` (src/ai-pipeline/gapReanalyze.ts) is audio-agnostic: takes an injected `transcribeSlice(t0,t1,lang)=>Promise<TranscriptWord[]>` (absolute-time words). Caps MAX_GAP_PASSES=2, MAX_HOLES_PER_PASS=4, MAX_SLICE_S=30, retry-once.
- Re-refine site: PlayerView.tsx ~437-456 (`shouldRefineStoredAlignment` → refine → `applyRefinedAlignment`+db.put); same effect loads audio: `getAudioFile(s.id)` ~471, `engine.load` ~473. `willAutoAlign` ~487.
- `decodeAudioFileToMono(file)` (src/core/audio/decodeToMono.ts) → {data:Float32Array, sampleRate}; reusable outside AutoAlignFlow. `getAudioFile` (src/core/opfs/audio.ts).
- **ALIGNMENT_PIPELINE_VERSION = 20** (phraseAlignment.ts:25, set round 6, never bumped). `shouldRefineStoredAlignment` returns true only when stored version < 20, so v20 songs (round-6-onward) NEVER re-refine on open. Gap-recovery trigger MUST be version-independent; and round-7 fixes don't reach v20 songs (→ R9-4 bump).
- `applyRefinedAlignment` (phraseAlignment.ts ~1398) does NOT carry transcriptWords — caller must pass `{...lyrics, transcriptWords: recovered}` or recovered words are dropped (AutoAlignFlow.tsx ~400 does this).
- AutoAlignFlow's slice closure (AutoAlignFlow.tsx ~357-376) wraps `transcribeWithFallback` (~264-296, crash-downgrade ladder, already accepts an arbitrary buffer). Extractable.
- B2 hatch: the ASR pipeline forwards kwargs to `model.generate`, which honors `decoder_input_ids` (works in installed 3.8.1; no released version wires `prompt_ids` — it's a stub even in 4.2.0; upgrading does NOT unlock WebGPU, issue #1590 open — so DEFER upgrade). Call path: transcribeAudio opt → whisper.worker.ts `asr(resampled, {...})` (~95/121) → `_call_whisper` `generation_config={...kwargs}` → `generate()` reads `kwargs.decoder_input_ids`. Token pieces on the pipeline object: `asr.tokenizer.model.convert_tokens_to_ids(['<|startofprev|>','<|notimestamps|>'])`, `asr.model.generation_config.{decoder_start_token_id, lang_to_id['<|ja|>'], task_to_id['transcribe'], no_timestamps_token_id}`, `asr.tokenizer.encode(text,{add_special_tokens:false})`. Segment mode only for prompted slices (word-mode prompt-prefix trim missing in 3.8.1 → phantom words).

---

## Task R9-1 — extract shared createSliceTranscriber (refactor, behavior-identical)

New `src/ai-pipeline/sliceTranscriber.ts`:
```
createSliceTranscriber({ audioData, sampleRate, isCancelled, highAccuracy,
  timestampMode, onLoadProgress?, onTranscribeProgress? })
  => { transcribe(t0, t1, lang): Promise<TranscriptWord[]> }
```
Holds the mutable crash-ladder state (effectiveTimestampMode/effectiveHighAccuracy) internally; does `subarray(floor(t0*sr),floor(t1*sr))` → `transcribeAudio` (via the transcribeWithFallback ladder) → `toWords` → `+t0` → `sanitizeTranscript`. AutoAlignFlow constructs one after its main pass and passes `.transcribe` as reanalyzeGaps's transcribeSlice, DELETING the inline closure (net line reduction). Behavior-identical: audit-vs-lrc byte-identical, AutoAlignFlow.* tests green. Unit-test the helper with a mocked transcribeAudio (slice window + offset). TDD.

## Task R9-2 (B1) — stored-song gap recovery: auto-once + manual button

**Persisted field:** add `gapRecoveryVersion?: number` to LyricsData (core/types) + a `GAP_RECOVERY_VERSION` const (start 1). This is SEPARATE from ALIGNMENT_PIPELINE_VERSION.

**Reconstruct-refined helper** (pure): build a `RefinedAlignment` view from stored lyrics fields (lines, phrases, lineAlignmentQuality, anchorSources, confidence, mode, phraseLayout, sheetLinesSnapshot, report-stub) — all persisted. `enumerateGapHoles` reads only lines+lineAlignmentQuality; `spliceGapAlignment` needs phrases/anchorSources (stored).

**Shared recovery routine** `recoverGapsForStoredSong(song, {isCancelled, onProgress})`: decode audio → createSliceTranscriber → reanalyzeGaps(reconstructed refined, stored transcriptWords, sheetRowsForAlignment(lyrics), detectSheetLanguage, sourceLanguage, transcribeSlice, refineOpts:{lyricsBase:lyrics}) → returns {lyrics: applyRefinedAlignment({...lyrics, transcriptWords: recovered}, refined) with gapRecoveryVersion stamped, filledCount}. Guard: 0 holes worth retrying OR no audio → no-op (skip decode/model-load).

**AUTO (once):** in PlayerView enrichment effect, when `!willAutoAlign` AND audio present AND `(lyrics.gapRecoveryVersion ?? 0) < GAP_RECOVERY_VERSION` AND enumerateGapHoles(reconstructed).filter(worthRetrying).length>0 → run recoverGapsForStoredSong, persist result (INCLUDING gapRecoveryVersion even if filledCount===0, so it doesn't churn). Cancel-aware. Mixed songs INCLUDED (accept-if-better protects). Runs after/independent of the version-gated re-refine block.

**MANUAL:** EditMode off-timing banner gains a "Recover N sections" action (shown when hasLocalAudio && recoverableHoleCount>0; recoverableHoleCount derived like offTimingCount from stored lines+quality+transcriptWords). Clicking runs recoverGapsForStoredSong (re-attempt even if gapRecoveryVersion current — manual overrides the once-guard), shows the "Recovering N…" progress, persists, refreshes lines.

Tests: reconstruct-refined round-trips; recoverGapsForStoredSong with mocked transcribeSlice fills a hole + persists transcriptWords+gapRecoveryVersion (and garbage → byte-identical, gapRecoveryVersion still stamped); auto-once fires only when under-version+holes+audio+!willAutoAlign and stamps version; manual button derives count + re-runs. Component test for the banner action if practical.

## Task R9-3 (B2) — lyric-prompt biasing via decoder_input_ids

- transcribeSlice/createSliceTranscriber gains an optional `promptText?: string` per call (the hole's sheet lines joined). When present AND segment-mode: pass `promptText` through transcribeAudio → worker payload → the `asr(...)` options as `decoder_input_ids` assembled by a worker helper `buildWhisperPrompt(asr, promptText, lang, task, timestampMode)` that reads the token pieces listed in Verified facts. FEATURE-GATE: if any required internal (tokenizer.model.convert_tokens_to_ids / generation_config ids) is absent, log-once and fall back to the unprompted slice (no decoder_input_ids). Cap prompt to Whisper's 448-token context (holes ≤4 lines, tiny).
- reanalyzeGaps passes each hole's sheet text (sheetTexts.slice(from,to+1).join(' ')) to transcribeSlice as promptText; force SEGMENT timestamps for prompted slices (override the inherited mode for the prompted path).
- Safety: accept-if-better already rejects a prompt-echo hallucination (low placed-coverage) → byte-identical. No new safety code needed; add a test that a prompt-echo mock (right words, wrong times) is rejected.
- Tests: buildWhisperPrompt assembles the expected id sequence from a stubbed asr (mock tokenizer/generation_config); feature-gate falls back when internals absent; the prompt is threaded through the worker payload (mock transcribeAudio asserts it received decoder_input_ids/promptText); prompt-echo → rejected byte-identical.
- Whisper-worker unit-testability: the worker isn't easily unit-tested; test buildWhisperPrompt as a pure exported helper + assert the payload plumbing at the transcribeAudio boundary.

## Task R9-4 — version bump 20→21

Bump ALIGNMENT_PIPELINE_VERSION to 21 (phraseAlignment.ts:25) so shouldRefineStoredAlignment re-refines v20 non-mixed auto songs on open, applying round-7 placement fixes (run-coverage gate + tail cap are in the refine path). Single-pass, no Whisper — cheap. Update the version-gate test + any snapshot. Confirm mixed guard still holds (mixed v20 songs still skip re-refine, get the needsMixedRealign nudge + now the manual Recover button). This is INDEPENDENT of gapRecoveryVersion.

## Task R9-5 — verify + report + PR

- Full `npx vitest run --exclude "**/.claude/**"` green; tsc clean; audit-corpus --check-baseline unchanged (additive); audit-vs-lrc byte-identical (R9-1/2/3 don't change the refine math; R9-4 bump doesn't change audit scripts which call refine directly).
- Append "Round 9 — addressing the boundaries" to docs/superpowers/audits/2026-07-14-approx-run-diagnosis.md: B1 stored recovery (auto-once via gapRecoveryVersion + manual button, version-independent, mixed included), B2 guarded lyric-prompt biasing (decoder_input_ids hatch, feature-gated, segment-mode, safe via accept-if-better), R9-4 version bump (round-7 fixes to stored songs), and the DEFERRED library upgrade with the concrete trigger (watch transformers.js issue #1590; upgrade unlocks WebGPU + WASM timestamp accuracy but NOT prompt_ids).
- Push; open PR (base accuracy-audit-round5 stacked, or main if #14 merged — check).

## Rules (all tasks)
- TDD; reuse existing helpers; evidence-gated; accept-if-better is the safety net (don't weaken it). No committed debug logging. Behavior-identical refactor (R9-1) and additive features (R9-2/3) must keep audit scripts byte-identical. BLOCKED beats guessing about worker/pipeline internals — read the dist.
