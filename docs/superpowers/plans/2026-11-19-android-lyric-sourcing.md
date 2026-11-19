# Android Lyric Sourcing — the ladder's network rungs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A song whose lyrics the world has already published arrives in the library with
its words — timed if LRCLIB has them timed — without the user doing anything but picking
the audio file.

**Architecture:** A new `:prepare` module (the name ADR-0002 reserved) reads the audio
file's tags and asks LRCLIB one question: *this title, this artist, this duration.* The
server's own ±2 s duration rule decides whether the record is this recording, so the client
invents **no matching threshold of its own** (CLAUDE.md rule 2). If that question returns
nothing, the user is shown LRCLIB's search results and picks, or pastes the words. Timing
those words is not in this plan: that is the ADR-0003 engine. What this plan produces is a
song whose *words* are known and whose readiness is honestly displayed.

**Tech Stack:** Kotlin 2.1.0 (`-Werror`), `java.net.HttpURLConnection` and `org.json` —
both already on the platform, so the APK gains **no new production dependency** and F-Droid
eligibility (§5.3) is untouched. Room, Compose, `android.media.MediaMetadataRetriever`.

**Spec:** `docs/superpowers/specs/2026-11-06-utasync-android-design.md` — §5.4 (network
posture), §6 (the ladder), §6.2 (the known defect), §6.3 (readiness).

## Global Constraints

- **The APK gains no new dependency.** HTTP is `java.net.HttpURLConnection`; JSON is
  `org.json`. One **test-only** artifact is added — `org.json:json:20231013` (Apache-2.0),
  the reference implementation Android's `org.json` derives from — so the response mapping
  is tested in CI rather than only on a device. Flag any further dependency to the owner
  before adding it (CLAUDE.md rule 5).
- **No matching threshold is invented.** Rung 1 accepts only what `/api/get` returns for a
  query carrying `duration`; the server applies ±2 s. Anything less certain is shown to the
  user to choose. No similarity score, no acceptance cut-off, no fan-out. If a task seems to
  need one, stop and raise it (CLAUDE.md rule 2).
- **No lyric text in logs, ever** (CLAUDE.md rule 6, ADR-0004). Response bodies are never
  logged. Failures are reported as the `LookupOutcome` enum plus an HTTP status, never a body.
- **No personal data leaves the device.** The `User-Agent` identifies the *application*:
  `Utasync/<versionName> (https://github.com/Ninjaruss/utasync)`. It must never carry a
  device id, account, model name or anything about the user. Query strings carry only the
  title, artist, album and duration read from the user's own file.
- **Network only during preparation** (§5.4). Nothing is fetched while a song plays. The
  `INTERNET` permission is added in Task 5, not before.
- **Kotlin builds with `-Werror`.** Every module compiles clean.
- **One timestamp per line; ends are implied** (§7.1). Nothing here stores an end time that
  is not already in the imported LRC.
- **Anchors are untouchable** (ADR-0002, §7.4). No code in this plan writes, moves or
  deletes an `AnchorEntity`. Task 5 is where that is enforced and tested.

## Review Focus

Five things the spec implies, each of which would bite a real user, each pinned to a test in
the task that owns the code. Most likely first.

1. **A re-fetch silently re-points existing pins.** Anchors are keyed by `lineIndex`. Replace
   a song's lyric sheet with a differently-split one and every pin now sits on different
   words — the anti-goal of §4.3 arriving by the back door rather than through the aligner.
   → Task 5: `prepareSong` refuses to replace a sheet when the song has `source = "user"`
   anchors, unless the caller passes `allowReplaceSheet = true`.
2. **A record marked `syncedLyrics` that contains no time tags.** `parseLrc` returns an empty
   list, the song is stored with zero lines, and the library calls it ready. → Task 4:
   `sheetFrom` falls back to the plain lyrics when the synced block parses to nothing.
3. **An instrumental record.** `instrumental: true` with both lyric fields null is a valid
   LRCLIB answer and must not read as "found". → Task 4: `sheetFrom` returns `Sheet.None`.
4. **A Japanese title or artist in a query string.** Non-ASCII must be percent-encoded as
   UTF-8 or the request is malformed, and this app's songs are predominantly Japanese
   (§11a.2). → Task 1: `getUrl` is tested with a kana/kanji title and artist.
5. **No network, a captive portal, or a rate limit.** Each must end the lookup promptly with
   a distinguishable outcome, never a hang and never a wrong "no lyrics for this song". →
   Task 2: the retry policy is a pure function with a test per class, including LRCLIB's
   `Retry-After`, which its documentation says a client **must** honour.

---

### Task 1: The `:prepare` module, LRCLIB request building and response mapping

**Files:**
- Create: `android/prepare/build.gradle.kts`
- Create: `android/prepare/src/main/AndroidManifest.xml` (namespace only, no permission yet)
- Create: `android/prepare/src/main/kotlin/net/ninjaruss/utasync/prepare/LrclibQuery.kt`
- Create: `android/prepare/src/main/kotlin/net/ninjaruss/utasync/prepare/LrclibTrack.kt`
- Modify: `android/settings.gradle.kts` — add `:prepare` to `include`
- Modify: `.github/workflows/android.yml` — add `:prepare:testDebugUnitTest` to the test task list
- Test: `android/prepare/src/test/kotlin/net/ninjaruss/utasync/prepare/LrclibQueryTest.kt`
- Test: `android/prepare/src/test/kotlin/net/ninjaruss/utasync/prepare/LrclibTrackTest.kt`

