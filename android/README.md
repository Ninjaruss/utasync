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
# Everything CI runs: every JVM unit test, then the debug APK.
./gradlew :align:test :data:testDebugUnitTest :playback:testDebugUnitTest :app:testDebugUnitTest :app:assembleDebug
```

## What has been verified, and what has not

- `:align` compiles with Kotlin 2.1.0 (`-Werror`) and its 16 tests pass. Its window planner
  produces exactly the windows of `experiments/phase0/knownTextAlign.mjs` on a real song
  (48 of 48, difference 0.0 s).
- `:app`, `:data` and `:playback` were written without an Android SDK, then compiled for the
  first time with the versions below (no source changes were needed). CI
  (`.github/workflows/android.yml`) runs every JVM unit test — `:align:test`,
  `:data:testDebugUnitTest`, `:playback:testDebugUnitTest`, `:app:testDebugUnitTest` — and then
  `:app:assembleDebug`. The test tasks have to be named: `assembleDebug` does not compile unit-test
  sources, so a build that only assembles cannot catch a broken or deleted test.
- Versions in `gradle/libs.versions.toml` are deliberately conservative and known to work
  together. Upgrade them as a set (KSP must match Kotlin exactly).

## Phase 1 acceptance (from the technical assessment)

- Highlight within 30 ms of `player.currentPosition` across a full song (instrumented test).
- Playback continues in the background with notification controls.
- No network calls (the manifest has no INTERNET permission yet; LRCLIB comes next).

## Pins survive everything

A timing the user sets (by nudging a line or tapping along) is stored as an anchor, apart from
the computed times in `lines`. Re-alignment, re-import or a pipeline change rewrites only the
computed times; it cannot touch an anchor. This is the product's one non-negotiable guarantee
(ADR-0002): the predecessor lost user corrections to re-runs.

`resolveStarts(lines, anchors)` in `:data` is the **only** way to read timings. Never read
`LineEntity.startMs` in a screen: it is just the latest computed time and silently ignores the
pins. Check with `grep -rn startMs android/app/src/main`; every hit must be a write at import or
unrelated to line times. Where pins disagree about order, the resolver returns a monotonic view
(earlier line wins) and changes nothing stored; re-nudging either line fixes it.

Automatic timings may only be stored with `SongDao.upsertAuto` and user pins only with
`SongDao.upsertUser`; the raw `upsertAnchor` is `protected`, so no caller outside the DAO can
write an anchor of the wrong source past those two checks. A pin is removed with
`SongDao.deleteAnchor` (the nudge screen's "Clear pin"), the only supported undo.

**CI runs every JVM unit test. The instrumented tests still need a device or emulator.**
`PinsSurviveReAlignmentTest` (real Room: pin, re-align, resolve; auto write cannot replace a pin;
each door refuses the other's source; clearing a pin restores the computed time) and
`WaveformDecoderTest` do not run in CI. Before merging anything that touches timings, run them:

```sh
./gradlew :data:connectedDebugAndroidTest :playback:connectedDebugAndroidTest
```
