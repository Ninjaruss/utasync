# Android: the Correction Story — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Android shell a real app in which a user can fix a song's timing — by ear, by drag, by tap — and have those fixes survive everything.

**Architecture:** Extend the existing Phase 1 shell (`android/`), which already has the two structural decisions right: one start per line, and anchors in their own table apart from computed timings. This plan gets that shell compiling, then builds the waveform-and-scrub correction screen the spec flags as the single highest-risk piece, then tap-along, then practice. It touches no network and no aligner.

**Tech Stack:** Kotlin 2.1.0, Jetpack Compose, Media3/ExoPlayer, Room, JDK 17, Android SDK 35.

**Spec:** `docs/superpowers/specs/2026-11-06-utasync-android-design.md` (§7.1–§7.5, §9)

**Scope note.** The spec's §6–§10 cover three separately shippable subsystems: this one, the ladder's network rungs (§6: LRCLIB, paste), and offline understanding (§7.6: furigana, dictionary, word roles). They are planned separately. This plan ships on its own: a user can import audio and an `.lrc`, play it, and correct it.

**Two corrections to the spec, found by reading the code.** §9.1 says the schema lacks a per-line confidence column; it does not — `LineEntity.confidence: Float?` already exists, so no migration is needed. And §7.7's flag is *scored* against the §8 corpus, which no engine yet feeds, so this plan stores and displays confidence but does not invent a value for it.

## Global Constraints

- **One timestamp per line. A line runs until the next line starts. Ends are implied, never stored.** (§7.1)
- **Any timing the user sets is stored separately from computed timings and marked pinned. No re-alignment, re-fetch or version bump may overwrite it.** (§7.4, anti-goal 3 — non-negotiable)
- **Only the nudged line moves. Nothing cascades.** (§7.2)
- **Local audio only; no network.** The manifest has no `INTERNET` permission and must not gain one in this plan (ADR-0005).
- **No copyrighted song text in the repository**, including test fixtures and sample data — use invented lines (ADR-0004, CLAUDE.md rule 6).
- Kotlin 2.1.0 compiled with `-Werror`; KSP version must match Kotlin exactly; JDK 17; Android SDK 35.
- **Highlight within 30 ms of `player.currentPosition`** across a full song (Phase 1 acceptance, `android/README.md`).
- New ideas start as a spike with a pass/fail gate written before the first run (CLAUDE.md rule 3).

## Review Focus

Five conditions the spec implies that no task's happy path exercises.

1. **A re-alignment lands on a song that has pins.** The pins must win, every time, for every pinned line — this is the one guarantee the spec calls non-negotiable. — Task 7
2. **The audio URI is no longer readable** (SAF permission revoked, file moved or on ejected storage). The library and player must say so, not crash or show a blank waveform. — Task 2
3. **A drag pushes a line's start onto or past its neighbours.** `applyAnchors` already enforces a 0.05 s minimum gap; the screen must agree with it rather than storing something the align module will silently move. — Task 4
4. **Tap-along receives taps out of order, or two within a few milliseconds** (a double-tap, or a tap before the previous line started). — Task 5
5. **A line that was never aligned** (`startMs` null, common on rung 3) is opened for nudging, repeated, or tapped to. — Task 4

---

### Task 1: Make the shell build

The shell's `:app`, `:data` and `:playback` modules were written without an Android SDK and **have never been compiled**. Budget for first-build friction; this task is finished when CI is green, not when it compiles locally.

**Files:**
- Modify: `android/gradle/libs.versions.toml`, module `build.gradle.kts` files, and any Kotlin file the compiler rejects
- Modify: `.github/workflows/android.yml`

**Interfaces:**
- Produces: a green `./gradlew :align:test :app:assembleDebug`, which every later task depends on.

- [ ] **Step 1: Generate the wrapper and attempt the build**

Run: `cd android && gradle wrapper --gradle-version 8.11.1 && ./gradlew :align:test :app:assembleDebug`

Record every error. Expect unresolved Compose/Room symbols and KSP-vs-Kotlin version mismatches.

- [ ] **Step 2: Fix the build, smallest change first**

Prefer correcting a call site over changing a dependency version. If a version must move, move KSP and Kotlin together. Do not add dependencies the spec does not require, and do not add the `INTERNET` permission.

- [ ] **Step 3: Verify both commands pass**