**Interfaces:**
- Consumes: nothing.
- Produces: `data class TrackQuery(val title: String, val artist: String, val album: String? = null, val durationSec: Int? = null)`;
  `fun getUrl(q: TrackQuery): String`; `fun searchUrl(q: TrackQuery): String`;
  `fun userAgent(versionName: String): String`;
  `data class LrclibTrack(val id: Long, val trackName: String, val artistName: String, val albumName: String?, val durationSec: Int?, val instrumental: Boolean, val plainLyrics: String?, val syncedLyrics: String?)`;
  `fun parseTrack(json: String): LrclibTrack?`; `fun parseTracks(json: String): List<LrclibTrack>`.

The API contract, read from `https://lrclib.net/docs.txt` on 2026-11-19 — use these names
exactly:

- `GET https://lrclib.net/api/get` — `track_name` (required), `artist_name` (required),
  `album_name` (optional), `duration` (optional, **seconds**, 1–3600). The server returns a
  record only when the duration matches within ±2 s. Missing record: HTTP 404.
- `GET https://lrclib.net/api/search` — `q` **or** `track_name` (at least one), plus optional
  `artist_name`, `album_name`. **It does not accept `duration`.** At most 20 results, no paging.
- Record fields: `id`, `trackName` (`name` is a backwards-compatible alias — read
  `trackName`), `artistName`, `albumName`, `duration` (seconds), `instrumental`,
  `plainLyrics`, `syncedLyrics`. The last two are `null` for an instrumental.

- [ ] **Step 1: Write the failing tests**

```kotlin
// LrclibQueryTest.kt
@Test fun `get url carries duration in seconds`() {
    val url = getUrl(TrackQuery("Lemon", "Kenshi Yonezu", durationSec = 256))
    assertTrue(url.startsWith("https://lrclib.net/api/get?"))
    assertTrue(url.contains("track_name=Lemon"))
    assertTrue(url.contains("artist_name=Kenshi+Yonezu") || url.contains("artist_name=Kenshi%20Yonezu"))
    assertTrue(url.contains("duration=256"))
}

@Test fun `get url omits absent optional fields`() {
    val url = getUrl(TrackQuery("A", "B"))
    assertFalse(url.contains("duration="))
    assertFalse(url.contains("album_name="))
}

// Review Focus 4.
@Test fun `japanese title and artist are percent encoded as utf-8`() {
    val url = getUrl(TrackQuery("打上花火", "DAOKO"))
    assertTrue(url.contains("track_name=%E6%89%93%E4%B8%8A%E8%8A%B1%E7%81%AB"))
    assertFalse(url.contains("打"))
}

@Test fun `search url uses track and artist, never duration`() {
    val url = searchUrl(TrackQuery("Lemon", "Kenshi Yonezu", durationSec = 256))
    assertTrue(url.startsWith("https://lrclib.net/api/search?"))
    assertFalse(url.contains("duration="))
}

@Test fun `user agent names the app and links it, and carries nothing else`() {
    assertEquals("Utasync/0.1.0 (https://github.com/Ninjaruss/utasync)", userAgent("0.1.0"))
}
```

```kotlin
// LrclibTrackTest.kt — fixture strings are written inline in the test; they are
// LRCLIB's field names with placeholder words, never real lyric text (rule 6).
@Test fun `parses a synced record`()        // id, trackName, artistName, duration, syncedLyrics present
@Test fun `reads trackName, not the name alias`()  // both present, differing; trackName wins
@Test fun `instrumental record has null lyrics and instrumental true`()
@Test fun `missing optional fields become null, not the string "null"`()  // albumName, duration absent
@Test fun `parseTrack returns null for a 404 error body`()  // {"message":…,"name":"TrackNotFound","statusCode":404}
@Test fun `parseTrack returns null for a non-JSON body`()   // LRCLIB answers malformed queries in plain text
@Test fun `parseTracks reads an array and returns empty for anything else`()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :prepare:testDebugUnitTest`
Expected: FAIL — the module and both files do not exist.

- [ ] **Step 3: Create the module**

`android/prepare/build.gradle.kts` follows `data/build.gradle.kts`: `android.library` +
`kotlin.android` plugins, `namespace = "net.ninjaruss.utasync.prepare"`, `compileSdk = 35`,
`buildToolsVersion = "35.0.0"`, `minSdk = 26`, `jvmToolchain(17)`. Dependencies:
`implementation(project(":align"))`, `implementation(project(":data"))`,
`implementation(libs.kotlinx.coroutines.android)`, `testImplementation(libs.junit)`,
`testImplementation(libs.org.json)`. Add `org-json = { module = "org.json:json", version = "20231013" }`
to `gradle/libs.versions.toml` as `[libraries] org-json`. Add `:prepare` to `settings.gradle.kts`.

- [ ] **Step 4: Implement `LrclibQuery.kt` and `LrclibTrack.kt`**

