# Understanding Japanese while you sing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Furigana over the Japanese by default, and one tap for what a word means and what it is
doing in the line — entirely offline, from bundled data.

**Architecture:** A new `:japanese` module holds tokenisation, readings, roles and sense
selection. Tokenisation comes from **Atilika Kuromoji**, the JVM library the PWA was using a JS
port of, which returns surface, reading and part-of-speech in one call. JMdict is converted at
build time into a Room table with an exact key, replacing three runtime JSON blobs. **The accuracy
audit is a release gate (§7a.2), so it is Task 1 — every task after it is measured by the same
instrument, and its counts only ratchet down.**

**Tech Stack:** Kotlin 2.1.0 (`-Werror`), `com.atilika.kuromoji:kuromoji-ipadic`, Room + KSP,
Jetpack Compose, JDK 17, SDK 35.

**Spec:** `docs/superpowers/specs/2026-11-22-android-understanding-design.md` — read it first; §4.2,
§7, §7a and §8 carry decisions no task repeats.

## Global Constraints

- **Offline and bundled.** No network in this feature, at preparation or playback, and nothing
  fetched on first run.
- **Two dependencies, both owner-approved, and no others:** `com.atilika.kuromoji:kuromoji-ipadic`
  (Apache-2.0) and a vendored JMdict. Anything further is asked for first (CLAUDE.md rule 5).
- **IPADIC, not UniDic.** The PWA's gloss and role behaviour was tuned against IPADIC's
  part-of-speech tagset; changing tagset silently invalidates that inheritance.
- **No copyrighted song text anywhere in the repository**, corpus and fixtures included (rule 6,
  ADR-0004). The audit corpus is non-copyrighted sentences, so it is committed in the clear and
  stays inspectable.
- **`src/ai-pipeline/` is not ported** (ADR-0002). Its *behaviour* is the reference for sense
  selection; its code is not translated.
- **No behaviour-gating number without a measurement** (rule 2). That includes Kuromoji's load
  budget and the audit's passing bar. Measure, then record in
  `docs/superpowers/audits/2026-09-28-measurement-ledger.md`.
- **The app claims nothing about reading or definition accuracy** — in the UI, the README or a
  commit message — until the Task 1 instrument has been run and its counts recorded.
- **JMdict requires attribution in the app**, not merely in a file (CC-BY-SA, EDRDG).
- **Kotlin builds with `-Werror`**; `allWarningsAsErrors` is live in all modules.
- **Every task verifies with the full CI command**, not a subset:
  `cd android && ./gradlew :align:test :data:testDebugUnitTest :playback:testDebugUnitTest :prepare:testDebugUnitTest :japanese:testDebugUnitTest :app:testDebugUnitTest :app:assembleDebug`
- **Small diffs, one concern each.** No drive-by refactors.

## Review Focus

Five ways this could be wrong in a user's hands that no task's happy path exercises. Each is
pinned to a test in the task that owns the code.

1. **A surface with alternate readings shown as if it had one.** The §4.2 anti-goal: the app must
   never silently assert a reading for a kanji that is read more than one way. → Task 3 asserts
   that a surface with alternates is marked, and that the mark survives into the popover.
2. **The popover's reading disagreeing with the ruby above the line.** Two readings for one word
   on one screen. → Task 5 asserts both come from one call, for the same token, in the same mode.
3. **A line that is not Japanese.** Mixed-script lyrics are common here; an English word or a
   Latin-script line must produce no ruby and no entry, not a crash or a bogus match. → Task 2
   asserts tokenising an ASCII line, and Task 7 asserts it renders with no ruby.
4. **An inflected form that never reaches its dictionary form**, so the word shows no meaning at
   all. The PWA took several rounds to get blanks from 18 down to 3. → Task 5 asserts a conjugated
   verb and an adjective in a non-dictionary form both resolve.
5. **A homograph showing the wrong sense.** The line view shows one meaning per word, so this is on
   screen every time rather than buried. → Task 5 asserts a surface with two senses picks by the
   token's part-of-speech, not by first entry.

---

### Task 1: The audit instrument and its corpus — the gate, before any feature