Run: `./gradlew :align:test :app:assembleDebug`
Expected: BUILD SUCCESSFUL, and `:align`'s 16 existing tests still pass — no test may be weakened to get there.

- [ ] **Step 4: Confirm CI runs the same thing**

`.github/workflows/android.yml` must run `:align:test` and `:app:assembleDebug` on a clean checkout. A local-only green build does not count; the shell's own README says CI is the first real build.

- [ ] **Step 5: Commit**

```bash
git add android .github/workflows/android.yml
git commit -m "build(android): first real compile of the Phase 1 shell"
```

---

### Task 2: Decode local audio to a peak envelope (spike first)

The spec's warning is explicit: the nudge screen "already failed once" in the PWA because the waveform never loaded. So the decode is proven on its own, against a gate written before the first run, before any UI is built on it.

**Gate, written in advance:** decoding a 4-minute local file to a 200-peaks-per-second envelope completes in **under 2 seconds** on a debug build, and the envelope's length matches the file duration within **50 ms**. If it misses, report the measurement and stop — do not build the screen on it.

**Files:**
- Create: `android/playback/src/main/kotlin/net/ninjaruss/utasync/playback/WaveformDecoder.kt`
- Create: `android/playback/src/androidTest/kotlin/net/ninjaruss/utasync/playback/WaveformDecoderTest.kt`

**Interfaces:**
- Produces:
  - `data class Envelope(val peaksPerSecond: Int, val peaks: FloatArray, val durationMs: Long)`
  - `suspend fun decodeEnvelope(context: Context, uri: Uri, peaksPerSecond: Int = 200): Result<Envelope>` — `Result.failure` when the URI cannot be opened, never a throw.

- [ ] **Step 1: Write the failing instrumented tests**

```kotlin
@Test fun envelopeLengthMatchesDuration()      // peaks.size ≈ durationMs/1000 * peaksPerSecond, ±50 ms
@Test fun silenceReadsLowAndToneReadsHigh()    // a generated tone-then-silence fixture
@Test fun unreadableUriReturnsFailure()        // a revoked/nonexistent URI → Result.failure, no throw
```

Generate the fixture in the test (a tone and silence written to a temp file). Do not commit audio.

- [ ] **Step 2: Run to verify they fail**

Run: `./gradlew :playback:connectedDebugAndroidTest --tests '*WaveformDecoderTest*'`

- [ ] **Step 3: Implement `decodeEnvelope`**

Use `MediaExtractor` + `MediaCodec` to PCM, then reduce to per-bucket absolute peak. Decode off the main thread.

- [ ] **Step 4: Measure against the gate**

Time a 4-minute file and record the number in the commit message. Under 2 s → continue. Over → report and stop.

- [ ] **Step 5: Commit**

```bash
git add android/playback
git commit -m "feat(playback): decode local audio to a peak envelope (<Ns for 4min)"
```

---

### Task 3: Scrub audio under the thumb

The feature the owner asked for by name: while dragging, you hear where you are.

**Files:**
- Create: `android/playback/src/main/kotlin/net/ninjaruss/utasync/playback/Scrubber.kt`
- Create: `android/playback/src/test/kotlin/net/ninjaruss/utasync/playback/ScrubberTest.kt`

**Interfaces:**
- Consumes: `PlayerConnection` (`android/playback/.../PlayerConnection.kt`).
- Produces: `class Scrubber(private val controller: MediaController)` with `fun scrubTo(positionMs: Long)` and `fun stop()`. `scrubTo` is rate-limited and idempotent within its window so a drag emitting hundreds of events per second does not queue hundreds of seeks.

- [ ] **Step 1: Write the failing test**

```kotlin
@Test fun rapidScrubsCollapseToAtMostOneSeekPerWindow()  // 100 scrubTo calls in one window → ≤1 seek
@Test fun lastPositionAlwaysWins()                       // the final position is the one seeked to
@Test fun stopEndsScrubbingWithoutSeeking()
```

Test against a fake controller interface, not a real player.

- [ ] **Step 2: Run to verify they fail**

Run: `./gradlew :playback:test --tests '*ScrubberTest*'`

- [ ] **Step 3: Implement `Scrubber`**