Build URLs with `android.net.Uri.Builder`? **No** — that is an Android class and these tests
run on the JVM. Use `java.net.URLEncoder.encode(value, "UTF-8")` and assemble the query by
hand, appending a parameter only when its value is non-null and non-blank.

`parseTrack`/`parseTracks` use `org.json.JSONObject`/`JSONArray`, return null/empty on
`JSONException`, and read optional fields with `optString`/`optInt` guarded by `has`/`isNull`
so an absent field is Kotlin `null`, not `"null"`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd android && ./gradlew :prepare:testDebugUnitTest`
Expected: PASS.

- [ ] **Step 6: Add `:prepare:testDebugUnitTest` to CI and verify the whole build**

Run: `cd android && ./gradlew :align:test :data:testDebugUnitTest :playback:testDebugUnitTest :prepare:testDebugUnitTest :app:testDebugUnitTest :app:assembleDebug`
Expected: PASS. The workflow's task list must match this command exactly.

- [ ] **Step 7: Commit**

```bash
git add android/prepare android/settings.gradle.kts android/gradle/libs.versions.toml .github/workflows/android.yml
git commit -m "feat(prepare): LRCLIB request building and response mapping"
```

---

### Task 2: HTTP transport and the retry policy

**Files:**
- Create: `android/prepare/src/main/kotlin/net/ninjaruss/utasync/prepare/Http.kt`
- Create: `android/prepare/src/main/kotlin/net/ninjaruss/utasync/prepare/RetryPolicy.kt`
- Create: `android/prepare/src/main/kotlin/net/ninjaruss/utasync/prepare/UrlConnectionHttp.kt`
- Modify: `docs/superpowers/audits/2026-09-28-measurement-ledger.md` — add **L51**
- Test: `android/prepare/src/test/kotlin/net/ninjaruss/utasync/prepare/RetryPolicyTest.kt`

**Interfaces:**
- Consumes: Task 1's `userAgent`.
- Produces:
  `data class HttpResponse(val code: Int, val contentType: String?, val body: String, val retryAfterSec: Int?)`;
  `fun interface HttpGet { suspend fun get(url: String, userAgent: String): HttpResponse }` —
  it throws `java.io.IOException` when the request never reached the server;
  `enum class LookupOutcome { FOUND, NO_ENTRY, OFFLINE, RATE_LIMITED, ERROR }`;
  `enum class Reply { JSON, NOT_FOUND, RATE_LIMITED, BUSY, CLIENT_ERROR, SERVER_ERROR }`;
  `fun classify(code: Int, contentType: String?): Reply`;
  `fun retryDelayMs(reply: Reply, retryAfterSec: Int?, attempt: Int, jitterMs: Long): Long?`
  (null means *do not retry*);
  `fun outcomeOf(reply: Reply): LookupOutcome`;
  `class UrlConnectionHttp(private val versionName: String) : HttpGet`.

`versionName` is passed in as a plain string from `:app` (which holds `versionName = "0.1.0"`
in its `defaultConfig`). Do **not** turn on `buildConfig` to reach `BuildConfig.VERSION_NAME`:
`:prepare` is a library and would get its own, which is not the app's version.

Constants, all in `RetryPolicy.kt`, all going into ledger entry **L51**:
`CONNECT_TIMEOUT_MS = 10_000`, `READ_TIMEOUT_MS = 20_000`, `MAX_ATTEMPTS = 3`,
`BASE_BACKOFF_MS = 500`, `MAX_BACKOFF_MS = 30_000`, `PACING_DELAY_MS = 300`.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun `a json 200 is used`()                      // classify(200, "application/json") == Reply.JSON
@Test fun `a 200 of plain text is a client error`()   // LRCLIB answers malformed queries in plain text
@Test fun `404 is not found and is never retried`()   // retryDelayMs(NOT_FOUND, …) == null
@Test fun `429 waits at least the Retry-After it was given`() {
    val delay = retryDelayMs(Reply.RATE_LIMITED, retryAfterSec = 7, attempt = 1, jitterMs = 120)
    assertEquals(7_120L, delay)   // LRCLIB's docs: a client MUST honour Retry-After, plus jitter
}
@Test fun `429 without Retry-After backs off exponentially`()  // attempt 1 -> 500+j, 2 -> 1000+j
@Test fun `a backoff is capped`()                     // retryAfterSec = 86_400 -> MAX_BACKOFF_MS + jitter
@Test fun `the last attempt does not ask for another`()  // attempt == MAX_ATTEMPTS -> null
@Test fun `a 503 is retried and a 400 is not`()
@Test fun `outcomeOf maps every Reply`()              // exhaustive when(): JSON -> FOUND, NOT_FOUND -> NO_ENTRY, RATE_LIMITED -> RATE_LIMITED, BUSY/CLIENT_ERROR/SERVER_ERROR -> ERROR. OFFLINE has no Reply; the client raises it from an IOException.
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :prepare:testDebugUnitTest --tests '*RetryPolicyTest*'`
Expected: FAIL with unresolved references.

- [ ] **Step 3: Implement `RetryPolicy.kt` and `Http.kt`**