**Files:**
- Create: `android/japanese/build.gradle.kts`, `android/japanese/src/main/AndroidManifest.xml`
- Create: `android/japanese/src/main/kotlin/net/ninjaruss/utasync/japanese/WordInfo.kt`
- Create: `android/japanese/src/main/kotlin/net/ninjaruss/utasync/japanese/Analyze.kt`
- Create: `android/japanese/src/test/resources/reading-corpus.json`
- Create: `android/japanese/src/test/resources/audit-baseline.json`
- Create: `android/japanese/src/test/kotlin/net/ninjaruss/utasync/japanese/UnderstandingAuditTest.kt`
- Modify: `android/settings.gradle.kts`, `.github/workflows/android.yml`

**Interfaces:**
- Consumes: nothing.
- Produces — **every shared data type is defined here**, so no later task redefines one and no
  signature drifts between the stub and the real thing:
  `data class JaToken(val surface: String, val reading: String?, val pos: String, val baseForm: String?, val start: Int)`;
  `data class Sense(val posLabel: String?, val glosses: List<String>)`;
  `data class Ruby(val base: String, val reading: String?, val alternates: List<String>)`;
  `enum class ReadingMode { OFF, DICTIONARY, SUNG }`;
  `data class WordInfo(val token: JaToken, val ruby: Ruby?, val senses: List<Sense>, val role: String?)`;
  `suspend fun analyze(text: String, mode: ReadingMode): List<WordInfo>` — a **stub returning an
  empty list** in this task, with the signature it will keep;
  `data class AuditCounts(val words: Int, val wrongReading: Int, val wrongSense: Int, val blank: Int, val unmarkedAlternates: Int)`;
  `fun auditAgainst(corpus: Corpus, analyze: (String) -> List<WordInfo>): AuditCounts`.

**Why this is first:** §7a.2 makes the audit a release gate. A gate written after the feature
measures whatever the feature happens to do. Written first, against a stub, it reports everything
wrong — which is the honest baseline, and the RED run for the whole plan.

**The corpus, and why its truth has to come from outside the system.** Expectations must not be
produced by the mechanism under test: a corpus labelled by Kuromoji and checked against Kuromoji
proves only that it is self-consistent. This project has already paid for that lesson once —
see the aligner's self-snapshot scorecard in the audits directory. So each entry carries its
source, and only hand-labelled entries count toward the gate. Reuse the vocabulary
`scripts/lib/truthKinds.mjs` established for alignment truth: a `kind` per entry, with
`hand-labelled` the only kind that certifies.

Corpus shape — about 40 short sentences to begin, **written or verified by the owner**, weighted
toward the hard cases (surfaces with alternate readings, conjugated verbs, homographs):

```json
{ "v": 1, "entries": [
  { "text": "<a short non-copyrighted Japanese sentence>",
    "kind": "hand-labelled",
    "source": "owner",
    "words": [ { "surface": "明白", "reading": "めいはく", "sense": "obvious", "alternates": ["あからさま"] } ] }
] }
```

- [ ] **Step 1: Write the failing test**

```kotlin
@Test fun `the audit reports every word wrong against a stub analyzer`() {
    val counts = auditAgainst(loadCorpus(), ::analyze)
    assertTrue(counts.words > 0)                 // the corpus is not empty
    assertEquals(counts.words, counts.blank)     // a stub supplies no meanings at all
}

@Test fun `only hand-labelled entries count toward the gate`()  // a `kind` of "generated" is scored but never certifies
@Test fun `the corpus carries no Latin-script song text`()      // guards rule 6 by shape, not by trust
@Test fun `the committed baseline matches the current counts`()  // the ratchet every later task must move
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :japanese:testDebugUnitTest`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Create the module**

`android/japanese/build.gradle.kts` follows `prepare/build.gradle.kts`: `android.library` +
`kotlin.android`, `namespace = "net.ninjaruss.utasync.japanese"`, `compileSdk = 35`,
`minSdk = 26`, `jvmToolchain(17)`, `allWarningsAsErrors = true`, `testImplementation(libs.junit)`.
Add `:japanese` to `settings.gradle.kts` and `:japanese:testDebugUnitTest` to the CI workflow.

- [ ] **Step 4: Write the corpus, and have the owner verify it**

