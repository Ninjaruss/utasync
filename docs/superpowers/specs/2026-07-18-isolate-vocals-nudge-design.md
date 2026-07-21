# "Isolate Vocals" Nudge After a Weak Alignment — Design

**Date:** 2026-07-18
**Goal:** When an Auto-align ran **without** vocal separation and produced a weak result (many lines unverified / structurally-approximate / off-timing), gently suggest enabling **"Isolate vocals for timing"** and offer a one-click re-align. Vocal separation (Demucs) improves both Whisper transcription and the acoustic alignment signal, so it's the highest-leverage single fix for weak alignments on busy/live recordings — but it's opt-in default-off, so most users never try it.

**Why now:** empirical runs on real mix audio ([[acoustic-vocal-activity-round13]]) confirmed the acoustic accuracy features are near-inert on a raw mix (the vocal band is full of instruments) and only effective on the Demucs vocal stem. Rather than ship a risky mix-energy heuristic (the data showed it can't separate vocal from instrumental without over-demotion), the safe, honest lever is to nudge users toward vocal separation when it would help.

**Decisions (user-confirmed):**
- Reuse the **existing** EditMode accurate-realign hint machinery (`accurateRealignReason` → hint + re-align button); no new heuristic, no change to alignment output.
- Show the nudge **only when it would help**: the alignment was done without vocal separation **and** the device supports it. Never shown if vocals were already isolated.
- Fires on the same triggers as the existing hint — `weak-labels` and `segment-blocks` — **plus** the `off-timing` hint (lines the demotion gate / drift flagged), since a clean stem is exactly what those need.
- The action is one click: enable the "Isolate vocals for timing" setting and re-run Auto-align (reuses AutoAlignFlow's existing `forceVocalSeparation` path).

## Architecture

### 1. Track whether separation was used — `LyricsData.vocalSeparationUsed?: boolean`
Add the optional field to `LyricsData` (`src/core/types/index.ts`). Set it in `AutoAlignFlow` when the alignment result is saved (`applyRefinedAlignment(...)` call sites): `vocalSeparationUsed: willSeparate`. Legacy stored songs have it `undefined`; the nudge condition uses `!vocalSeparationUsed`, so `undefined` (default-off era) is treated as "not used" — acceptable, since re-aligning with separation on is harmless if they had it.

### 2. The nudge in EditMode (`src/lyrics/EditMode.tsx`)
EditMode already computes `alignmentHint: 'lyrics-mismatch' | 'block-timing' | 'weak-labels' | 'off-timing' | null` and renders each with a hint + (for the accurate cases) an `onAutoAlignAccurate` button. Add two props: `vocalSeparationUsed?: boolean` and `vocalSeparationSupported?: boolean`, plus a callback `onAutoAlignWithVocals?: () => void`. When the active hint is `weak-labels`, `segment-blocks`/`block-timing`, or `off-timing`, **and** `!vocalSeparationUsed` **and** `vocalSeparationSupported` **and** `onAutoAlignWithVocals` is provided, render an extra suggestion line + a **"Turn on Isolate vocals & re-align"** button inside that hint.

Copy: *"Some lines couldn't be confirmed against the audio. Isolating the vocals first often sharpens timing on busy or live recordings."*

### 3. Wire the action (`src/player/PlayerView.tsx`)
Pass `vocalSeparationUsed={song.lyrics.vocalSeparationUsed}`, `vocalSeparationSupported={canUseVocalSeparation(getDeviceTier())}`, and an `onAutoAlignWithVocals` callback to EditMode. The callback must (a) persist the "Isolate vocals for timing" setting on (`setVocalSeparationEnabled(true)`) and (b) start an Auto-align that actually uses separation for THIS run. The plan chooses the cleanest of the two existing mechanisms: either enabling the persisted setting is sufficient because `AutoAlignFlow` reads it when it starts, or the re-align entry threads `forceVocalSeparation: true` through to `AutoAlignFlow.start` (which already accepts it). The plan verifies which and wires accordingly.

## Data flow
AutoAlignFlow (align) → `applyRefinedAlignment` writes `vocalSeparationUsed` into `LyricsData` → PlayerView reads it + device support → EditMode shows the nudge when weak + not-used + supported → button enables the setting and re-aligns with `forceVocalSeparation`.

## Testing
- **LyricsData/persistence:** confirm `applyRefinedAlignment` output preserves an incoming `vocalSeparationUsed`, and AutoAlignFlow sets it (verify the field is written; the .tsx orchestration itself is covered by tsc + the EditMode/PlayerView tests).
- **EditMode (component test):** with `accurateRealignReason='weak-labels'`, `vocalSeparationUsed=false`, `vocalSeparationSupported=true`, `onAutoAlignWithVocals` set → the nudge + button render, and clicking calls the callback. It does NOT render when `vocalSeparationUsed=true`, or when `vocalSeparationSupported=false`, or when the hint is null. Repeat for the `off-timing` hint.
- **Back-compat:** a `LyricsData` with `vocalSeparationUsed=undefined` (legacy) → treated as not-used (nudge eligible).
- Full suite green; `npx tsc --noEmit` clean; existing EditMode/PlayerView tests unaffected.

## Safety / invariants
- Purely additive UI + one persisted boolean; **no change to alignment output** or any timing.
- The new `LyricsData` field is optional → back-compatible with all stored songs.
- The nudge only ever *suggests* an existing, safe action (re-align with separation); the user stays in control.

## Scope
- **In:** the `vocalSeparationUsed` field + persistence; the EditMode nudge (weak-labels / segment-blocks / off-timing); the PlayerView wiring + one-click enable-and-re-align.
- **Deferred:** a first-run/onboarding explanation of vocal separation; auto-enabling separation for detected live/messy audio (would need a detector); analytics on nudge acceptance.