`retryDelayMs` returns null for `JSON`, `NOT_FOUND`, `CLIENT_ERROR`, and for
`attempt >= MAX_ATTEMPTS`. Otherwise it returns `retryAfterSec * 1000` when the header gave
one, else `BASE_BACKOFF_MS shl (attempt - 1)`, coerced to at most `MAX_BACKOFF_MS`, then plus
`jitterMs`. The caller supplies the jitter, so the function stays pure and testable.

- [ ] **Step 4: Implement `UrlConnectionHttp.kt`**

`HttpURLConnection` with the two timeouts, `setRequestProperty("User-Agent", userAgent(versionName))`,
`setRequestProperty("Accept", "application/json")`, `instanceFollowRedirects = true`. Read the
body from `inputStream` for 2xx and from `errorStream` otherwise, as UTF-8; `disconnect()` in a
`finally`. Reads `getHeaderFieldInt("Retry-After", -1)` and maps -1 to null. Runs on
`Dispatchers.IO`. **It does not log the body.**

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd android && ./gradlew :prepare:testDebugUnitTest`
Expected: PASS.

- [ ] **Step 6: Write ledger entry L51**

A new `### L51 — Android LRCLIB client: timeouts, pacing and backoff (service guidance, not
measurements)` section, in the style of L43–L47. It must state, for each constant: what it
gates, and that nothing was measured. Record that `PACING_DELAY_MS` and the `Retry-After`
rule come from LRCLIB's published documentation ("send requests sequentially… add a short
delay between requests (200–500 ms)"; "Your client **must** honor Retry-After"), read on
2026-11-19 at `https://lrclib.net/docs.txt`, and that the timeouts are a guess made with no
observation of the service's real latency from a phone. Add a second paragraph recording the
deliberate absence: **no title/artist similarity threshold and no acceptance cut-off exist in
this client**, because the server's ±2 s duration rule decides rung 1 and the user decides
everything else — the PWA's scoring machinery was not carried over.

- [ ] **Step 7: Commit**

```bash
git add android/prepare docs/superpowers/audits/2026-09-28-measurement-ledger.md
git commit -m "feat(prepare): HTTP transport and a tested retry policy"
```

---

### Task 3: Reading the file's tags

**Files:**
- Create: `android/prepare/src/main/kotlin/net/ninjaruss/utasync/prepare/AudioTags.kt`
- Modify: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/Import.kt` — `importAudio`
- Modify: `android/app/build.gradle.kts` — `implementation(project(":prepare"))`
- Test: `android/prepare/src/test/kotlin/net/ninjaruss/utasync/prepare/AudioTagsTest.kt`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `data class AudioTags(val title: String? = null, val artist: String? = null, val album: String? = null, val durationMs: Long? = null)`;
  `fun readTags(context: Context, uri: Uri): AudioTags`;
  `fun tagsFromFilename(displayName: String): AudioTags`;
  `fun mergeTags(embedded: AudioTags, fromName: AudioTags): AudioTags`.

This is §6.2's fix in two parts: read the duration, and then (Task 5) actually send it.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun `artist - title dot mp3 splits on the first dash`()      // "Kenshi Yonezu - Lemon.mp3"
@Test fun `a leading track number is dropped`()                     // "03 - Lemon.mp3" -> title "Lemon", artist null
@Test fun `a bare name becomes the title`()                         // "Lemon.mp3" -> title "Lemon"
@Test fun `underscores are not treated as separators`()             // the name is kept as-is
@Test fun `embedded tags win over the filename, field by field`()   // embedded artist + filename title
@Test fun `a blank embedded tag does not beat the filename`()       // artist = "" -> filename's artist used
@Test fun `merge keeps the embedded duration`()                     // tagsFromFilename never sets one
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :prepare:testDebugUnitTest --tests '*AudioTagsTest*'`
Expected: FAIL.

- [ ] **Step 3: Implement `AudioTags.kt`**

`tagsFromFilename` and `mergeTags` are pure. `readTags` uses `MediaMetadataRetriever`
(`METADATA_KEY_TITLE`, `METADATA_KEY_ARTIST`, `METADATA_KEY_ALBUM`, `METADATA_KEY_DURATION`),
is wrapped in `use {}` (API 29+) or a `try/finally release()`, and returns an empty
`AudioTags()` rather than throwing on any failure — an unreadable file must still import.
Blank strings become null.

- [ ] **Step 4: Wire it into `importAudio`**

`importAudio` fills `SongEntity.title`, `artist` and `durationMs` from
`mergeTags(readTags(context, uri), tagsFromFilename(displayName))`, falling back to the
current behaviour (`displayName.substringBeforeLast('.')`) when there is no title.

- [ ] **Step 5: Run the tests and build**

