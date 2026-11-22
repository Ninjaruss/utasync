# Understanding Japanese while you sing — Android design

**Date:** 2026-11-22
**Status:** design, approved in conversation; not yet planned or built
**Extends:** the Android design (`2026-11-06-utasync-android-design.md`), §7.6 in particular.
**Constrains:** nothing yet. **Depends on:** the lyric-sourcing work (PR #68) for the words
themselves.

---

## 1. Intent and the why

The owner wants to learn Japanese by singing along to music he likes. Two things make that
hard: lyrics that are not timed to the recording, and **not knowing what a line means while it
is going past**. The lyric-sourcing work addressed the first. This addresses the second.

The predecessor PWA accumulated a large language-learning surface over roughly a dozen audit
rounds. This document ports **only what that history proved worked**, rebuilds the one piece
that cannot be ported, and deliberately drops the rest.

### 1.1 The request this answers

"Add only the relevant and effective features from the language learning part." Relevance is
decided by §7.6 of the Android design; effectiveness is decided by what the PWA's own audits
measured. Both are recorded below per feature, so a later reader can see why each was kept or cut.

---

## 2. Goals

1. **Furigana over the Japanese by default, showing what is actually sung** (§4.2 explains why
   that is not the same as the dictionary reading).
2. **Tap a word → its reading, its meaning, and its role.** Offline, from bundled data.
3. **Tap a line → its words in order, each with meaning and role.** Not a translation; see §4.1.
4. **Everything offline and bundled.** No network at any point in this feature, and nothing
   fetched on first run.
5. **Nothing pushed at the user.** The default screen is Japanese with furigana and nothing else.

## 3. Non-goals

Each of these exists in the PWA. Each is dropped, with the reason.

- **Prose translation of a line or a song.** §7.6 forbids republishing a third party's
  translation, and composing fluent English offline is not achievable. See §4.1.
- **The fetched second-language LRC** (`findSecondLanguageInLRCLIB`, `SecondLanguagePanel`,
  `bilingual.ts`, `bilingualMerge.ts`). This is how the PWA gets line translations: it downloads
  somebody else's translated `.lrc`. §7.6 rules it out.
- **The word-pairer** (`pairTranslationsToPrimary`, `scripts/audit-line-pairing.mjs`, the
  per-song pairing audits). The most heavily iterated piece in the PWA — wrong pairs 14 → 2 over
  several rounds — and it exists *solely* to align Japanese words against the words of a fetched
  translation. With no fetched translation it has nothing to pair. Dropping it is not a loss of
  capability; the capability it served is a non-goal.
- **Romaji on screen.** §7.6: no romaji. The PWA's particle-romaji defects were still open in its
  audit backlog. Not ported. (Reconsider only as an explicit per-user setting, never a default.)
- **English-song enrichment** — `cmudict.json` (3.8 MB), IPA, `compromise` POS. §11a.2 of the
  Android design puts predominantly-Japanese songs first.
- **Immersion mode** (JA→JA via Japanese WordNet, EN→EN via Princeton WordNet) and
  **EN→JA reverse lookup**. Opt-in niche features carrying their own dictionaries.
- **Flashcards, SRS, vocabulary lists, progress tracking.** Non-goals of the whole product (§3).

## 4. Anti-goals

Things that would make this a failure even if every feature worked.

### 4.1 An app where your eye goes to the English

Carried from the parent design's anti-goal 1, and it decides the shape of this feature.

A fluent English sentence beside the Japanese is exactly what pulls the eye. So **the line view
is deliberately not prose.** Tapping a line gives its words in order, each with a meaning and a
role — a thing you read *to decode the Japanese*, which cannot quietly become the thing you read
*instead of* the Japanese.

This is presented honestly in the UI: it is labelled as the words of the line, never as a
translation. Three separate reasons converge on the same answer, which is why it is an anti-goal
rather than a compromise: the legal one (§7.6 forbids republishing), the technical one (no
offline MT at a sane size), and the pedagogical one (mid-song, knowing which word means what
beats a smooth paraphrase).

### 4.2 Furigana that asserts a reading it cannot know

**The most product-relevant thing the PWA learned, and the easiest to get wrong.** Lyricists
assign readings freely: a kanji in a song is often sung as something other than its dictionary
reading. Furigana that silently asserts the dictionary reading would teach the user to sing the
wrong thing — which, in a sing-along app, is worse than showing no furigana at all.

**How the PWA solves this, and why Android cannot yet.** Its sung reading comes from the
**audio**: `resolveTokenReading` reads `token.audioReading` — what the transcriber actually heard
— and `shouldPromoteSungReading` lets that alternate own the ruby once its confidence clears
`HIGH_READING_CONFIDENCE = 0.8`. A "sing what you hear" policy, and it rests entirely on having
a transcript.

**The Android app has no transcript.** The alignment engine is still undecided (ADR-0003, whose
gate is unmet), and the lyric-sourcing work computes no timings at all. So `audioReading` does not
exist here, and a design that defaults to the sung reading would be specifying a feature that
cannot be built. *(An earlier draft of this document did exactly that; it was wrong.)*

**What v1 does instead,** which is honest rather than merely reduced:

1. **Show the dictionary reading** — correct for the large majority of surfaces.
2. **Mark a surface that has known alternates.** `jmdict-readings.json` already carries them, as
   `surface → "primary|alternate,alternate"` (so 明白 → めいはく | あからさま). Where a surface has
   alternates, the ruby says so, and the word popover lists them. The app never claims the reading
   it shows is the one being sung; it says "this one usually, and these others exist" — which is
   what the data supports and no more.
3. **Leave the promotion hook in place.** `ReadingMode` keeps both values, and when an engine
   eventually produces `audioReading`, promotion slots in above this exactly as the PWA does.

**Claude's call:** ship furigana now on this basis rather than waiting for an aligner. Most
readings are unambiguous, furigana is the single most useful feature here, and marking the
ambiguous cases is strictly better than both silence and a false assertion.

A consequence that must not be lost: the reading in the word popover must be the same reading
shown in the ruby above the line — **including the alternates marking**. The PWA has an explicit
comment to this effect. Two different readings for one word on one screen is the dishonest-label
failure this project keeps paying for.

### 4.3 Claiming accuracy nobody measured

CLAUDE.md rule 1. "Readings are accurate" and "definitions are right" are accuracy claims. The
PWA earned those claims with audit instruments (`scripts/audit-lookup.mjs` and its reading
audits) and several rounds of fixes. On Android they are unearned until there is an equivalent
instrument. See §8.

## 5. Constraints

- **Offline and bundled.** Nothing fetched, at preparation or playback. This also sidesteps the
  one genuinely unsettled F-Droid question in the parent design (§5.3, runtime downloads).
- **Licensing.** Kuromoji is Apache-2.0. JMdict/EDICT is CC-BY-SA (EDRDG) and **requires
  attribution in the app**, not merely in a file. Both are F-Droid-clean.
- **Size.** The PWA carries 64 MB of data for this: JMdict as three JSON blobs (28 + 11 + 7.4 MB)
  plus a 17 MB tokenizer dictionary. That is far too much to ship as-is; §6.2 addresses it.
- **CLAUDE.md.** Rule 5 (dependencies asked for and approved: Kuromoji, vendored JMdict).
  Rule 6 / ADR-0004: **no copyrighted song text in the repository**, which constrains the test
  fixtures of a feature whose whole input is song lyrics. Rule 2: any behaviour-gating constant
  gets a ledger line. Rule 4: small diffs.
- **ADR-0002.** Do not port `src/ai-pipeline/`. The word-gloss logic (`lyricGloss.ts`,
  `homographGloss.ts`, `stemLookup.ts`) happens to live there. Its *behaviour* is the reference;
  its code is not ported.
- **Jetpack Compose has no native ruby text.** Furigana above a kanji run is not a `Text`
  parameter; it has to be built. Named as a constraint because it is the single largest piece of
  UI work here and is easy to under-estimate.

## 6. Approaches

Three were considered.

**A. Port the PWA's learning code to Kotlin.** Translate `lyricGloss.ts`, `homographGloss.ts`,
`stemLookup.ts` and the reading logic; keep the popover dictionary JSONs.
*Against:* the code lives in the one directory ADR-0002 says not to port; the data is shaped for
a browser `fetch`; and roughly half the machinery (the pairer) is dead without a fetched
translation. The work is porting the good half, deleting the rest, and carrying JS data shapes
into Kotlin.

**B. Rebuild on the JVM originals. ← chosen**
The PWA's three Japanese dependencies — `kuromoji`, `kuroshiro`,
`wanakana` — are JS ports or wrappers of work that is native on the JVM. **Atilika Kuromoji** is
a Java library returning tokens, readings *and* part-of-speech from one call.
*For it:* furigana becomes a function over a token's reading rather than a ported subsystem;
**roles — the feature the owner ranked "if possible" and the parent design marked first to cut —
become nearly free, because the POS is already in the token**; and JMdict converts at build time
into a keyed database, so a lookup is a query rather than a 28 MB JSON parse.
*Against:* one new dependency, and a build-time data conversion step to write and keep honest.

**C. Thin: furigana and tap-a-word only.** Ships the two proven features, drops the line view.
*Against:* the line gesture is the one that answers "what does this mean", which is half the
reason the feature exists.

**Chosen: B.** It replaces three JS dependencies with one native library, converts the
"if possible" feature into a cheap one, and turns the size problem from 64 MB of JSON into a
bundled database plus Kuromoji's own artifact — small enough to ship, so the F-Droid
runtime-download question is avoided rather than enlarged.

## 7. What was decided, and by whom

Decided by the owner: **approach B, and the two dependencies** (Kuromoji, vendored JMdict).

Decided by this document (Claude's calls, flagged as such):

1. **The line view is a word list, not prose** (§4.1), labelled honestly.
2. **Furigana defaults to the sung reading**, with the dictionary reading available (§4.2).
   The parent design left "furigana visible by default with a toggle" as Claude's call; this keeps
   it visible by default.
3. **Roles are included**, because Kuromoji makes them cheap — but they are mechanical
   descriptions ("は marks the topic", "past tense", "i-adjective modifying the next noun"), never
   explanations of a lyricist's choice. If they read as noise on real songs, they are still the
   first thing to cut (§7.6).
4. **JMdict is converted at build time into a Room table with an exact key on (surface, reading)**,
   replacing three runtime JSON files. *Not* FTS: this is an exact-key lookup, and a full-text
   index would be weight with no purpose. (An earlier draft said FTS; that was loose.)
   **The conversion's input is the PWA's existing `public/jmdict-*.json`, committed to this repo**,
   not raw JMdict XML fetched during the build. Two reasons: those files are already the shape the
   PWA's audit rounds corrected, so the audited gloss behaviour is inherited rather than
   re-derived; and rule 5 forbids a build-time download without asking. The raw upstream is
   recorded in the vendored directory for provenance.
5. **Kuromoji's IPADIC dictionary**, not a UniDic variant. The PWA used IPADIC (through
   kuromoji.js), so its part-of-speech tagset is the one the gloss and role behaviour was tuned
   against; changing tagset would silently invalidate that inheritance.
6. **No cold-start or memory budget is invented here.** Kuromoji's dictionary load is the obvious
   risk on a 4 GB device at minSdk 26, but rule 2 forbids a behaviour-gating number without a
   measurement. Measure it first, then put the number and its method in the ledger. The same
   applies to whether tokenisation runs at preparation time or on demand.
7. **If tokens or readings are stored, they are keyed so that changing a song's text invalidates
   them**, and nothing token-related writes to the `anchors` table. The lyric sheet can be
   replaced at any time (and doing so already clears pins by consent); stale tokens pointing at
   replaced words would be the pin-re-pointing bug in a new place.
8. **Tokens that are not Japanese get no ruby and no popover**, and the line view shows them as
   they are. Mixed-script lines are common in this catalogue; this is a plain state, not an error.
9. **One reading control with three states — off, dictionary, sung-when-available** — rather than
   two settings. Romaji is absent entirely (§3), so it is not among them.
10. **The popover's content model follows the PWA's, which its audits settled:** a headword, a
   reading, and senses, where each sense carries a part-of-speech label and its glosses — and a
   flat gloss list stays the guaranteed field so a result is never blank. Its audits also fixed
   two specific mistakes worth carrying as rules: a plain noun must not have a part-of-speech
   forced onto it, and a grammar word gets one sense rather than a list.
11. **A new `:japanese` module** (the name ADR-0002 reserved) holds tokenisation, readings, roles
   and lookup. Pure Kotlin where it can be, so it is testable in CI.

## 7a. Two decisions the owner made after a builder review

A fresh engineer read this document and reported what it still left to guess. Most of those gaps
are now answered above (§7, items 4 to 9). Two were the owner's to settle, and both raise the bar.

### 7a.1 Word meanings inherit the PWA's audited behaviour

**Not "JMdict's first sense".** The homograph and inflection handling that the PWA's
`lyricGloss`/`homographGloss`/`stemLookup` arrived at — after rounds that fixed 17 wrong
definitions and reduced blanks from 18 to 3 — is the behavioural reference, and Android starts
where the PWA ended rather than re-walking those rounds.

The deciding reason is visibility: the line view (§4.1) shows **one meaning per word**, so a
wrong sense is not buried in a menu, it is on screen every time the user taps a line. A first-sense
lookup would be visibly wrong on homographs and on inflected forms, which are common in lyrics.

What this means in practice: for each word the app shows the sense it has **in this line**, not
its first dictionary entry. The two rules the PWA's audits settled are carried as rules, not
preferences — a plain noun must not have a part of speech forced onto it, and a grammar word gets
one sense rather than a list.

### 7a.2 The accuracy audit is a release gate

**This feature does not ship before the instrument of §8 exists and has been run.** The parent
design made automatic alignment a release gate (§11a.1); the owner has put reading and definition
accuracy on the same footing.

Consequences the plan must absorb, stated plainly because they are the expensive part:

- The instrument and its corpus come **first**, not after the feature.
- **Hand-labelling the expectations is the real cost** — particularly for which reading a surface
  takes in context. It cannot be generated from the same data it is meant to check.
- Rule 6 still applies: the corpus carries no song text. Hash-keyed expectations, or
  non-copyrighted sentences, as §8 requires.
- A gate needs a number to clear. This document does **not** set one: rule 2 forbids inventing a
  threshold, so the first run's counts become the baseline and the owner sets the bar from real
  figures.

## 8. Measurement — what must exist before any accuracy claim

Rule 1 applies. Specifically:

- An **audit instrument** on the Android side, equivalent in spirit to
  `scripts/audit-lookup.mjs`: a fixed set of lines, a recorded expectation per word, and a
  printed count of wrong readings, wrong definitions and blanks. Until it exists and is run, the
  app claims nothing about reading or definition accuracy, in its UI or its README.
- Because of rule 6 the corpus **cannot contain song text.** Follow the lyric-sourcing precedent:
  keep expectations keyed by hash, or build the corpus from non-copyrighted sentences, and keep
  any real-song fixture local and untracked. **This is a constraint on the instrument's design,
  not an excuse to skip it.**
- The sung-versus-dictionary reading distinction (§4.2) is the first thing the instrument should
  cover, because it is the one where being wrong teaches the user something false.

## 9. What is left to the builder

- How ruby text is rendered in Compose, and how it behaves when a line wraps.
- The build-time conversion: its script, where the vendored JMdict lives, and how the result is
  verified rather than assumed.
- The database schema and the lookup query, including how inflected surfaces reach their
  dictionary form.
- The wording and layout of the word popover and the line view, and where the reading toggle and
  the attribution live.
- The exact particle and inflection table behind the role descriptions.
- Whether tokenisation runs at preparation time and is stored, or on demand per line. (Worth
  measuring; the parent design's preparation budget is in §5.4.)