Hand-label the entries. **Do not generate the expected readings from a tokeniser.** Where you are
unsure of a reading, mark the entry `"kind": "unverified"` and leave it out of the gate rather
than guessing — an unverified expectation that happens to match a bug is worse than no entry.
Report in your task report how many entries are `hand-labelled` versus `unverified`.

- [ ] **Step 5: Implement `WordInfo.kt`, `Analyze.kt` (stub) and the audit**

`auditAgainst` walks the **corpus's** words — so `words` is the corpus's count, not the
analyzer's — calls the analyzer per sentence, matches by surface, and counts a corpus word the
analyzer did not return as `blank`. `unmarkedAlternates` counts a corpus word that has `alternates` where the result's
`ruby?.alternates` is empty — Review Focus 1, countable from day one.

- [ ] **Step 6: Run the tests, then record the baseline**

Run the full CI command. Write the resulting counts into `audit-baseline.json` and print them in
the task report. This is the number every later task has to improve.

- [ ] **Step 7: Commit**

```bash
git add android/japanese android/settings.gradle.kts .github/workflows/android.yml
git commit -m "test(japanese): the understanding audit, and its hand-labelled corpus"
```

---

### Task 2: Tokenisation with Kuromoji

**Files:**
- Modify: `android/japanese/build.gradle.kts`, `android/gradle/libs.versions.toml`
- Create: `android/japanese/src/main/kotlin/net/ninjaruss/utasync/japanese/Tokenizer.kt`
- Test: `android/japanese/src/test/kotlin/net/ninjaruss/utasync/japanese/TokenizerTest.kt`
- Modify: `docs/superpowers/audits/2026-09-28-measurement-ledger.md` — add **L52**

**Interfaces:**
- Consumes: Task 1's `JaToken`.
- Produces: `fun tokenize(text: String): List<JaToken>`; `object Ja { val tokenizer: Tokenizer }`
  (lazily constructed, so the dictionary loads once).

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun `a kanji word carries its surface, reading and part of speech`()
@Test fun `the reading comes back as hiragana, not katakana`()      // Kuromoji gives katakana
@Test fun `a conjugated verb carries its dictionary form`()          // baseForm, for Task 5's lookup
@Test fun `character offsets let a tap find its token`()             // `start` is a real index into `text`
// Review Focus 3.
@Test fun `an ASCII line tokenises without crashing and yields no readings`()
@Test fun `an empty string yields no tokens`()
@Test fun `a mixed Japanese and English line keeps both, in order`()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :japanese:testDebugUnitTest --tests '*TokenizerTest*'`
Expected: FAIL with unresolved `tokenize`.

- [ ] **Step 3: Add the dependency and implement `tokenize`**

`kuromoji-ipadic = { module = "com.atilika.kuromoji:kuromoji-ipadic", version = "0.9.0" }` in the
version catalog. `tokenize` maps each `com.atilika.kuromoji.ipadic.Token` to a `JaToken`, turning
the katakana reading into hiragana and leaving `reading` null where Kuromoji has none (which is
what an ASCII token gets).

- [ ] **Step 4: Run the tests to verify they pass, then measure the load**

Run the full CI command. Then measure, on the emulator, how long the first `tokenize` call takes
(it pays for the dictionary load) and how much memory the tokeniser holds. **Do not invent a
budget** — record what you observe.

- [ ] **Step 5: Write ledger entry L52**

Match the house style of L43–L51. State the measured first-call cost and memory, the device and
API level measured on, and the command to reproduce. State plainly that no budget is set and that
whether tokenisation runs at preparation time or on demand is still open, pending this number.

- [ ] **Step 6: Re-run the audit and move the baseline**

The audit's readings now come from a real tokeniser. Update `audit-baseline.json` and report the
before/after counts.

- [ ] **Step 7: Commit**

```bash
git add android docs/superpowers/audits/2026-09-28-measurement-ledger.md
git commit -m "feat(japanese): tokenise with Kuromoji, and measure what the dictionary costs"
```

---

### Task 3: Furigana — the reading, and the alternates it must not hide

**Files:**
- Create: `android/japanese/src/main/kotlin/net/ninjaruss/utasync/japanese/Readings.kt`
- Test: `android/japanese/src/test/kotlin/net/ninjaruss/utasync/japanese/ReadingsTest.kt`

**This task creates no asset.** `reading-alternates.json` is generated by Task 4's script and
wired in by Task 5; `rubyFor` takes its alternates source as a function, so it is complete and
tested here without one.

**Interfaces:**
- Consumes: Task 2's `tokenize`; Task 1's `JaToken`, `Ruby` and `ReadingMode`.
- Produces: `fun rubyFor(token: JaToken, mode: ReadingMode, alternates: (String) -> List<String>): Ruby?`
  — null where the token needs no ruby at all.

This task owns §4.2. The app shows the dictionary reading and **marks** a surface that is read more
than one way; it never asserts which reading is being sung, because nothing here knows.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun `a kana-only token needs no ruby`()                    // reading == surface -> null
@Test fun `OFF yields no reading even where one exists`()
// Review Focus 1 — the anti-goal, and the test that stops it regressing.
@Test fun `a surface with a known alternate reading is marked`() {
    val ruby = rubyFor(token("明白", reading = "めいはく"), DICTIONARY) { listOf("あからさま") }
    assertEquals("めいはく", ruby.reading)
    assertEquals(listOf("あからさま"), ruby.alternates)
}
@Test fun `a surface with no alternates is not marked`()
@Test fun `SUNG falls back to the dictionary reading while no audio reading exists`()
@Test fun `the alternates lookup is never handed an empty surface`()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :japanese:testDebugUnitTest --tests '*ReadingsTest*'`
Expected: FAIL.