Run: `cd android && ./gradlew :prepare:testDebugUnitTest :app:assembleDebug`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add android/prepare android/app
git commit -m "feat(prepare): read title, artist and duration from the audio file"
```

---

### Task 4: Turning a lyric source into a sheet

**Files:**
- Create: `android/align/src/main/kotlin/net/ninjaruss/utasync/align/Sheet.kt`
- Test: `android/align/src/test/kotlin/net/ninjaruss/utasync/align/SheetTest.kt`

**Interfaces:**
- Consumes: `parseLrc` from `Lrc.kt`.
- Produces: `sealed interface Sheet { data class Timed(val lines: List<LrcLine>) : Sheet; data class Untimed(val lines: List<String>) : Sheet; data object None : Sheet }`;
  `fun sheetFrom(synced: String?, plain: String?, instrumental: Boolean): Sheet`;
  `fun splitPastedLyrics(text: String): List<String>`.

This is the one place that decides whether a lyric source is singable, words-only, or
nothing. It is pure Kotlin so it runs in CI, and it owns Review Focus items 2 and 3.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun `synced lyrics with time tags are Timed`()
@Test fun `plain lyrics alone are Untimed`()
// Review Focus 2.
@Test fun `a synced block with no time tags falls back to the plain lyrics`() {
    assertEquals(Sheet.Untimed(listOf("one", "two")), sheetFrom(synced = "one\ntwo", plain = "one\ntwo", instrumental = false))
}
@Test fun `a synced block with no time tags and no plain lyrics is None`()
// Review Focus 3.
@Test fun `an instrumental is None even if a lyric field is non-null`()
@Test fun `both null is None`()

@Test fun `pasted lyrics drop blank lines and trim each line`()
@Test fun `pasted lyrics accept CRLF`()
@Test fun `pasted lyrics keep interior spacing inside a line`()
@Test fun `pasting only whitespace yields no lines`()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :align:test --tests '*SheetTest*'`
Expected: FAIL.

- [ ] **Step 3: Implement `Sheet.kt`**

`sheetFrom` returns `None` when `instrumental` is true. Otherwise it tries `parseLrc(synced)`
and returns `Timed` only when the result is non-empty; else it splits `plain` the way
`splitPastedLyrics` does and returns `Untimed` when that is non-empty; else `None`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd android && ./gradlew :align:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/align
git commit -m "feat(align): decide whether a lyric source is timed, words-only or nothing"
```

---

### Task 5: The ladder — fetch, store, and never disturb a pin

**Files:**
- Create: `android/prepare/src/main/kotlin/net/ninjaruss/utasync/prepare/Lrclib.kt`
- Create: `android/prepare/src/main/kotlin/net/ninjaruss/utasync/prepare/Preparation.kt`
- Create: `android/prepare/src/main/kotlin/net/ninjaruss/utasync/prepare/FetchSetting.kt`
- Modify: `android/data/src/main/kotlin/net/ninjaruss/utasync/data/Entities.kt` — `SongEntity.prepareState`
- Modify: `android/data/src/main/kotlin/net/ninjaruss/utasync/data/SongDao.kt` — `setPrepareState`, `setTitleArtist`
- Modify: `android/app/src/main/AndroidManifest.xml` — `<uses-permission android:name="android.permission.INTERNET" />`
- Test: `android/prepare/src/test/kotlin/net/ninjaruss/utasync/prepare/LrclibTest.kt`
- Test: `android/prepare/src/test/kotlin/net/ninjaruss/utasync/prepare/PreparationTest.kt`

**Interfaces:**
- Consumes: Task 1's `TrackQuery`/`getUrl`/`searchUrl`/`parseTrack`/`parseTracks`; Task 2's
  `HttpGet`/`classify`/`retryDelayMs`/`outcomeOf`/`LookupOutcome`; Task 3's `AudioTags`;
  Task 4's `sheetFrom`.
- Produces:
  `data class LookupResult(val outcome: LookupOutcome, val track: LrclibTrack?, val candidates: List<LrclibTrack>)`;
  `class Lrclib(private val http: HttpGet, private val versionName: String, private val sleep: suspend (Long) -> Unit = { delay(it) }, private val jitter: () -> Long = { Random.nextLong(0, 250) })`
  with `suspend fun get(q: TrackQuery): LookupResult` and `suspend fun search(q: TrackQuery): LookupResult`;
  `sealed interface PrepareOutcome { data class Synced(val lineCount: Int) : PrepareOutcome; data class WordsOnly(val lineCount: Int) : PrepareOutcome; data class NeedsChoice(val candidates: List<LrclibTrack>) : PrepareOutcome; data class NotFound(val outcome: LookupOutcome) : PrepareOutcome; data object RefusedHasPins : PrepareOutcome; data object Disabled : PrepareOutcome }`;
  `suspend fun prepareSong(dao: SongDao, lrclib: Lrclib, song: SongEntity, allowReplaceSheet: Boolean = false): PrepareOutcome`;
  `suspend fun adoptTrack(dao: SongDao, songId: Long, track: LrclibTrack): PrepareOutcome`;
  `class FetchSetting(context: Context)` with `var enabled: Boolean` (SharedPreferences
  `"utasync"`, key `"fetch_lyrics"`, **default true** per §5.4).

`SongEntity` gains `val prepareState: String = "pending"` — one of `"pending"`, `"fetching"`,
`"done"`, `"no-match"`, `"failed"`, `"off"`. It records *what preparation has been attempted*,
never what the lines contain, so it cannot drift from them.

`"no-match"` and `"failed"` are kept apart on purpose. `"no-match"` is LRCLIB answering and
having nothing usable for this song — no record, an instrumental, candidates the user must pick
among — or no query being formable at all (no title, or no artist, per the ruling in §Task 3).
`"failed"` is the service not being reached: offline, rate-limited, an error. Collapsing them
would make the app say "Couldn't reach LRCLIB" about a lookup that reached LRCLIB perfectly
well, and offer a retry that cannot help. `NeedsChoice` stores `"no-match"` rather than taking a
value of its own, because the candidate list lives in the `PrepareOutcome` and is not persisted:
a stored "needs-choice" would promise a payload that does not survive process death, and both
states lead to the same action anyway.

**Schema note for the commit message and the README:** this changes Room's identity hash
while `version` stays 1, exactly as `writtenAtMs` did. There is no migration and no
`fallbackToDestructiveMigration`, so a developer with an older build must uninstall it. The
app has never shipped.

- [ ] **Step 1: Write the failing tests**

```kotlin
// LrclibTest.kt — a fake HttpGet returns scripted responses; `sleep` records its argument.
@Test fun `a 200 record is FOUND and carries the track`()
@Test fun `a 404 is NO_ENTRY with a null track and no retry`()
@Test fun `an IOException is OFFLINE`()
@Test fun `a 429 is retried after the Retry-After it was given, then gives up as RATE_LIMITED`() {
    // asserts the recorded sleep durations, so "honours Retry-After" is proved, not assumed
}
@Test fun `search returns every candidate the array held`()
@Test fun `search paces its request`()            // PACING_DELAY_MS observed before the call
@Test fun `the request carries the app user agent`()  // the fake asserts the header value

