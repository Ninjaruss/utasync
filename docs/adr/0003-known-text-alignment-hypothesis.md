# ADR-0003: Known-text alignment is the lead hypothesis, pending the Phase 0 gate

- Status: **proposed** — decided by the Phase 0 result, not by this document
- Date: 2026-11-03

## Context

The PWA transcribes the song with Whisper and then matches the lyric sheet to the
transcript. Its error tail comes from transcript holes, recording-version mismatches and
false confidence (ledger L14, L15, L18, L32). The lyric text is usually known, so
transcription discards information. A CTC forced-alignment spike (MMS, commits `1002f11`,
`bf0041a`) gave the best line medians measured here (p50 0.08–0.41 s) but bad tails; it was
declared a dead end without trying a skip (`<star>`) token or bounds from an independent
prior (the LRC). The MMS aligner is CC-BY-NC-4.0 and cannot ship.

## Hypothesis

Refining each line inside a window around an independent prior (catalogue LRC when it
exists), with a licence-clean model, reaches the contract: ≥85% of line starts within
250 ms of blind human onsets, no unflagged line over 1 s, and beats both the LRC as-is
and the current pipeline (live) on p90.

## Experiment (`experiments/phase0/`)

Arms on identical, hash-locked inputs: (A) current pipeline, live; (B) LRC as-is;
(C) MMS windowed refine — ceiling only, not shippable; (D) Whisper-small known-text
alignment (cross-attention DTW) windowed around the prior. Truth: blind human onsets from
`benchmarks/sync`. Truth-free diagnostics (prior independence, planted ±0.8 s offsets) are
reported separately and cannot pass the gate on their own.

## Decision rule (pre-registered)

- D passes → D becomes the Android engine; `src/ai-pipeline` is not ported.
- Only C passes → find a permissively licensed CTC model before building.
- Neither passes → simplify the existing pipeline rather than rewrite it.

## Reversal

This ADR is replaced by an accepted ADR once the gate is evaluated on ≥10 songs.