- [ ] **Step 3: Implement `Readings.kt`**

Pure: no I/O, the alternates source injected as a function so it is testable without an asset.
`SUNG` currently behaves as `DICTIONARY` — leave a KDoc line saying that is where an engine's
`audioReading` would be promoted, and why it cannot be today.

- [ ] **Step 4: Run the tests and the full CI command, then move the baseline**

`unmarkedAlternates` should now be zero for every corpus word whose alternates the inventory
knows. Report the count and update the baseline.

- [ ] **Step 5: Commit**

```bash
git add android
git commit -m "feat(japanese): furigana that marks a reading it cannot be sure of"
```

---

### Task 4: The dictionary — build-time conversion into a Room table

**Files:**
- Create: `scripts/build-japanese-db.mjs`
- Create: `vendor/jmdict/README.md` (provenance: upstream, version, licence, attribution text)
- Create: `android/data/src/main/kotlin/net/ninjaruss/utasync/data/DictionaryEntity.kt`
- Modify: `android/data/src/main/kotlin/net/ninjaruss/utasync/data/SongDao.kt` or a new
  `DictionaryDao.kt` — a lookup by exact `(surface, reading)` and by `surface` alone
- Modify: `android/data/src/main/kotlin/net/ninjaruss/utasync/data/UtasyncDatabase.kt`
- Test: `tests/scripts/buildJapaneseDb.test.mjs` (this repo has no `scripts/__tests__`; `vitest run` scans `tests/`), and
  `android/data/src/androidTest/kotlin/net/ninjaruss/utasync/data/DictionaryTest.kt`

**Interfaces:**
- Consumes: the vendored `public/jmdict-*.json` as input.
- Produces: `@Entity(tableName = "dictionary") data class DictionaryEntity(val surface: String, val reading: String, val posLabel: String?, val glosses: List<String>, val senseIndex: Int)`
  — `glosses` crosses Room through a `@TypeConverter` in `:data`, so no caller parses a packed
  string; `suspend fun entriesFor(surface: String): List<DictionaryEntity>`;
  `suspend fun entriesFor(surface: String, reading: String): List<DictionaryEntity>`;
  `android/japanese/src/main/assets/reading-alternates.json`.

**The input is the PWA's existing `public/jmdict-*.json`, committed** — not raw JMdict XML fetched
during the build (§7, item 4). Those files are the shape the PWA's audit rounds corrected, so the
audited behaviour is inherited; and rule 5 forbids a build-time download.

**An exact key, not FTS.** This is a keyed lookup; a full-text index would be weight with no
purpose.

- [ ] **Step 1: Write the failing tests**