// PreparationTest.kt — a fake SongDao records the calls made to it.
@Test fun `a synced record stores timed lines and marks the song done`()
@Test fun `a plain record stores untimed lines`()   // every startMs is null
@Test fun `an instrumental record stores no lines and reports NotFound`()
@Test fun `a 404 falls through to search and returns NeedsChoice`()
@Test fun `a 404 with no candidates returns NotFound(NO_ENTRY)`()
@Test fun `a song with no title is not looked up`()
@Test fun `the duration is sent, rounded to whole seconds`()   // §6.2 — the PWA's defect
// Review Focus 1 — the one that matters most.
@Test fun `a song with a user pin is not re-sheeted`() {
    // dao has a source = "user" anchor
    assertEquals(PrepareOutcome.RefusedHasPins, prepareSong(dao, lrclib, song, allowReplaceSheet = false))
    assertTrue(dao.replaceLinesCalls.isEmpty())
    assertTrue(dao.deletedAnchors.isEmpty())
}
@Test fun `allowReplaceSheet lets the user go ahead, and still writes no anchor`()
@Test fun `fetching is skipped and recorded as off when the setting is disabled`()
@Test fun `prepareState is fetching during the call and done or failed after`()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :prepare:testDebugUnitTest`
Expected: FAIL.

- [ ] **Step 3: Implement `Lrclib.kt`**

`get` and `search` each loop up to `MAX_ATTEMPTS`: call `http.get`, catch `IOException` as
`OFFLINE` (not retried — a phone with no network will not have one a second later), then
`classify`, then `retryDelayMs`; on a retry, `sleep` the returned delay. Before each request
after the first in a lookup, `sleep(PACING_DELAY_MS)`. On `Reply.JSON`, parse and return.

- [ ] **Step 4: Implement `Preparation.kt` and `FetchSetting.kt`**

`prepareSong` in order: return `Disabled` if the setting is off; return `RefusedHasPins` if
`dao.anchors(song.id).any { it.source == "user" }` and not `allowReplaceSheet`; set
`prepareState = "fetching"`; `lrclib.get(…)` with `durationSec = song.durationMs?.div(1000)?.toInt()`;
on `FOUND`, hand the track to `adoptTrack`; on `NO_ENTRY`, `lrclib.search(…)` and return
`NeedsChoice` when it has candidates; otherwise `NotFound`. `prepareState` ends `"done"` on a
stored sheet and `"failed"` otherwise.

`adoptTrack` calls `sheetFrom`, maps a `Timed` sheet to `LineEntity`s the way `importLrc`
already does (`startMs` from `timeSec`, `endMs` from the next row's start) and an `Untimed`
sheet to `LineEntity`s with `startMs = null, endMs = null`, then `dao.replaceLines`. It also
sets `SongEntity.lyricsSource = "lrclib"`. **It never touches an anchor.**

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd android && ./gradlew :prepare:testDebugUnitTest :data:testDebugUnitTest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add android docs
git commit -m "feat(prepare): the LRCLIB ladder, which refuses to re-sheet a pinned song"
```

---

### Task 6: Readiness, shown honestly — and the automatic lookup that makes it move

**Files:**
- Create: `android/data/src/main/kotlin/net/ninjaruss/utasync/data/Readiness.kt`
- Modify: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/LibraryScreen.kt`
- Modify: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/PlayerScreen.kt` (the
  `lines.isEmpty()` branch — locate it by content, the line number has drifted)
- Test: `android/data/src/test/kotlin/net/ninjaruss/utasync/data/ReadinessTest.kt`

