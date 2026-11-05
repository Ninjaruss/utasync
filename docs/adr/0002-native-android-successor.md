# ADR-0002: Native Android successor; PWA in maintenance

- Status: accepted
- Date: 2026-11-03

## Context

Many PWA design choices were responses to the browser: device tiers from WebGPU detection,
OPFS/IndexedDB/Cache Storage, model caches subject to eviction, limited background audio,
YouTube embeds for playback. The 2026-11-03 technical audit found the practice features
solid and the preparation pipeline (~18,600 lines, 195 numeric thresholds) the weak point.

## Decision

- Build a native Android app in `android/`: Kotlin, Jetpack Compose, Media3
  (`MediaSessionService` + ExoPlayer) for background playback, Room for the library,
  WorkManager for resumable preparation jobs, one ONNX inference runtime.
- Modules: `:app` (UI), `:playback`, `:prepare`, `:align` (pure Kotlin, JVM-testable),
  `:inference`, `:japanese`, `:data`.
- User timing fixes are stored as **anchors**, separate from computed timings, and are hard
  constraints for every re-alignment.
- The PWA receives bug fixes and an export path (LRC + JSON library export) only.
- No backend, accounts or analytics.

## Alternatives rejected

Wrapping the PWA (TWA/Capacitor) keeps the browser limits; a shared C++/Rust/KMP core adds a
toolchain before the alignment method is known; a line-by-line port carries the weakest
part of the codebase forward; server-side alignment conflicts with privacy and F-Droid.

## Reversal

Revisit if Phase 0 shows the best engine can only run in the browser stack, or if Android
playback/sync acceptance (highlight within 30 ms of player position) cannot be met.
