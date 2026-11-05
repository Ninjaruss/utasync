# ADR-0005: Android v1 is local audio only (no YouTube)

- Status: accepted (owner decision, 2026-11-03)
- Date: 2026-11-03

## Context

The PWA plays YouTube links through the embedded player and fetches captions through
YouTube's private `youtubei/v1/player` endpoint (`src/sources/youtubeCaptions.ts`). YouTube
audio cannot be aligned (it cannot be extracted), the API rules forbid overlays on the
player, and on F-Droid a dependence on a proprietary network service earns the NonFreeNet
anti-feature.

## Decision

Android v1 imports local audio files only. Lyrics come from the file (embedded tags, sidecar
`.lrc`), LRCLIB, or paste/import. YouTube links, YouTube captions and lyrics.ovh are not
carried over.

## Consequences

Users without local files cannot use the Android app. The PWA keeps YouTube support while it
is maintained.

## Reversal

Revisit if a large share of target users have no local files and a ToS-compliant way exists
to play and align the audio.