**Interfaces:**
- Consumes: Task 5's `prepareState` values — `"pending"`, `"fetching"`, `"done"`,
  `"no-match"`, `"failed"`, `"off"` — plus `prepareSong`, `FetchSetting` and `PrepareOutcome`.
- Produces: `enum class Readiness { FETCHING, NO_LYRICS, NO_MATCH, FETCH_FAILED, WORDS_ONLY, SINGABLE }`;
  `fun readinessOf(prepareState: String, lineCount: Int, timedLineCount: Int): Readiness`.

§6.3: a song has a visible readiness state, and a song opened before it is ready says so
plainly rather than showing bad timings. §5.4: lyric fetching is **on by default**, because
asking per song would reintroduce exactly the hassle goal 1 removes.

`NO_MATCH` and `FETCH_FAILED` must stay distinct and must never be collapsed into one message.
"Couldn't reach LRCLIB" when LRCLIB answered and simply had nothing is a false statement to the
user, and a retry button on it would be a second lie. `NO_MATCH` means *you* must act;
`FETCH_FAILED` means a retry is worth a tap.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun `fetching wins over whatever the lines say`()
@Test fun `no lines and a failed fetch is FETCH_FAILED`()
@Test fun `no lines and no match is NO_MATCH, not FETCH_FAILED`()
@Test fun `no lines and a pending fetch is NO_LYRICS`()
@Test fun `lookup turned off reads as NO_LYRICS, never as a failure`()
@Test fun `lines with no times are WORDS_ONLY`()
@Test fun `every line timed is SINGABLE`()
@Test fun `a partly timed song is WORDS_ONLY, not SINGABLE`()  // honesty: half-timed is not singable
@Test fun `a song with lines is never NO_MATCH, whatever the prepare state says`()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :data:testDebugUnitTest --tests '*ReadinessTest*'`
Expected: FAIL.

- [ ] **Step 3: Implement `Readiness.kt`**

Pure `when`, in the order the tests fix. `"off"` is treated exactly like `"pending"`: nothing
has been attempted, which is not a failure.

- [ ] **Step 4: Show it**

`LibraryScreen` adds the state to each row's `supportingContent`: "Finding lyrics…",
"No lyrics yet", "No lyrics found — tap to search or paste" (`NO_MATCH`), "Couldn't reach
LRCLIB — tap to retry" (`FETCH_FAILED`), "Words only — not timed yet", or the artist when
`SINGABLE`. `PlayerScreen`'s `lines.isEmpty()` branch is replaced by a message per `Readiness`;
a `WORDS_ONLY` song shows its words with no highlight and a line saying the timing is not done,
rather than highlighting line 1 at 0:00.

- [ ] **Step 5: Trigger the lookup on import**

Nothing in the plan called `prepareSong` before this step, so the whole ladder sat behind a
button the user would have to find — the opposite of §5.4. In `LibraryScreen`, after
`importAudio` returns a song id, launch `prepareSong` for that song in the screen's
coroutine scope, passing `fetchEnabled` from `FetchSetting`. The import must not block on it:
the song appears in the library immediately and its row's readiness changes as the fetch
proceeds, which is what the Room `Flow` already gives for free.

Discard the `PrepareOutcome` here — every state the user needs is already in `prepareState` and
the lines, both of which the `Flow` observes. Do not hold outcome state in the composable.

- [ ] **Step 6: Run the tests and build**

Run: `cd android && ./gradlew :data:testDebugUnitTest :prepare:testDebugUnitTest :app:assembleDebug`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add android/data android/app
git commit -m "feat(app): say plainly where a song is in preparation, and look lyrics up on import"
```

---

### Task 7: The two rungs the user drives — choose a result, or paste

**Files:**
- Create: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/LyricsSourceScreen.kt`
- Modify: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/PlayerScreen.kt` — the Lyrics… entry point
- Test: `android/app/src/test/kotlin/net/ninjaruss/utasync/ui/CandidateLabelTest.kt`

**Interfaces:**
- Consumes: Task 5's `PrepareOutcome`, `adoptTrack`, `LrclibTrack`; Task 4's `splitPastedLyrics`.
- Produces: `fun candidateLabel(track: LrclibTrack): String`;
  `@Composable fun LyricsSourceScreen(songId: Long, dao: SongDao, lrclib: Lrclib, onDone: () -> Unit)`.

One screen, four ways in: *Find lyrics* (re-run `prepareSong`), *choose one of these results*,
*paste the words*, *import an .lrc* (the existing rung 4). **No automatic choice is made
among candidates** — that is the whole reason this screen exists rather than a threshold.

- [ ] **Step 1: Write the failing test**

```kotlin
@Test fun `a candidate shows what tells recordings apart`() {
    val t = LrclibTrack(1, "Lemon", "Kenshi Yonezu", "BOOTLEG", 256, false, null, "[00:12.00]…")
    assertEquals("Lemon · Kenshi Yonezu · BOOTLEG · 4:16 · timed", candidateLabel(t))
}
@Test fun `a candidate with only plain lyrics says words only`()
@Test fun `a candidate with no duration says so rather than showing 0_00`()
@Test fun `an instrumental candidate is labelled instrumental`()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*CandidateLabelTest*'`
Expected: FAIL.

