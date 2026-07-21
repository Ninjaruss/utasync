# Acoustic Vocal-Activity Signal for the Aligner — Design

**Date:** 2026-07-17
**Goal:** Give the lyric aligner an acoustic prior about *where vocals actually are*, so it stops confidently placing lyrics on non-vocal audio (intros, instrumental breaks, Whisper break-hallucinations), snaps line starts to real vocal onsets, and honestly de-rates placements the audio disagrees with. This is the structural fix for the false-positive classes that 12 rounds of text-only tuning have proven **text-undetectable**.

**Why now / context:** `alignLyrics(lineTexts, words, existingLines, sourceLanguage, options)` is purely lexical — it matches Whisper transcript words to sheet text; audio never enters alignment. Every prior audit ([[label-honesty-round11]], [[placement-round7]], [[density-regime-gate-round12]], [[line-boundary-accuracy-status]]) concludes the residual false positives (song intros, instrumental breaks, ±1.5–3s onset "class-B" skews, repeated-chorus mis-anchors) need an acoustic signal. The decoded mono PCM **is already available at align time** in `AutoAlignFlow` (`audioData`, reassigned to the **Demucs vocal stem** when vocal separation is on, line ~201/219) — it is simply never threaded into the aligner.

**Decisions (user-confirmed):**
- **Direction:** add an acoustic vocal-activity + onset signal (over continued text-only heuristics, which hit the documented ceiling — especially on the user's regime: from-scratch pasted lyrics, English, and messy/live audio).
- **v1 scope (phased):** ship the signal + **placement rejection** + **confidence recalibration** (the FP killers) first; **onset snapping** is phase 2.
- **Guardrail:** user runs a one-time script to derive committed vocal-activity envelopes for the corpus songs, so acoustic gating is CI-guarded (plus synthetic deterministic tests + the live e2e harness).

**Non-negotiable safety property:** when the signal is absent (stored-song re-refine, or compute failed) the aligner behaves **byte-identically to today**. On a raw mix the signal only **corroborates** the existing lexical gates (it makes an ambiguous rejection more confident); it must **never override a strong lexical match** — this bounds regression risk on the many mix-based alignments.

## Architecture

### 1. The signal — `src/ai-pipeline/vocalActivity.ts` (new, pure DSP)

`computeVocalActivity(pcm: Float32Array, sampleRate: number, opts: { source: 'stem' | 'mix' }): VocalActivitySignal`

```ts
interface VocalActivitySignal {
  hopSec: number            // frame period, ~0.03s (≈33 fps)
  activity: Float32Array    // 0..1 vocal-band energy per frame, robust-normalized
  onset: Float32Array       // 0..1 onset strength (half-wave-rectified spectral flux) per frame
  source: 'stem' | 'mix'    // provenance → how much the aligner trusts it
}
```

- **Framing / STFT:** ~30 ms hop, Hann window, magnitude spectrum via the existing `fft.ts` (STFT already lives there for Demucs).
- **Vocal-band energy:** sum magnitude over ~150 Hz–4 kHz (suppresses bass/kick/hi-hat), robust-normalize (divide by a high percentile, e.g. p95), log-compress → `activity` ∈ [0,1].
- **Onset strength:** half-wave-rectified spectral flux over the vocal band, smoothed → `onset`.
- **Determinism:** fixed FFT, no randomness → reproducible; safe for CI fixtures.
- **Size:** ~33 fps × 2 arrays × 5 min ≈ 40 KB (further downsamplable). Small enough to commit as a fixture and (future) persist per song.

Query helpers (pure): `voicedFraction(sig, startSec, endSec)`, `isVoiced(sig, tSec)`, `nearestOnset(sig, tSec, { before, after })`, `meanActivity(sig, startSec, endSec)`. Thresholds are module constants, tuned against the corpus envelopes.

### 2. Threading — `AlignLyricsOptions.vocalActivity?`

`AutoAlignFlow` computes the envelope right after decode/Demucs (uses the vocal stem when `willSeparate`, else the mix; passes `source` accordingly) and threads it through `alignLyrics` → `refineAlignmentWithPhrases` → `mixedLanguageAlign` (both inner passes forward it). Absent on stored re-refine and gap re-transcription (v1) → those keep today's behavior.

### 3. The three hooks (each a no-op when the signal is absent)

- **(a) Reject non-vocal placement [v1]** — augment the existing break/degenerate gates (`redistributeDegenerateRuns.ts` run-coverage/density gate; the round-12 `SAME_SCRIPT_DENSITY_MAX_ANCHORED_FRAC` split): when a candidate *confident* placement's window has `voicedFraction < LOW_VOICED_FRAC`, treat it as non-vocal → degrade to honest `approximate`/`needs_review` (never re-time). **Corroborate-don't-override:** on `source:'mix'` require strong evidence (sustained very-low activity) AND do not reject a line with strong lexical coverage; on `source:'stem'` the signal is decisive. This gives the fragile lexical density split (0.593 vs 0.633) an independent acoustic vote. → kills intro/break FPs + overconfidence.
- **(c) Confidence recalibration [v1]** — in `applyLabelHonesty` (`src/lyrics/labelHonesty.ts`), demote `good → approximate` (only; never re-time, never `needs_review`) when a confident line's attributed span disagrees acoustically (`voicedFraction` below a stricter threshold). Mixed inner passes still skip honesty (`skipLabelHonesty`); applied once on the merged result, as today. → overconfident labels.
- **(b) Onset snapping [phase 2]** — after placement, snap a line's start back to `nearestOnset(before)` when the current start sits in an activity dip and a clear onset is within tolerance (endTimes-preserving, like the existing `backfillLateStartsToMatchedSpan`). → wrong/late highlights + onset skews.

### 4. Guardrail / measurement (phase 1)

- **Synthetic deterministic tests** (`tests/ai-pipeline/vocalActivity.test.ts`, `tests/lyrics/acousticGate.test.ts`): generate PCM with known voiced (vocal-band tone/noise bursts), instrumental (out-of-band energy), and silent regions + a matching synthetic transcript; assert the envelope is correct and that a verse on silence/instrumental is rejected and (phase 2) an onset snaps. Committable, CI-safe, no copyrighted audio.
- **Real-derived corpus envelopes:** `scripts/make-vocal-activity.mjs <mp3> <out.json>` decodes + computes + writes `tests/ai-pipeline/fixtures/vocal-activity/<song>.json` (the ~40 KB energy curve — a lossy summary, **not** the audio, so not a copyrighted reproduction). User runs it once on the corpus MP3s they already have. To avoid touching the existing baselines, `audit-corpus.mjs` keeps its current **signal-absent** pass (existing metric rows unchanged, still ratcheted) and, **when an envelope fixture exists**, runs an *additional* acoustic-enabled pass that emits new acoustic columns — `acoustic_break_fp` (confident lines whose window is <LOW_VOICED_FRAC voiced) and, phase 2, `acoustic_onset_gap` (onset↔placed-start gap p50/p95) — plus the delta vs the signal-absent pass. The acoustic columns get their own baseline snapshot + ratchet; the pre-existing columns are untouched.
- **Live e2e:** extend `scripts/e2e-align.mjs` / `/?e2e=<song>` to run with/without the signal and report per-symptom deltas on local (gitignored) MP3s.

## Data flow

decode/Demucs (AutoAlignFlow) → `computeVocalActivity(audioData, sampleRate, {source})` → `AlignLyricsOptions.vocalActivity` → refine passes → hooks (a)/(c) [v1], (b) [phase 2] consult the signal → same `TimedLine[]` output shape (labels/starts adjusted only where the signal has strong evidence).

## Testing

- Unit: `computeVocalActivity` on synthetic PCM (voiced-band vs silence vs out-of-band → activity high/low/low; onset peaks at burst starts); query helpers.
- Integration: acoustic gate rejects a verse packed onto a synthetic silent region; does NOT reject a strongly-lexically-matched line even at low mix activity; `applyLabelHonesty` demotes a good line whose span is acoustically empty.
- Corpus: acoustic metrics computed from committed real-derived envelopes; ratchet guards no regression on existing metrics and improvement on acoustic-FP metrics for the break-hallucination fixture (`akfg-instrumental`, stranger).
- Regression: full suite green; existing corpus baselines byte-identical for runs **without** an envelope (signal-absent path unchanged).

## Safety / invariants

- Signal absent → aligner output identical to today (all existing tests + baselines unaffected; the corpus runs without envelopes by default, so existing metric rows are unchanged unless we add envelope-driven rows).
- Word pairer + reading paths untouched.
- Mix-source signal is corroborative only; never overrides strong lexical coverage → bounded regression risk.
- Deterministic DSP (no RNG) → reproducible fixtures.

## Scope

- **v1:** `vocalActivity.ts` + query helpers; thread through `AlignLyricsOptions`/`AutoAlignFlow`/mixed passes; hook (a) placement rejection; hook (c) confidence recalibration; synthetic tests; `make-vocal-activity.mjs` + corpus envelope metrics + ratchet.
- **Phase 2:** hook (b) onset snapping; gap-recovery slice envelope recompute.
- **Deferred:** repeated-chorus onset disambiguation; persisting envelopes with stored songs for re-refine; a pretrained VAD model (e.g. Silero) for cleaner raw-mix accuracy; per-frame streaming during transcription.

## Open risks

- Raw-mix false rejections (quiet vocals under loud instruments read as low vocal-band energy) — mitigated by corroborate-don't-override + strong-evidence gating + the real-derived mix corpus envelopes as the regression guard.
- Corpus envelopes depend on the user running the one-time script; until then, coverage is synthetic-only + live e2e.
- Demucs stem sample-rate/latency must be handled (envelope hopSec derived from the actual `sampleRate` in use).