**The schema identity hash changes again.** Adding `DictionaryEntity` to `UtasyncDatabase` alters
Room's exported schema while `version` stays 1, for the **third** time on this app (after
`writtenAtMs` and `prepareState`). There is no migration and no `fallbackToDestructiveMigration`,
so an older build's database throws "cannot verify the data integrity" — a crash, not a message.
Say so in the commit message and add it to the README's existing uninstall warnings. Acceptable
only because the app has never shipped.

```js
// buildJapaneseDb.test.mjs — the conversion is where silent data loss lives.
test('every input surface appears in the output')              // count in == count out
test('a surface with two senses keeps both, in order')         // senseIndex preserved
test('the alternates file keeps the primary/alternate split')  // "めいはく|あからさま" -> primary + [alternates]
test('an entry with no gloss is dropped, and the drop is counted and reported')
```

```kotlin
// DictionaryTest.kt — real Room, run on a device.
@Test fun `a surface with two readings returns both rows`()
@Test fun `a lookup by surface and reading returns exactly one sense group`()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/__tests__/buildJapaneseDb.test.mjs`
Expected: FAIL — the script does not exist.

- [ ] **Step 3: Write the conversion script and the entity**

The script reads the vendored JSON, writes a SQLite file into
`android/data/src/main/assets/`, and writes `reading-alternates.json` into `:japanese`'s assets.
It **prints what it dropped and why** — a conversion that silently loses entries is how the
dictionary gets quietly worse. The database is loaded with Room's `createFromAsset`.

- [ ] **Step 4: Run the tests, report the sizes**

Run the vitest file and the full CI command. Report the asset's size on disk and the APK's size
before and after, measured not estimated — §5 of the spec cares about this and nobody has a figure.

- [ ] **Step 5: Run the instrumented test on a device and say so**

Run: `cd android && ./gradlew :data:connectedDebugAndroidTest`
Instrumented tests do not run in CI; report the result and that it was a device run.

- [ ] **Step 6: Commit**

```bash
git add scripts vendor android
git commit -m "feat(data): the dictionary, converted at build time into one keyed table"
```

---

### Task 5: Word lookup — the sense the word has in *this* line

**Files:**
- Create: `android/japanese/src/main/kotlin/net/ninjaruss/utasync/japanese/SenseSelection.kt`
- Modify: `android/japanese/src/main/kotlin/net/ninjaruss/utasync/japanese/Analyze.kt` — replace the stub
- Modify: `android/japanese/build.gradle.kts` — `api(project(":data"))`
- Test: `android/japanese/src/test/kotlin/net/ninjaruss/utasync/japanese/SenseSelectionTest.kt`

**Interfaces:**
- Consumes: Task 2's `tokenize`, Task 3's `rubyFor`, Task 4's `entriesFor` **and its
  `reading-alternates.json` asset**, which this task wires into `rubyFor`'s alternates argument.
- Produces: `fun selectSenses(token: JaToken, entries: List<DictionaryEntity>): List<Sense>`;
  the real `suspend fun analyze(text: String, mode: ReadingMode): List<WordInfo>`.
- **Leaves `WordInfo.role` null.** `roleOf` does not exist until Task 6, which fills it in. Do not
  invent a role here.

This task carries §7a.1: **the PWA's audited sense selection is the bar, not JMdict's first
sense.** Two rules its audits settled are rules here, not preferences:

1. **A plain noun must not have a part of speech forced onto it.**
2. **A grammar word gets one sense, not a list.**

- [ ] **Step 1: Write the failing tests**