- [ ] **Step 3: Implement `candidateLabel` and `LyricsSourceScreen`**

The label puts duration and timed/words-only in front of the user because those are what
distinguish a studio cut from a live take — the same signal §6.2 says the query must carry.
Tapping a candidate calls `adoptTrack`. Pasting calls `splitPastedLyrics` and stores untimed
lines with `lyricsSource = "paste"`. Both paths go through the same
`RefusedHasPins` confirmation as Task 5: when the song has user pins, a dialog names the
count and asks, in the wording `TapAlongScreen` already uses for replacing pins.

This screen also carries the **only** control for `FetchSetting` — a switch reading
"Look up lyrics automatically", on by default (§5.4). Without it the setting Task 5 added is
not disableable by anyone, which is the thing the spec asks for. Turning it off leaves this
screen's manual buttons working: §5.4's "disabling it simply means every song takes rung 3
or 4".

- [ ] **Step 4: Run the tests and build**

Run: `cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app
git commit -m "feat(app): choose a lyric result or paste the words"
```

---

### Task 8: Export back out as an .lrc

**Files:**
- Create: `android/align/src/main/kotlin/net/ninjaruss/utasync/align/LrcWriter.kt`
- Modify: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/PlayerScreen.kt` — an Export action
- Modify: `android/README.md`
- Test: `android/align/src/test/kotlin/net/ninjaruss/utasync/align/LrcWriterTest.kt`

**Interfaces:**
- Consumes: `resolveStarts` from `:data`.
- Produces: `data class LrcExport(val text: String, val droppedLines: Int)`;
  `fun writeLrc(rows: List<Pair<Long?, String>>): LrcExport`.

§6: "Anything the user fixes exports back out as a plain `.lrc` that any player understands.
Work done here is never trapped in this app." The times exported are the **resolved** ones,
so a user's pins are what leaves the app.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun `a timed line is written as mm ss xx`()        // 12_340 -> "[00:12.34]text"
@Test fun `an hour-long position does not overflow the minutes field`()  // 3_723_000 -> "[62:03.00]"
@Test fun `rounding is to the nearest centisecond`()     // 12_345 -> "[00:12.35]"  (one unambiguous rule)
@Test fun `untimed lines are left out and counted`()
@Test fun `rows are written in the order given, not re-sorted`()
@Test fun `an empty list writes an empty string and drops nothing`()
@Test fun `the round trip through parseLrc returns the same times and text`()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :align:test --tests '*LrcWriterTest*'`
Expected: FAIL.

- [ ] **Step 3: Implement `LrcWriter.kt`**

No `[offset:]` tag and no metadata tags: the exported times are absolute and already include
every correction, so an offset would double-count.

- [ ] **Step 4: Wire the Export action**

An overflow-menu item in `PlayerScreen` that launches `ActivityResultContracts.CreateDocument("text/plain")`
with a default name of `"<title>.lrc"`, writes `writeLrc(resolveStarts(lines, anchors).zip(lines.map { it.text }))`,
and reports `droppedLines` in a snackbar when it is non-zero.

- [ ] **Step 5: Update `android/README.md`**

Add `:prepare` to the module table. Replace the "No network calls (the manifest has no
INTERNET permission yet; LRCLIB comes next)" acceptance line with what is now true: the
`INTERNET` permission exists, it is used during preparation only, lyric fetching defaults to
on and is disableable, and a prepared song plays with no network. Add the uninstall warning
for the `prepareState` schema-hash change beside the existing `writtenAtMs` one. Correct the
test count and the CI command to include `:prepare:testDebugUnitTest`.

- [ ] **Step 6: Run everything**

Run: `cd android && ./gradlew :align:test :data:testDebugUnitTest :playback:testDebugUnitTest :prepare:testDebugUnitTest :app:testDebugUnitTest :app:assembleDebug`
Expected: PASS. Confirm the README's stated count matches what this run reports.

- [ ] **Step 7: Commit**

```bash
git add android
git commit -m "feat(align): export the resolved timings as a plain .lrc"
```

---

## What this plan does not do

Named so no one later reads its absence as an oversight.

- **It does not time anything.** Rungs 2 and 3 end with the words known and the song marked
  `WORDS_ONLY`. Computing *when* is ADR-0003's engine, and the best measured Japanese result
  so far is a p50 of 3.69 s against §8.5's 250 ms target (ledger L48).
- **No WorkManager, no background queue.** §6.3's queue exists for alignment, which takes
  minutes; a lyric fetch takes seconds and runs in the screen's coroutine scope. Adding
  WorkManager is a dependency, so it waits for the work that needs it (CLAUDE.md rule 5).
- **No verification of a fetched LRC.** §6 fixes this: rung 1 is fetch-and-trust in v1,
  because a verification pass is a model run and would destroy the two seconds that are the
  rung's whole point. The nudge is the remedy.
- **No `/api/v2/search`.** Its documentation marks it beta and outside the v1 compatibility
  guarantee, and it returns no lyrics inline, so it would cost a second request per candidate.
- **No per-line confidence.** §7.7's column and its scored flag belong with the aligner that
  would populate them; a fetched LRC is never flagged (§7.7).
