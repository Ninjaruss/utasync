# Forced Alignment for Mixed / Hard Songs — Design

**Date:** 2026-07-22
**Status:** Design (pre-implementation)
**Branch:** `feat/forced-alignment` (stacked on `fix/recollect-alignment` / PR #29)

## Problem

The aligner is **transcribe-then-match**: Whisper transcribes the audio, then lyric lines
are matched (char-LCS) to the guessed words. On clean single-language songs this is
excellent (veil, pure JA: p50 0.24s). On **mixed / code-switching songs it fails** —
Whisper mis-hears the dense bilingual sections, producing transcript coverage 0.0–0.3, so
the matcher has nothing to anchor to and lines land seconds off (Recollect p50 1.89s,
worst lines 6–12s; stranger-mixed worst lines >13s). Measured verdict from the multi-song
LRC audit: **the residual mixed-song error is coverage-bound, not logic-bound.** No amount
of merge/refine tuning fixes lines the transcript never heard.

**Forced alignment** removes the guess: give the model the **known** lyrics and have it
find *where each word occurs* in the audio by acoustic matching. It is robust exactly where
transcription fails, which is the mixed-song case. This is what WhisperX-class tooling does.

## Goals

- Measurably improve alignment accuracy on hard (mixed / low-confidence) songs, scored
  against human-synced LRC truth (Recollect, stranger-mixed).
- Never regress the songs the current pipeline already aligns well (veil, clean JA).
- Stay on-device / browser-only; degrade gracefully when the aligner can't run.

## Non-goals

- Replacing the current transcribe-then-match path for clean songs (it already wins there).
- Reading/furigana/word-pairing — untouched; this is timing only.
- A server-side aligner.

## Success criteria

Forced alignment ships **only if** the Node bake-off shows it beats the current baseline on
the mixed test songs by a clear margin (target: Recollect p50 ≤ ~0.8s and a large drop in
lines >1s; stranger-mixed no worse), **and** it does not regress veil / clean-JA. The
existing LRC-truth gates and corpus scorecard enforce this. If the bake-off does not show a
clear win, we do not ship it — the spike result is a valid outcome.

## Architecture

### Module boundary

One new module exposes a single function behind which the whole approach lives:

```
forceAlignLines(
  audioData: Float32Array,
  sampleRate: number,
  lines: { text: string; lang: 'ja' | 'en' }[],
): Promise<{ lineTimings: { start: number; end: number; score: number }[] }>
```

Takes **known** lyrics + audio, returns where each line lands + a per-line confidence.
Nothing outside this module knows which model/algorithm won the bake-off. Because
`@huggingface/transformers` runs in both Node and the browser worker, **the same core
module serves the Node harness (Phase 1) and the app (Phase 2)** — the spike is not
throwaway.

### Integration point (augment, not replacement)

In `AutoAlignFlow.start()`, *after* the existing result (mixed two-pass merge + gap
recovery), if the song is a **hard case**, call `forceAlignLines` and splice its timings in
via the existing **accept-if-better** guard. Forced alignment can therefore only ever
improve a song, never regress one.

## Phasing (risk control — accuracy decides)

### Phase 1 — Node spike + bake-off (no app changes)

1. **Feasibility spike (first task):** confirm transformers.js v3.8.1 can load a wav2vec2 /
   MMS CTC model and expose **per-frame emission logits** (required for Viterbi). If it
   cannot, pivot to approach B before investing further.
2. Build the forced-aligner **core** (approach A) as a pure module (the same one the app
   will use).
3. Build a **measurement harness** scoring the core vs the current baseline on the LRC
   truth corpus (Recollect, stranger-mixed, veil as a no-regression control), reusing
   `scripts/lib/lrcTruth.mjs` + the offset-normalized metric from `lrc-truth.test.ts`.
4. **Decision gate:** does it beat baseline, by how much, and is the model weight
   acceptable? Record the numbers. Proceed to Phase 2 only on a clear win.

### Phase 2 — App integration (only if Phase 1 wins)

Wire the proven core into a worker + `AutoAlignFlow`, gated + accept-if-better spliced
(below). The existing LRC-truth gates + corpus scorecard verify the gain and guard
regression.

## Forced-aligner core — bake-off candidates

### A. CTC forced alignment (lead)

1. Normalize each line to the model's token space: EN → characters; JA → romaji via the
   existing `toRomaji` (`phonetics.ts`), then characters/phonemes.
2. Run a wav2vec2 / MMS CTC model over the audio → per-frame emission logits (T × vocab).
3. Build the token sequence for the known lyrics (with CTC blanks + word/line boundaries).
4. **Viterbi forced alignment** — most likely *monotonic* path mapping the token sequence
   onto the frames → per-token frame → per-word and per-line start/end.
5. Per-line score = path likelihood, fed to accept-if-better.

Robust (never transcribes). Cost: a new model (~100–300MB, downloaded only when a hard song
needs it), JA romanization, most new code. Risk: transformers.js exposing raw CTC emissions;
JA romanization fidelity.

### B. Whisper cross-attention forced alignment (fallback)

Teacher-force the known lyric tokens through the already-loaded Whisper decoder with
`output_attentions`, DTW the cross-attention → per-token timing (same mechanism
`return_timestamps:'word'` already uses, driven by known text). Zero new download; higher
API risk (transformers.js is built for generation, not forced-decode + attention
extraction).

## Trigger / gating

Run forced alignment only when **all** hold:

- The initial alignment is **low-confidence** — `placementConfidence` below a threshold
  (and/or a high `needs_review` share). This scopes it to hard songs and never fires on
  clean ones (veil stays untouched). Not strictly mixed-only — a low-confidence pure-JA
  song benefits too.
- **Full-tier** device (like vocal separation).
- The aligner **model is available** (HEAD-check, like Demucs).

## Splice — accept-if-better, per line

For each line, adopt the forced timing only if its placement coverage beats the current
line's; otherwise keep the current timing. Reuses `gapRealign`'s placement-coverage logic.
Per-line (not whole-song) so good lines are kept and only bad ones are replaced. Guarantees
no song ever gets worse.

## Error handling

- Model load / download failure → skip forced alignment, keep current result (logged, like
  the Demucs-missing path).
- Romanization failure on a line → skip that line.
- Timeout → skip.
- Worse result → rejected per-line by accept-if-better.

Every failure degrades to today's behavior.

## Testing / measurement

- **Node bake-off harness** (vs LRC truth) is the primary proof and the Phase-1 decision
  instrument.
- **Deterministic unit tests** for the Viterbi core on synthetic emissions (no model).
- **LRC-truth gates** measure the gain on Recollect / stranger and lock it.
- **veil gate + corpus scorecard** guard against regression on clean songs.

## Open questions / risks

- Which CTC model: MMS (`mms-300m` / `mms-fa`, multilingual incl. JA) vs a smaller
  language-specific wav2vec2. Resolved by the Phase-1 spike (feasibility + weight + accuracy).
- JA romanization fidelity for forced alignment (kanji → reading correctness affects the
  phoneme sequence). `toRomaji` quality is the dependency.
- Worker/threading: forced alignment is heavy inference; runs in a worker like Whisper.
- Model download UX: a hard song triggers a new model download — reuse the existing
  consent/progress affordances.

## Phase 1 spike result

**Verdict: GO (approach A — CTC forced alignment).** transformers.js (`@huggingface/transformers`
v3.8.1) can load a CTC model in this repo's Node environment and expose per-frame emission logits
plus a readable character vocab.

**Spike:** `scripts/spike-ctc-emissions.mjs` (throwaway, deleted after this note). Fed a 10s
16 kHz mono slice through `AutoProcessor` + `AutoModelForCTC`, read `out.logits`.

**Model that loaded:** `Xenova/wav2vec2-base-960h`
- `out.logits.dims = [1, 499, 32]` — `[batch=1, T=499 frames, V=32 vocab]` for 10s of audio
  (~50 frames/s → ~20 ms/frame, the expected wav2vec2 stride). Emissions are directly accessible.
- Vocab size **32**. `ctc.config.id2label` is **null** (normal for wav2vec2 CTC — labels live in
  the tokenizer's `vocab.json`, not the model config). Loading `AutoTokenizer.from_pretrained(...)`
  exposes the id→token map.
- **Vocab labels** (id → token): `0:<pad> 1:<s> 2:</s> 3:<unk> 4:| 5:E 6:T 7:A 8:O 9:N 10:I 11:H
  12:S 13:R 14:D 15:L 16:U 17:M 18:W 19:C 20:F 21:G 22:Y 23:P 24:B 25:V 26:K 27:' 28:X 29:J 30:Q
  31:Z`. These are exactly what later tasks need: single **characters** (uppercase A–Z + apostrophe),
  a CTC blank (`<pad>`, id 0), and the **`|` word-separator** (id 4). Lyrics can be uppercased and
  mapped char-by-char onto this vocab for the Viterbi forced-alignment pass.

**Other candidates:**
- `Xenova/mms-300m` — FAILED: `out.logits` was `undefined` (`Cannot read properties of undefined
  (reading 'dims')`). Pretrained MMS base is not a ready-to-use CTC head via `AutoModelForCTC`
  here; a fine-tuned MMS CTC checkpoint (e.g. `mms-1b-all` / `mms-fa`) would need its own ONNX port
  check.
- `Xenova/wav2vec2-large-xlsr-53` — FAILED: `Unauthorized access to file ... preprocessor_config.json`
  (repo not resolvable/ported). Not a feasibility blocker — a GO needs only one working model.

**Caveat for design (not a blocker to the GO gate):** `wav2vec2-base-960h` is **English-only**
(Latin-uppercase vocab, no Japanese graphemes). It proves emissions are accessible but is not the
production model for mixed JA/EN songs — the JA portions have no character tokens. The
model-selection open question stays open: for JA we need a multilingual/phonetic CTC model (romanize
JA readings onto a Latin/IPA vocab, or adopt an MMS CTC checkpoint that ports to ONNX). That is a
Task-2+ concern; the transformers.js CTC-emissions capability that approach A depends on is
**confirmed present**.

### Bake-off result — NO-GO (approach A with the English CTC model)

Built `forceAlignLines` (chunked CTC inference — whole-song self-attention is O(frames²) and
hangs on a full song, so it processes ~30s chunks and concatenates emissions) and measured it vs
human-synced LRC truth on the readable in-repo audio. Offset-normalized per-line start error,
split by language:

| song | forced EN p50 | forced JA p50 | baseline p50 |
|---|---|---|---|
| stranger (mixed) | **0.50s** (p90 5.61, 9 lines >3s) | **2.25s** | app-path 0.56s |
| veil (pure JA)   | — | **10.79s** (p90 40.4) | 0.24s |

**Verdict: NO-GO.** With the only loadable CTC model (`wav2vec2-base-960h`, English):
1. It does **not beat** transcribe-then-match even on English (0.50s ≈ baseline 0.56s, with a
   worse tail).
2. It is **catastrophic on Japanese** — an English acoustic model cannot align JA audio, even
   with romaji targets (veil p50 10.79s ≈ random). Since mixed songs are JA-heavy, this alone
   kills the approach.
3. A JA-capable / multilingual CTC model does not load via `AutoModelForCTC` in transformers.js
   here (MMS base has no CTC head; xlsr-53 unauthorized).

The cores (`viterbi.ts`, `normalize.ts`, `forcedAligner.ts`) and the harness are kept — they are
correct and immediately reusable if a portable multilingual CTC model appears. But **approach A is
not shippable now.**

**Recommended next step:** the remaining candidate is **approach B (Whisper cross-attention forced
alignment)**, which is inherently multilingual (the JA problem that killed A) and reuses the
already-loaded Whisper model — but its transformers.js feasibility (teacher-forced decode +
cross-attention extraction) is unspiked. That is a separate spike / Phase-1B before any app work.
Alternatively, stop here: the shipped mixed-song improvements (forward-collapse fix, honest
confidence, cross-pass consensus, default vocal isolation) stand on their own.