```kotlin
// Review Focus 5.
@Test fun `a homograph picks the sense matching the token's part of speech`()
// Review Focus 4 — the PWA's blanks went 18 -> 3; these are what kept them falling.
@Test fun `a conjugated verb resolves through its dictionary form`()
@Test fun `an adjective in a non-dictionary form resolves`()
@Test fun `a word with no entry yields no senses rather than a wrong one`()
// The two inherited rules.
@Test fun `a plain noun keeps its own part of speech label`()
@Test fun `a grammar word yields exactly one sense`()
// Review Focus 2 — the consistency contract.
@Test fun `the WordInfo's ruby and its senses describe the same reading`()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :japanese:testDebugUnitTest --tests '*SenseSelectionTest*'`
Expected: FAIL.

- [ ] **Step 3: Implement `selectSenses` and the real `analyze`**

`selectSenses` is pure over `(token, entries)`, so it is testable without a database. `analyze`
composes tokenise → rubyFor → entriesFor → selectSenses, and is the single call both the ruby and
the popover read from — which is what makes Review Focus 2 structural rather than a convention.

- [ ] **Step 4: Run everything and move the baseline**

Run the full CI command. `wrongSense` and `blank` should fall sharply. **Report the counts
before and after, and name any corpus word still wrong** — those are the next round's work, and a
plan that hides them has learned nothing from the PWA's audit history.

- [ ] **Step 5: Commit**

```bash
git add android
git commit -m "feat(japanese): the sense a word has here, not its first dictionary entry"
```

---

### Task 6: Roles — what each element is doing

**Files:**
- Create: `android/japanese/src/main/kotlin/net/ninjaruss/utasync/japanese/Roles.kt`
- Modify: `android/japanese/src/main/kotlin/net/ninjaruss/utasync/japanese/Analyze.kt` — populate
  `WordInfo.role`, which Task 5 deliberately left null
- Test: `android/japanese/src/test/kotlin/net/ninjaruss/utasync/japanese/RolesTest.kt`

**Interfaces:**
- Consumes: Task 1's `JaToken` and `WordInfo`.
- Produces: `fun roleOf(token: JaToken, next: JaToken?): String?`.

§7.6 defines the scope exactly: the **role** of each element — "は marks the topic", "past tense",
"i-adjective modifying the next noun". Never why a lyricist chose a construction. This is the one
feature the parent design marked first to cut; it is cheap only because Kuromoji already carries
the part of speech.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun `the topic particle is named as such`()
@Test fun `a past-tense auxiliary is named`()
@Test fun `an i-adjective before a noun says it modifies it`()
@Test fun `an i-adjective at the end of a line does not claim to modify anything`()  // next == null
@Test fun `a word with no interesting role yields null rather than filler`()
@Test fun `no role text explains a choice, only names a function`()  // asserts the vocabulary stays mechanical
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :japanese:testDebugUnitTest --tests '*RolesTest*'`
Expected: FAIL.

- [ ] **Step 3: Implement `roleOf`**

A table from IPADIC part-of-speech (and the particle surface, for particles) to a short phrase.
Return null rather than inventing a description — a role nobody needs is noise on a lyric screen.

- [ ] **Step 4: Run everything and commit**

Run the full CI command.

```bash
git add android
git commit -m "feat(japanese): name what each element is doing, mechanically"
```

---

### Task 7: The screen — ruby, the line view, and the word popover

**Files:**
- Create: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/RubyText.kt`
- Create: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/WordPopover.kt`
- Create: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/LineWordsSheet.kt`
- Modify: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/PlayerScreen.kt` — the lyric rows
- Modify: `android/app/build.gradle.kts` — `implementation(project(":japanese"))`
- Test: `android/app/src/test/kotlin/net/ninjaruss/utasync/ui/RubyLayoutTest.kt`

**Interfaces:**
- Consumes: Task 5's `analyze`, Task 1's `WordInfo`/`Ruby`/`ReadingMode`, Task 6's `roleOf`.
- Produces: `@Composable fun RubyText(words: List<WordInfo>, onWordTap: (Int) -> Unit, modifier: Modifier)`;
  `fun rubyRuns(words: List<WordInfo>, maxWidthSp: Float): List<List<WordInfo>>` (pure
  line-breaking, so the wrapping rule is testable without a device). `onWordTap` receives the
  tapped word's index in `words`.

**Compose has no native ruby text** (§5). This is the largest piece of UI work in the plan and the
part most likely to be under-estimated.

**The line view is not a translation** (§4.1). It lists the line's words in order, each with its
meaning and role, and says so in its own heading. No prose, and no label implying one.

- [ ] **Step 1: Write the failing test**

```kotlin
@Test fun `a line too long for one row breaks between words, never inside a ruby group`()
@Test fun `a word with no reading occupies no ruby row`()
@Test fun `an all-ASCII line produces one run and no ruby`()   // Review Focus 3
@Test fun `the alternates mark travels with its word into the popover`()  // Review Focus 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*RubyLayoutTest*'`
Expected: FAIL.

