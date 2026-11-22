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
| `:prepare` | Android library | LRCLIB client and retry policy, audio tag reading, the lyric-sourcing ladder (`prepareSong`) |
| `:align` | **pure Kotlin/JVM** | LRC parsing and writing, sheet↔LRC matching, prior windows, anchors, line clock |

`:inference` and `:japanese` (ADR-0002) are added when there is code for them.

## Build

Requirements: JDK 17, Android SDK 35. Open this folder in Android Studio, or:

```sh
# Everything CI runs: every JVM unit test, then the debug APK.
./gradlew :align:test :data:testDebugUnitTest :playback:testDebugUnitTest :prepare:testDebugUnitTest :app:testDebugUnitTest :app:assembleDebug
```

## What has been verified, and what has not

- Warnings are errors in all five modules (`allWarningsAsErrors = true` in each module's
  `build.gradle.kts`). The flag was checked once by planting a deliberate warning in `:prepare`
  and watching that build fail; the other four modules were not planted in, only observed to
  compile clean with the flag on.
  `:align` compiles with Kotlin 2.1.0 and its 43 tests pass. Its window planner
  produces exactly the windows of `experiments/phase0/knownTextAlign.mjs` on a real song
  (48 of 48, difference 0.0 s).
- `:app`, `:data` and `:playback` were written without an Android SDK, then compiled for the
  first time with the versions below (no source changes were needed). CI
  (`.github/workflows/android.yml`) runs every JVM unit test — `:align:test`,
  `:data:testDebugUnitTest`, `:playback:testDebugUnitTest`, `:prepare:testDebugUnitTest`,
  `:app:testDebugUnitTest` — and then
  `:app:assembleDebug`. The test tasks have to be named: `assembleDebug` does not compile unit-test
  sources, so a build that only assembles cannot catch a broken or deleted test.
- Versions in `gradle/libs.versions.toml` are deliberately conservative and known to work
  together. Upgrade them as a set (KSP must match Kotlin exactly).

## Phase 1 acceptance (from the technical assessment)

- Highlight within 30 ms of `player.currentPosition` across a full song (instrumented test).
- Playback continues in the background with notification controls.
- The manifest declares `INTERNET`, used during preparation only: a lyric lookup against LRCLIB
  carrying the title and artist and, where known, the duration, read from the user's own file
  (the fuzzy search sends no duration, and no album is sent by either endpoint: `TrackQuery` has
  no album field, and `LrclibQueryTest` keeps it that way). Lyric fetching
  defaults to on and can be switched off from the lyrics screen (`FetchSetting`). Code-level, not
  observed: the HTTP transport (`UrlConnectionHttp`) is constructed only in `UtasyncApplication`
  for the lookup, and `:playback` has no reference to lookup or HTTP, so nothing in the playback
  path reaches the network. No one has watched network traffic during playback; this rests on the
  call graph, not a measurement.
- Corrections are not trapped here: the player's overflow menu exports a plain `.lrc` carrying the
  resolved times (pins folded in over the computed ones), with no `[offset:]` or metadata tags.
  `writeLrc` is covered by JVM tests in `:align` (including a round trip through `parseLrc`);
  the exported file follows the resolver's monotonic view: where pins disagree about order, it
  contains the repaired order, which can differ from what is stored. The menu, the file picker and the file write in `PlayerScreen` have no automated test and have
  not been exercised on a device.

## Pins survive everything

> **Upgrading from an earlier build of this branch:** the `anchors` table gained a `writtenAtMs`
> column, `songs` (`SongEntity`) gained `prepareState`, and the `dictionary` table
> (`DictionaryEntity`) was added. Each changed Room's schema identity hash while the version stayed
> at 1. There is no migration and no `fallbackToDestructiveMigration`, so an older build's database
> makes Room throw "cannot verify the data integrity" on first access — a crash, not a message.
> Uninstall the old build first. This matters only to developers: the app has never shipped.
>
> The database is created from a prebuilt asset (`data/src/main/assets/utasync-seed.db`), which
> holds every table, so **any later entity change needs the asset rebuilt**: build `:data` (KSP
> re-exports the schema), then `node scripts/build-japanese-db.mjs`. `tests/scripts` fails if the
> asset and the exported schema disagree.

A timing the user sets (by nudging a line or tapping along) is stored as an anchor, apart from
the computed times in `lines`. Re-alignment, re-import or a pipeline change rewrites only the
computed times; it cannot touch an anchor. This is the product's one non-negotiable guarantee
(ADR-0002): the predecessor lost user corrections to re-runs.

`resolveStarts(lines, anchors)` in `:data` is the **only** way to read timings. Never read
`LineEntity.startMs` in a screen: it is just the latest computed time and silently ignores the
pins. Check with `grep -rn startMs android/app/src/main`; every hit must be a write at import or
unrelated to line times. Where pins disagree about order, the resolver returns a monotonic view
(earlier line wins) and changes nothing stored; re-nudging either line fixes it.

There is a second way to break the guarantee without writing an anchor: anchors are keyed by
`lineIndex`, so **replacing a pinned song's lyric sheet with a differently split one moves every
pin onto different words**. `prepareSong` therefore returns `RefusedHasPins` for a song with any
`source = "user"` anchor unless the user says to go ahead (`allowReplaceSheet`). "No anchor row
was written" is not enough on its own; both properties are asserted in `PreparationTest`.

Automatic timings may only be stored with `SongDao.upsertAuto` and user pins only with
`SongDao.upsertUser`; the raw `upsertAnchor` is `protected`, so no caller outside the DAO can
write an anchor of the wrong source past those two checks. A pin is removed with
`SongDao.deleteAnchor` (the nudge screen's "Clear pin"), the only supported undo.

**CI runs every JVM unit test. The instrumented tests still need a device or emulator.**
`PinsSurviveReAlignmentTest` (real Room: pin, re-align, resolve; auto write cannot replace a pin;
each door refuses the other's source; clearing a pin restores the computed time) and
`WaveformDecoderTest` do not run in CI; neither do `:data`'s `LineCountsTest` and `ClearAnchorsTest`.
Before merging anything that touches timings, run them:

```sh
./gradlew :data:connectedDebugAndroidTest :playback:connectedDebugAndroidTest
```

All of `:data`'s instrumented tests (`PinsSurviveReAlignmentTest`, `LineCountsTest`,
`ClearAnchorsTest`) were executed once on an API-35 emulator during the lyric-sourcing work: 10
tests, 0 failures (as reported by the person who ran them; not re-run when this README was
written). That is the first time the pin-guarantee tests had run on this branch. It still
does not prove the *app* preserves pins end to end: those tests exercise the DAO and resolver layer
against real Room, not the UI with a file-backed database. `WaveformDecoderTest` (`:playback`) was
not part of that run.