Coalesce on a fixed window; the window length is a behaviour-gating constant, so pick one, state it in the KDoc, and say what it rests on.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/playback
git commit -m "feat(playback): audio scrubbing that survives a fast drag"
```

---

### Task 4: The nudge screen

**Files:**
- Create: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/NudgeScreen.kt`
- Create: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/NudgeState.kt`
- Create: `android/app/src/test/kotlin/net/ninjaruss/utasync/ui/NudgeStateTest.kt`

**Interfaces:**
- Consumes: `Envelope` / `decodeEnvelope` (Task 2), `Scrubber` (Task 3), `SongDao.upsertAnchor`, `AnchorEntity`, `applyAnchors` and `TimingAnchor` from `:align`.
- Produces: `class NudgeState(original: Long?, neighbourBefore: Long?, neighbourAfter: Long?)` with `val proposedMs: Long?`, `fun drag(toMs: Long)`, `fun fine(deltaMs: Long)`, `fun toAnchor(songId: Long, lineIndex: Int): AnchorEntity`, and `val isClamped: Boolean`.

Put all arithmetic in `NudgeState` so it is unit-testable without Compose; `NudgeScreen` only draws it.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun dragSetsProposedTime()
@Test fun fineButtonsMoveByOneTenthSecond()
@Test fun dragIsClampedToNeighboursMinimumGap()   // 0.05 s, matching applyAnchors — isClamped true
@Test fun aLineWithNoComputedTimeCanStillBeNudged()  // original == null → proposed from the drag alone
@Test fun originalIsPreservedForDisplayAfterDragging()
@Test fun anUnreadableAudioUriShowsAMessageAndDisablesTheHandle()  // decodeEnvelope failure → no blank canvas
```

The last one is Review Focus 2 at the screen, not just the decoder: Task 2 proves `decodeEnvelope` returns `Result.failure`, and this proves the screen does something sensible with it. A revoked SAF permission is ordinary, not exotic — it happens whenever the user moves or re-saves the file.

The clamp value must equal `applyAnchors`'s `minGapSec` default of 0.05 s. A screen that stores a time the align module will silently move is Review Focus 3.

- [ ] **Step 2: Run to verify they fail**

Run: `./gradlew :app:testDebugUnitTest --tests '*NudgeStateTest*'`

- [ ] **Step 3: Implement `NudgeState`, then `NudgeScreen`**

The screen shows the envelope around the line, the original time in amber against the proposal in blue, a large drag handle calling `Scrubber.scrubTo` as it moves, and `±0.1 s` buttons. Saving writes **one** `AnchorEntity` with `source = "user"`; no other line is written.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Verify only one line moved**

Add a test asserting that saving a nudge writes exactly one anchor row and leaves every `LineEntity` untouched.

- [ ] **Step 6: Commit**

```bash
git add android/app
git commit -m "feat(app): nudge a line by ear, with the original still visible"
```

---

### Task 5: Tap-along

**Files:**
- Create: `android/align/src/main/kotlin/net/ninjaruss/utasync/align/TapAlong.kt`
- Create: `android/align/src/test/kotlin/net/ninjaruss/utasync/align/TapAlongTest.kt`
- Create: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/TapAlongScreen.kt`

**Interfaces:**
- Produces: `class TapSession(val lineCount: Int)` with `fun tap(atMs: Long): Int?` returning the line index the tap timed, or null when rejected; `val taps: List<TimingAnchor>`; `fun undoLast()`.

Pure Kotlin in `:align` so the rules are testable without a device.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun tapsTimeLinesInOrder()
@Test fun aTapWithinTheDebounceWindowIsRejected()     // double-tap → second returns null
@Test fun tapsNeverGoBackwards()                      // a tap earlier than the previous is rejected
@Test fun tappingPastTheLastLineIsRejected()
@Test fun undoRemovesOnlyTheLastTap()
```

Review Focus 4 lives here: a double-tap must not consume two lines.

- [ ] **Step 2: Run to verify they fail**

Run: `./gradlew :align:test --tests '*TapAlongTest*'`

- [ ] **Step 3: Implement `TapSession`, then the screen**

The debounce window is a behaviour-gating constant: state it and what it rests on. On finish, every tap is written as a `source = "user"` anchor.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/align android/app
git commit -m "feat(align): tap a song into time, one tap per line"
```

---

### Task 6: Practice controls

**Files:**
- Modify: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/PlayerScreen.kt`
- Create: `android/app/src/test/kotlin/net/ninjaruss/utasync/ui/RepeatRangeTest.kt`