- [ ] **Step 3: Implement `rubyRuns`, then `RubyText`, the popover and the line sheet**

`rubyRuns` is pure and tested; `RubyText` draws it. The popover shows headword, reading (with any
alternates), senses and role — the model Task 1 defined and the PWA's audits settled. Tapping a
word maps a character offset back to its token through `JaToken.start`.

- [ ] **Step 4: Run the tests and build**

Run the full CI command.

- [ ] **Step 5: See it, and say what you saw**

Instrumented and visual behaviour is not covered by any test here. Run the app on the emulator,
open a song with Japanese lines, and report what you observed — ruby placement, a wrapped line,
a tap landing on the right word. State plainly that nothing in this step is automated.

- [ ] **Step 6: Commit**

```bash
git add android
git commit -m "feat(app): furigana on the line, and a tap for what a word means"
```

---

### Task 8: The reading control, the attribution, and the gate's run

**Files:**
- Create: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/ReadingSetting.kt`
- Modify: `android/app/src/main/kotlin/net/ninjaruss/utasync/ui/LyricsSourceScreen.kt` — the control
- Modify: `android/README.md`
- Modify: `docs/superpowers/audits/2026-09-28-measurement-ledger.md` — **L53**
- Test: `android/app/src/test/kotlin/net/ninjaruss/utasync/ui/ReadingSettingTest.kt`

**Interfaces:**
- Consumes: Task 3's `ReadingMode`.
- Produces: `class ReadingSetting(context: Context)` with `var mode: ReadingMode`, default
  `DICTIONARY`, backed by the same `SharedPreferences` file as `FetchSetting`.

**One control, three states** — off, dictionary, sung-when-available — not two settings (§7,
item 9). Romaji is absent entirely.

**JMdict attribution appears in the app** (§5), not only in a file.

- [ ] **Step 1: Write the failing tests**

```kotlin
@Test fun `the default is the dictionary reading, never off`()
@Test fun `every ReadingMode round-trips through the setting`()   // derived over entries, not listed
@Test fun `a stored value the app no longer knows falls back to the default`()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*ReadingSettingTest*'`
Expected: FAIL.

- [ ] **Step 3: Implement the setting and the control, and add the attribution**

- [ ] **Step 4: Run the gate**

Run the audit and record the final counts. **This is the release gate of §7a.2.** Report
`words`, `wrongReading`, `wrongSense`, `blank`, `unmarkedAlternates`, and how many corpus entries
are `hand-labelled` versus `unverified`. **Set no passing bar** — rule 2 forbids inventing one.
The owner reads these numbers and decides.

- [ ] **Step 5: Write ledger entry L53 and update the README**

L53 records the gate's counts, the corpus's size and truth kinds, and the command to reproduce.
The README gains the `:japanese` module, the two dependencies with their licences, the
attribution requirement, and a plain statement of **what is not known**: that no reading is
claimed to be the sung one, and which corpus entries are unverified.

- [ ] **Step 6: Commit**

```bash
git add android docs
git commit -m "feat(app): the reading control, the attribution, and the gate's numbers"
```

---

## What this plan does not do

- **It does not promote a sung reading over a dictionary one.** That needs a transcript, and no
  aligner is chosen (§4.2). The hook is left in `Readings.kt` and `ReadingMode` keeps both values.
- **It produces no prose translation**, by design and three times over (§4.1).
- **It ports no part of `src/ai-pipeline/`** (ADR-0002); that code is the behavioural reference
  for Task 5 and nothing more.
- **It sets no passing bar for the gate, and no load budget for Kuromoji.** Both are numbers that
  gate behaviour, and rule 2 says they are measured before they are chosen.
- **It stores no tokens or readings.** Tokenisation happens in memory, per call. So the spec's
  constraint on stored tokens (§7, item 7 — keyed so a text change invalidates them, and never
  writing to `anchors`) has nothing to bind here. It is recorded because the open question in L52
  is whether to store them later: whoever does inherits that constraint, and a stale token
  pointing at replaced words would be the pin-re-pointing bug in a new place.
