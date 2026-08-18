# Version-aware lyric sourcing and imported-timing retiming

**Date:** 2026-08-18
**Status:** Approved, ready for planning
**Thread:** C1 of a three-part UX audit (A = auto-align stall, shipped; B = cross-browser/device compat, open)

## Problem

Two user complaints that turn out to be one problem:

> "trying to find exact captions for the specific version of the song ... all the
> manual stuff (tap through timing and fine tuning line timing) is very clunky and
> not very intuitive to the point I feel like they need to be replaced with more
> automation"

The manual timing screens are not primarily a UI problem. They are the fallback
the app falls into when it cannot time a song any other way.
`chooseAutoAlignment` (`src/player/alignmentPolicy.ts:19`) forces Tap-through in
exactly two situations:

- **YouTube songs.** The iframe API exposes no PCM, so Whisper has nothing to
  transcribe. Tap-through is currently the only option.
- **`manual`-tier devices** (no WebGPU, typically phones). Audio exists, but WASM
  Whisper is too slow to offer honestly.

The app already prefers LRCLIB **synced** lyrics (`src/sources/lrclib.ts:296`), so
when sourcing finds the right version a YouTube song is timed with zero taps.
Sourcing failure is therefore what forces manual timing. Reducing manual work means
shrinking the set of songs that fall into it — not redesigning the manual screens.

The reported case is "幸せにさよなら (山下ヴォーカル・バージョン)": a specific vocal
version, where LRCLIB most likely holds only the standard master.

## Findings

Established by reading the code, not assumed.

### 1. The duration signal is plumbed but never supplied on the main path

`findLyrics` (`src/sources/lrclib.ts:259`) takes `targetDurationSec` as its fourth
parameter, and `lyricsMatchScore` (`src/sources/lrclib.ts:380`) uses it with real
weight:

| Duration difference | Score effect |
|---|---|
| ≤ 2s | **+0.15** |
| ≤ 8s | +0.05 |
| larger | **−0.25** (capped) |

`resolveLyricsForSong` (`src/sources/lyricsResolver.ts:73`) passes literal
`undefined` for it and does not even accept a duration parameter. On the YouTube and
lyrics-import paths that bump **never fires** — candidate selection is title and
artist similarity only. `UploadAudioFlow` does pass it
(`src/sources/UploadAudioFlow.tsx:181`), which is why local-file adds behave better.

This is the single highest-leverage defect behind the reported complaint.

### 2. The version marker is discarded before searching

`TITLE_NOISE` (`src/sources/youtube.ts:15`) strips `(Live)`, `(Remastered)`,
`(Full Version)` and similar from titles to widen matching. That deletes the exact
signal needed to tell versions apart: a live take becomes indistinguishable from the
studio master at query time. The Japanese marker in the reported case survived only
because the pattern is Latin-only.

### 3b. Duration is never persisted

Discovered while planning Phase 1. `Song` (`src/core/types/index.ts`) has **no
duration field**. `UploadAudioFlow` reads it from audio metadata, passes it to
`findLyrics`, and discards it. So the only path that benefits is the initial upload;
a later re-search from `LyricsImportPanel` on the same song cannot supply a duration
because none was kept.

Design section 1 therefore also requires persisting `durationSec` on `Song` —
additive and optional, so existing rows need no migration. `usePlayerStore` already
holds a `duration` for both providers (`src/player/PlayerView.tsx:299`), set from
`engine.duration`, which is the natural place to capture it for YouTube songs.

### 3. YouTube duration exists, but arrives after lyrics are resolved

`YouTubeMeta` (`src/sources/youtube.ts:4`) has no duration field — oEmbed does not
return one. `YouTubePlayer` reads it at runtime via `getDuration()` with stable
polling (`src/player/YouTubePlayer.tsx:61`), but only once the iframe has mounted,
which is long after lyric resolution has run.

### 4. The shipped anchor engine cannot retime imported lyrics

`refitAroundAnchors` (`src/lyrics/anchorRefit.ts:34`) is deliberately **local**:
lines outside the anchored span are never translated, and only lines marked
`needs_review` are reflowed. Its own comment records why — applying a global
correction when most lines are already correct measured **0.9s → 6s mean error**.

That is correct for its job (a mostly-good alignment with a few bad spots) and wrong
for imported timings, where *every* line comes from another master, none are
correct, and imported LRC carries no `lineAlignmentQuality` array at all. Feeding
imported lyrics to it would pin the anchored lines and leave the rest untouched —
effectively a no-op.

The same input therefore demands the opposite transform depending on provenance.

## Design

### 1. Supply the duration

`resolveLyricsForSong` gains `durationSec?: number` and forwards it to `findLyrics`.
Callers (`src/sources/LinkParser.tsx`, `src/lyrics/LyricsImportPanel.tsx`) pass it
where known. No scoring changes — the weighting already exists and is well shaped.

### 2. Score version agreement

Keep `TITLE_NOISE` stripping for **search breadth**, but retain the raw title and add
a version-agreement term to `lyricsMatchScore`. A small pure helper extracts version
markers covering Latin and Japanese forms (`Live`, `Acoustic`, `Remaster`,
`Instrumental`, `ver.`, `バージョン`, `ライブ`). A candidate whose marker disagrees with
the query's is penalised; agreement is rewarded.

### 3. Re-rank when YouTube duration arrives

Rather than delaying lyrics until playback, resolve as now but **retain the ranked
candidate list with each candidate's duration**. When the player reports a stable
duration, re-rank locally — no new network calls — and surface an alternative only
when **both** of these hold, so the prompt stays rare and meaningful:

1. The candidate in use is outside `durationMatches` tolerance (±2s,
   `src/sources/lyricsMatch.ts:297`) of the reported duration, **and**
2. Another candidate is inside that tolerance.

Otherwise stay silent. Re-ranking on a marginal score difference would nag the user
about a match that is already correct.

> Found a closer match for this version (3:52 vs 4:10). Use it?

### 4. Two timing engines, selected by provenance

New pure module `src/lyrics/linearTimingFit.ts`:

- `fitLinearFromAnchors(anchors)` → `{ offsetSec, scale }`. One anchor ⇒ offset only,
  `scale = 1`. Two or more ⇒ least-squares fit.
- `applyLinearFit(lines, fit)` → every line transformed.
- `assessFitPlausibility(fit)` → flags a structural mismatch when `|scale − 1|`
  exceeds a threshold.

`refitAroundAnchors` is **left unchanged** and keeps its local job.

Selection needs an explicit provenance field on `LyricsData`
(`src/core/types/index.ts:100`). `alignmentMode` (`'manual' | 'auto'`,
`src/core/types/index.ts:7`) cannot carry it: tapped timings and imported timings are
both `'manual'`.

Add `timingOrigin?: 'imported' | 'aligned' | 'tapped'`. Optional, so every existing
stored song reads as `undefined` and needs no migration; absent is treated as
`'aligned'`, preserving today's behavior exactly. Only `'imported'` selects the global
fit — everything else keeps the local refit.

### 5. Drag-to-sync calibration

The current mechanic asks the user to **tap at an instant**, which injects their own
~200–300ms and variable reaction latency into the measurement meant to remove error.
It is also reactive — the user must wait for playback to reach a flagged line.

A `SyncCalibrator` overlay in Play mode replaces it for imported timings:

- **Step 1 — Sync.** Playback runs; one slider shifts all lines live; the user drags
  until the highlighted line matches what they hear. Precision comes from the visual
  match, not from reflexes, and the result is audible immediately. This is the
  familiar "subtitle delay" control.
- **Step 2 — Stretch.** Offered only when step 1 does not hold at ~80% through. A
  second drag fixes the far end; the two points give the linear fit.
- When `assessFitPlausibility` reports an implausible scale, do **not** silently
  warp. Say the versions do not appear to correspond, and offer either per-section
  anchors (the existing `refitAroundAnchors` mechanic, which is good at exactly that)
  or attaching the local audio file — which routes into the auto-align path that
  already works.

This also displaces the per-line fine-tune sliders as the *default* correction path:
one global control instead of forty local ones. `TimestampPopover` is **not** removed —
it stays reachable for deliberate single-line adjustment, which it is good at. The
change is which path the user is led down first.

### Why version differences are mostly linear

| Difference | Cause | Fix |
|---|---|---|
| Constant offset | Different intro length, silence padding, fade-in | 1 control |
| Offset + scale | Tempo differs (live takes, remasters) | 2 controls |
| Structural | Extra verse, extended solo, different arrangement | Linear model fails — per-section anchors |

Two anchors is the right ceiling for the common path: offset and scale are the only
degrees of freedom that matter, and a third tap buys nothing unless the song is
structurally different. A "vocal version" of the same recording — the reported case —
usually shares the backing track, so the offset is near zero.

## Testing

- `linearTimingFit` maths and `assessFitPlausibility`: pure, directly unit-tested.
- A regression test asserting `findLyrics` actually **receives** a duration from
  `resolveLyricsForSong`. This is the defect that would silently return, and it is
  invisible in any test that only checks the returned lyrics.
- Version-marker extraction and the agreement term: pure unit tests, including
  Japanese markers.
- Late re-ranking: given a candidate list and a late duration, assert the expected
  candidate wins and that no network call is made.
- `SyncCalibrator`: component test that dragging shifts displayed timings and that
  committing persists them.

## Provisional decisions — explicitly not evidence-based

These are flagged so they are not mistaken for measured values. Thread A shipped a
guessed 5-minute threshold that live measurement later refuted; the same mistake is
not to be repeated here.

1. **The plausibility threshold (`|scale − 1|`, provisionally ~5%) is a guess.** The
   implementation plan must pick it from real songs before it ships as a gate.
2. **Step 1's reference point is weak on YouTube.** With stored audio we can seek to
   `firstVocalOnset`. Without PCM the only starting point is the imported first
   line's timestamp — wrong by exactly the offset being measured — so the user may
   have to scrub to find the vocal entry. If that proves annoying in practice, it
   argues for pushing the attach-audio option harder on YouTube songs.

## Phasing

Two implementation cycles, not one plan:

- **Phase 1 — Sourcing (design sections 1–3).** Stands alone and fixes the primary
  complaint whenever a 1-to-1 match exists.
- **Phase 2 — Retiming (design sections 4–5).** The fallback for when it does not.

Sourcing goes first so we learn how often the fallback is even reached before
building it.

## Out of scope

- Redesigning or rebuilding the Tap-through screen itself (thread C3). It remains the
  last resort for songs neither phase can reach.
- Replacing `refitAroundAnchors` or changing its local behavior.
- Cross-browser and device compatibility work (thread B).
- Obtaining PCM from YouTube. It is not available, and no part of this design assumes
  otherwise.

## Success criteria

- A song whose exact version exists on LRCLIB is timed with **zero** manual taps, and
  the app states which track and duration it matched.
- When the matched version is wrong, the user can see that and switch to a better
  candidate without re-searching.
- A song with no 1-to-1 match, but a findable original, reaches usable timing from
  **one or two drags** rather than tapping every line.
- When versions genuinely do not correspond, the app says so rather than producing a
  confidently wrong warp.