**Interfaces:**
- Consumes: `activeLineIndex(startsMs, positionMs)` from `:align`.
- Produces: `fun repeatRange(startsMs: List<Long?>, lineIndex: Int, durationMs: Long): LongRange` — from this line's start to the next line's start, or to `durationMs` for the last line.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun rangeRunsToTheNextLineStart()
@Test fun lastLineRunsToTheEndOfTheAudio()
@Test fun aLineWithNullStartHasNoRange()          // returns an empty range, not a crash
@Test fun aNullGapIsSkippedWhenFindingTheNextStart()
```

This encodes §7.1's accepted cost: a line runs through trailing silence. That is intended, not a bug.

- [ ] **Step 2: Run to verify they fail**

Run: `./gradlew :app:testDebugUnitTest --tests '*RepeatRangeTest*'`

- [ ] **Step 3: Implement `repeatRange`, then wire the controls**

Tap a line to seek to it; a repeat toggle looping `repeatRange`; a speed control. Speed uses Media3's `setPlaybackSpeed` — pitch correction is the platform's, not ours.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app
git commit -m "feat(app): jump to a line, repeat it, slow it down"
```

---

### Task 7: Pins survive everything

The spec's one non-negotiable guarantee, given its own task because it is the thing most likely to be broken later by someone who does not know it matters.

**Files:**
- Create: `android/data/src/main/kotlin/net/ninjaruss/utasync/data/TimingResolver.kt`
- Create: `android/data/src/test/kotlin/net/ninjaruss/utasync/data/TimingResolverTest.kt`
- Modify: `android/README.md`

**Interfaces:**
- Consumes: `applyAnchors`, `TimingAnchor`, `AnchorEntity`, `LineEntity`.
- Produces: `fun resolveStarts(lines: List<LineEntity>, anchors: List<AnchorEntity>): List<Long?>` — the single function the UI asks for a song's timings, so no screen reads `LineEntity.startMs` directly and bypasses the pins.

**Unit boundary, easy to get wrong:** `:align` works in `Double` **seconds** (`TimingAnchor.timeSec`, `applyAnchors`), while `:data` stores `Long` **milliseconds** (`AnchorEntity.timeMs`, `LineEntity.startMs`). `resolveStarts` is where the two meet, so it owns the conversion both ways. Convert at this boundary only; do not let seconds leak into the DAO or milliseconds into `:align`.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun aUserAnchorBeatsTheComputedTime()
@Test fun aReAlignmentDoesNotChangeAnAnchoredLine()   // replaceLines then resolve → anchor still wins
@Test fun unanchoredLinesTakeTheComputedTime()
@Test fun anchorsOnLinesThatNoLongerExistAreIgnored() // a shorter sheet after re-import, no crash
@Test fun autoAnchorsAreOverriddenByUserAnchors()
```

- [ ] **Step 2: Run to verify they fail**

Run: `./gradlew :data:testDebugUnitTest --tests '*TimingResolverTest*'`

- [ ] **Step 3: Implement `resolveStarts`**

Delegate the ordering to `:align`'s `applyAnchors` rather than reimplementing the gap rule.

- [ ] **Step 4: Route every screen through it**

Grep for direct `startMs` reads in `:app` and replace them. A screen that bypasses the resolver is how this guarantee dies quietly.

Run: `grep -rn "startMs" android/app/src/main` — every remaining hit must be inside the resolver's call path.

- [ ] **Step 5: Record the guarantee**

Add a short section to `android/README.md`: pins are stored apart, `resolveStarts` is the only way to read timings, and why.

- [ ] **Step 6: Commit**

```bash
git add android
git commit -m "feat(data): one resolver, so a user's fix can never be overwritten"
```

---

## After this plan

The app can take a local audio file and an `.lrc`, play it in the background, and let the user fix any line by ear and keep that fix forever. What it still cannot do:

- **Find lyrics on its own** — the ladder's rungs 1 and 3 (LRCLIB by title/artist/duration, and paste). Its own plan; needs the `INTERNET` permission this plan deliberately withholds.
- **Explain anything** — furigana, word meanings and roles from a bundled dictionary (§7.6). Its own plan, and the largest of the three.
- **Align anything automatically** — still ADR-0003's open question, and today's measurements put it a long way from the gate.

**Deliberately not in this plan:** a confidence *value*. §7.7 requires the flag to be scored against the §8 corpus before it is shown, and no engine yet produces one. The column exists and the UI reserves room for it; inventing a number to fill it is the "flag by vibes" the spec forbids.
