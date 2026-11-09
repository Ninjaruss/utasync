# Utasync for Android (Phase 1 shell)

Native successor to the PWA (ADR-0002). Local audio only (ADR-0005). This is the
**Phase 1 shell**: library, audio import, `.lrc` import, background playback and a
synced lyric view. There is no automatic alignment yet; that engine is chosen by the Phase 0
experiment (`../experiments/phase0/`, ADR-0003).

## Modules

| Module | Kind | Holds |
| --- | --- | --- |
| `:app` | Android app | Compose UI: library, player |
| `:playback` | Android library | `PlaybackService` (Media3 session + ExoPlayer), `PlayerConnection` |
| `:data` | Android library | Room: songs, lines, anchors, alignment runs |
| `:align` | **pure Kotlin/JVM** | LRC parsing, sheet↔LRC matching, prior windows, anchors, line clock |

`:prepare`, `:inference` and `:japanese` (ADR-0002) are added when there is code for them.

## Build

Requirements: JDK 17, Android SDK 35. Open this folder in Android Studio, or:

```sh
./gradlew :align:test :app:assembleDebug
```

## What has been verified, and what has not

- `:align` compiles with Kotlin 2.1.0 (`-Werror`) and its 16 tests pass. Its window planner
  produces exactly the windows of `experiments/phase0/knownTextAlign.mjs` on a real song
  (48 of 48, difference 0.0 s).
- `:app`, `:data` and `:playback` were written without an Android SDK, then compiled for the
  first time with the versions below: `./gradlew :align:test :app:assembleDebug` is green
  (no source changes were needed), and CI (`.github/workflows/android.yml`) runs the same
  two commands. Nothing has been run on a device or emulator yet.
- Versions in `gradle/libs.versions.toml` are deliberately conservative and known to work
  together. Upgrade them as a set (KSP must match Kotlin exactly).

## Phase 1 acceptance (from the technical assessment)

- Highlight within 30 ms of `player.currentPosition` across a full song (instrumented test).
- Playback continues in the background with notification controls.
- No network calls (the manifest has no INTERNET permission yet; LRCLIB comes next).
