# Utasync for Android — design

**Date:** 2026-11-06
**Status:** design, approved in conversation; not yet planned or built
**Supersedes in spirit:** nothing. Extends ADR-0002 (native Android successor) and
constrains ADR-0003 (alignment approach). Reinforces ADR-0004 and ADR-0005 with
newly verified external evidence.

---

## 1. Intent

Utasync is a **player for songs you already own, that teaches you to sing them in
Japanese**.

It is not a karaoke app, not a flashcard app, and not a music library. It exists for one
loop: get a song in, get its lyrics sitting on the right moments, then sing it line by
line until you own it.

The why: the owner wants to learn Japanese by singing along to music he likes. The two
things that make that hard are (a) lyrics that aren't timed to the recording, and (b) not
knowing what a line means while it's going past. Everything in this document serves one of
those two problems. Nothing else is in scope.

The PWA in this repository stays in maintenance (ADR-0002). This document describes its
successor, built fresh for Android.

### The one requirement of the user

**They supply the audio file.** That is the only thing the app asks of them. Everything
after that — finding the lyrics, timing them, explaining them — the app does itself.

This is a deliberate, owner-stated product boundary, and Section 4 explains why it is also
the only legal option.

---

## 2. Goals

1. **A song the world has already timed is ready in about two seconds**, with no model run
   and no waiting.
2. **A song the world has not timed gets timed automatically**, accurately enough that most
   lines need no attention. The owner's words: "accurate and mostly precise" — explicitly
   *not* perfect. **This is a release gate** (§11a.1).
3. **When the automatic pass is wrong, fixing it is quick and not annoying.** Manual timing
   being tedious is the specific pain this app must not reproduce.
4. **Practice is line-centred**: jump to a line, repeat it, slow it down.
5. **Meaning is one tap away and never pushed at you.**
6. **Most songs should work**, including songs nobody involved has ever tested. This is
   intended for strangers to install, not only for its author.
7. **Everything works offline after a song is prepared**, and nothing requires an account.

## 3. Non-goals

Explicitly out of scope. Not "later" — out.

- Streaming service integration of any kind (Section 4 explains that this is prohibited,
  not merely hard).
- Gamification, scoring, streaks, points, achievements.
- Flashcards, spaced repetition, vocabulary lists, progress tracking.
- Accounts, social features, sharing, cloud sync, leaderboards.
- Pitch detection, singing assessment, "how well did I sing that".
- Being a general music player. It plays songs you are studying, nothing else.
- Translating whole songs as prose, or explaining a lyricist's stylistic choices
  (see §7.4 for what grammar support actually means).

## 4. Anti-goals

Things that would make this a failure **even if every feature worked**.

1. **An app where your eye goes to the English.** If the path of least resistance is
   reading the translation, the app has defeated its own purpose. Japanese is the thing on
   screen; meaning is something you reach for.
2. **An aligner tuned without ground truth.** The predecessor ran roughly thirteen rounds
   of alignment tuning judged against its own prior output and against offset-normalised
   LRC comparisons. See §8 — this is the single most important failure to avoid, and the
   one most likely to recur.
3. **A correction that a later re-alignment silently overwrites.** If the user fixes a line
   and the app un-fixes it, trust is gone permanently.
4. **An accuracy claim with no measurement behind it.** Carried over from CLAUDE.md rule 1.
5. **An app that needs an account, a key, or a paid service to do its core job.**

---

## 5. Constraints

### 5.1 Legal and platform (verified 2026-11-05)

Streaming integration was investigated at the owner's request and found to be
**prohibited by the providers' own terms**, not merely impractical.

- **Spotify Developer Policy III.6**: "Do not synchronize any sound recordings with any
  visual media." Their Terms §II.8 define Spotify Content to include song lyrics.
  Independently, III.13 bars analysing Spotify Content, III.14 bars using it with any
  ML/AI model, Terms IV.3 bars caching it, and Policy IV restricts commercial use.
  Playback control additionally requires the Spotify app plus a Premium subscription, and
  the Android SDK is still labelled Beta.
- **YouTube Developer Policies**: bar caching/storing audio and offline playback (E.1),
  bar background players (I.9), and bar separating, isolating or modifying the audio
  components of content (I.7) — which describes vocal isolation exactly. The Android
  Player API documentation page now returns 404. *Confidence note:* these three clauses
  were read as a summary rather than verbatim; re-verify before quoting publicly. The
  Terms of Service clauses (16.3, 3.1) were read verbatim and already forbid reproducing
  content outside the API.
- **Apple MusicKit for Android**: no formal deprecation, but last updated December 2021,
  radio unsupported, and developers report authentication failing on current Android.

None of these SDKs exposes raw audio samples in any case, so a linked song could never be
aligned by the app — only displayed if someone else had already timed it.

**Consequence:** local audio files only. This upholds ADR-0005 and now has verified
evidence behind it rather than a judgement call.

### 5.2 Copyright

CLAUDE.md rule 6 and ADR-0004 stand: **no copyrighted song text in the repository.** This
constrains the measurement corpus specifically — see §8.3, which exists because of it.

Lyrics fetched at runtime for the user's own copy of a song are a different matter and are
how every comparable player works.

### 5.3 F-Droid

F-Droid eligibility is a goal, and the decisions above preserve it: no API keys, no
accounts, no non-free network services, no proprietary dependencies. The one genuinely
unsettled question is F-Droid's stance on **downloading ML models at runtime** — this is
worth asking on their forum before the first release rather than guessing. If it proves
disqualifying, the fallback is GitHub Releases, which costs nothing architecturally.

### 5.4 Device

Phones, offline-capable, battery- and thermal-aware. Alignment is minutes of sustained
compute; it must survive the screen going off and must not be assumed to run while the app
is foregrounded.

**Working budget (Claude's call, open to revision):** preparing a four-minute song on a
mid-range phone from roughly 2023 should finish in **no more than the song's own length**.
Slower than that and queueing an album becomes an overnight job, which undermines goal 3.
Minimum target is a 4 GB device on a current-minus-two API level. These numbers are
assumptions, not measurements — the first Phase 0 run should replace them with real ones,
and they are a legitimate reason to reject an engine.

**Network posture (Claude's call):** the app requests internet access and uses it during
preparation only — tag lookup and lyric fetch. Nothing is fetched during playback, so a
prepared song works entirely offline (goal 7). Lyric fetching is on by default, because
asking per song would reintroduce exactly the hassle goal 1 removes; it is disableable, and
disabling it simply means every song takes rung 3 or 4.

---

## 6. How a song gets in — the ladder

The user picks an audio file. The app tries each rung in order and stops at the first that
works.

| Rung | Condition | What happens | Cost to the user |
| --- | --- | --- | --- |
| 1 | Published **timed** lyrics exist | Read the file's tags, query LRCLIB by title, artist **and duration**, take the version whose length fits this recording | Nothing, ~2 seconds |
| 2 | Published **untimed** lyrics exist (LRCLIB serves plain lyrics as well as synced ones; it is the only source, since §5.3 rules out anything needing a key) | The words are known; the app computes only *when* each line is sung | Nothing, minutes in the background |
| 3 | Nothing found | User pastes the lyrics once; from there identical to rung 2 | One paste, then automatic |
| 4 | User has an `.lrc` | Imported as-is, skipping everything above | Instant |

Anything the user fixes **exports back out as a plain `.lrc`** that any player understands.
Work done here is never trapped in this app.

Rung 4 is also the **migration path from the PWA**, which already exports LRC (ADR-0002).
No bespoke importer is needed and the Android app starts empty otherwise. *(Claude's call.)*

**Rung 1 is fetch-and-trust in v1** — no verification pass, because "about two seconds" is
the whole point of that rung and a verification pass is a model run. The nudge is the
remedy when a fetched LRC is pre-rolled or simply wrong. Note the tension: measured fact
L12 says refining against an existing LRC beats aligning from scratch, so a cheap
verification pass is a plausible *later* improvement — but only once §8 can show it helps,
and only if it can be made fast enough not to destroy rung 1's reason for existing.
*(Claude's call.)*

### 6.1 The inversion that matters

The predecessor treated transcription as the main event and published lyrics as a hint to
check it against. **This inverts that.** The words are a given. The only thing ever
computed is *when*.

That is what makes "accurate and mostly precise, automatically" a reachable bar rather than
an open-ended research problem. Rung 1 needs no model at all and should cover most
well-known songs.

### 6.2 Known defect to fix in the rebuild

The PWA's `fetchLRCLIBExact` sends only `track_name` and `artist_name`, discarding the
duration it already holds. Duration is the single signal that distinguishes a studio cut
from a live version or a remaster. The Android client must send it.

### 6.3 Preparation runs in the background

Rungs 2 and 3 are queued jobs, not a progress screen the user sits through. The user can
add several songs — an album — and walk away; songs become ready one at a time.

Consequences the builder must handle: a song has a visible readiness state; a song opened
before it is ready is not yet singable and must say so plainly rather than showing bad
timings; and jobs must survive the screen locking and the app being backgrounded.

---

## 7. The app itself

### 7.1 Timing model

**One timestamp per line. A line runs until the next line starts.** Ends are implied,
never stored.

This is the same shape as an LRC file, which means the data fetched, the data stored, the
data edited and the data exported are all one model. No overlaps are representable, no
gaps are representable, and a whole class of bug disappears.

Accepted cost, decided knowingly: a line ending on a long held note followed by an
instrumental passage will "run" through that silence, so repeating that line waits out the
silence. If this proves annoying in practice it is a known revisit point — not a defect to
design around pre-emptively.

### 7.2 Fixing one line — the nudge

The primary repair tool, for when a line or two is off.

- The waveform around that line, with the sung phrase visually distinct from the quiet
  before it.
- A large drag handle on the line's start. **Audio scrubs under the thumb while dragging**,
  so the user places it by ear rather than by arithmetic. This is the feature the owner
  specifically asked for.
- Fine `±` buttons for the last tenth of a second, where dragging is too coarse.
- The app's original timing stays visible (amber) against the new one (blue), so the user
  can always see what they changed.
- **Only that line moves.** Nothing cascades. Predictability was chosen over leverage.

**Warning from history:** this screen already failed once. In the PWA's post-add offset
flow the waveform never loaded and the layout collapsed, and the feature died there. On
Android the odds are far better — local file, decode yourself, draw to a canvas — but this
should be built and proven early, not last. The whole correction story rests on it.

### 7.3 Timing a whole song — tap-along

*(This is the one significant piece proposed by Claude rather than stated by the owner. It
follows directly from "timing lyrics manually is annoying, make it quick", and the owner
did not object when it was proposed. Treat it as a design call, open to revision.)*

Nudge is surgical; it is the wrong tool for a song that is wrong all over. For that case:
the song plays, the user taps once at the start of each line, and each tap becomes a
timing. A four-minute song is timed in four minutes, with no judgement about seconds
required — only an ear.

**Division of labour:** tap-along times a song; nudge fixes a line. Both feed the same
store.

### 7.4 Corrections are permanent

Any timing the user sets — by nudge or by tap — is stored **separately from the computed
timings** and marked as pinned. No re-alignment, no re-fetch, no pipeline version bump may
overwrite it. This is ADR-0002's anchor concept and it is non-negotiable (see anti-goal 3).

A pinned line is also the most valuable signal the aligner has, and the builder may use
pins as hard constraints when re-computing unpinned lines around them.

### 7.5 Practice

Line-centred, driven by the user, not a passive teleprompter:

- Tap a line to jump to it.
- Repeat the current line (loop from its start to the next line's start).
- Playback speed control.

### 7.6 Understanding

**Default state: clean Japanese with furigana. Nothing else.** No romaji, no translation,
no grammar on screen until asked. This directly serves anti-goal 1.

Two gestures, both on demand:

- **Tap the line** → what it says, and how the line is built.
- **Tap a word** → its reading, its meaning, and its role in the sentence.

Both are fully offline, from a bundled dictionary. Nothing is fetched, and no third party's
translation is republished — the app composes meaning from word-level dictionary data.

**What "grammar" means here, precisely:** the *role* of each element — this is an
i-adjective modifying that noun, this は marks the topic, this た is past tense. That is
achievable offline and reliably. What is *not* in scope is explaining why a lyricist chose
a construction, or producing prose translations of whole songs. The owner ranked grammar as
"if possible", so it is the first thing to cut if it proves unreliable; meaning is not.

Furigana visible by default with a toggle is **Claude's call**, not the owner's stated
preference.

---

### 7.7 Lines carry a confidence signal

*(Claude's call, and worth explaining, because it may look like it contradicts an earlier
choice.)*

When the owner was asked whether a wrong line should be **flagged** or **fixable**, he chose
fixable. That was a choice between those two as alternatives. It was not a rejection of
flagging as well — and the two are complements: **a flag is what tells you where to nudge.**
Without one, finding the bad line means noticing it mid-song and losing your place.

So each computed line carries a quality signal, and lines the aligner is unsure of are
marked. Pinned lines (§7.4) and rung-1 lines are never marked.

Two hard rules, both learned expensively by the predecessor, which spent several rounds on
"label honesty" because confident-but-wrong lines destroy trust faster than visibly
uncertain ones:

1. **The flag is scored.** §8 must report flag precision and recall against the corpus — a
   flag nobody can trust is worse than no flag.
2. **Never flag by vibes.** The signal must come from something measurable, not from a
   model's self-reported confidence, which the predecessor found uncorrelated with being
   right.

This is deliberately *not* left to the builder as screen design: it adds a column to the
schema and a number to the scorer.

## 8. Measurement — the part that decides whether this succeeds

This section is the most important in the document. The predecessor's alignment work was
not short of effort or ideas; it was short of a ruler. Read §8.1 before changing anything
that can move a timing.

### 8.1 What went wrong before

Two specific, documented failures — both from this repository's own July 2026 audit:

1. **The committed accuracy gate subtracted a per-song median offset before scoring.** A
   constant lag means every line is late by the same amount; normalising it away cancels
   exactly the error you most need to see. One song passed the green test while sitting
   ~1.18 s behind the music, with 40 of 59 lines more than a second off.
2. **The truth corpus had two songs**, named in that audit as the bottleneck.

The method was never the problem. An honest probe — final output against human-made LRC
files, with no offset subtraction — produced real, actionable numbers and correctly traced
the lag to Whisper onset lateness. **Comparing against existing timed lyrics works.** It
just has to be done without the arithmetic that hides the answer, and on more than two
songs.

### 8.2 The instrument

- Score the **shipped** path end to end, not an internal function. The old gate called the
  refiner directly and never exercised the gap pass or the isolation nudge that users
  actually get.
- **Report the offset; never subtract it.** Raw per-line error, the fraction of lines
  within 0.5 s, p50, p90, and the median offset reported as its own number.
- A change ships only if it beats the corpus. This replaces judgement with arithmetic and
  makes the tuning spiral structurally impossible to restart.

**Where it runs, and the trap to avoid.** The audio cannot go in git — copyright and size
both forbid it — so the full scoring run is **local, on the owner's machine, on every change
that can move a timing**. CI gets the hashed annotations, the schema check, and the
regression comparison against committed scores.

The danger here is specific and the predecessor already fell into it: today's tests
auto-skip when private fixtures are absent, so a run with no audio present is *green*. That
is the §8.1 failure wearing a different hat.

**Therefore: a scoring run that scored fewer songs than the manifest expects is a FAILURE,
not a pass.** It must report the count it scored, and both CI and the local run must fail
loudly on a shortfall. Silence is never success. *(Claude's call.)*

### 8.3 How the corpus can live in git

The corpus could not grow past two songs because an LRC file *is* lyrics, and rule 6
forbids committing song text.

**Store, per line, a hash of the text plus its timestamp — never the text.** The scorer
only needs to confirm it is comparing like with like, and a hash does that perfectly. The
corpus can then live in the repository, go to thirty or fifty songs, and run in CI.

*(This schema is Claude's proposal. It replaces the current annotation format, which
carries line text precisely so it can assert the lyrics match — see
`scripts/lib/syncBenchmark.mjs:18`.)*

**Normalisation, which the hash makes load-bearing.** Text comparison is forgiving; hashing
is not. An LRCLIB sheet and a user's paste will differ in whitespace, full-width versus
half-width characters, punctuation and sometimes line splitting — and every one of those
produces a silent mismatch that drops a song. Drop enough and the corpus shrinks back
toward the two-song problem that caused all this.

So the schema defines **one canonical normalisation** applied before hashing: trim, collapse
internal whitespace, NFKC-normalise, strip punctuation and bracketed annotations. It is part
of the schema, versioned with it, and changing it invalidates every stored hash — which is
correct and should be noisy.

**A per-song mismatch is a loud skip, counted and reported — never a silent one**, and it
feeds the shortfall failure above. *(Claude's call.)*

### 8.4 Two limits that hand-marking must cover

Existing timed lyrics cannot be the only truth, for two reasons:

1. **Selection bias.** Songs with good LRCs are the popular, well-produced, clearly-sung
   ones. The aligner only ever runs on songs that *have no LRC*. Measuring exclusively on
   the covered set flatters it on exactly the population it never serves.
2. **Authoring convention.** Some LRC authors deliberately place timestamps slightly ahead
   of the vocal so a karaoke highlight pre-rolls. That is a real offset — report it, never
   remove it.

**So: roughly thirty songs scored automatically against hashed LRC truth, plus about two
songs with no LRC at all, hand-marked by ear.** The small hand-marked set is what keeps the
large automatic set honest. This was agreed with the owner after he correctly challenged a
larger hand-marking proposal.

### 8.5 Success criteria

The alignment quality bar should be **re-derived from this corpus once it exists**, not
inherited. ADR-0003's current gate (≥85% of line starts within 250 ms, no unflagged line
over 1 s, on ≥10 songs) was never evaluable — the repo's own scoring script reports zero
songs with blind human onsets. Whether 250 ms is the right threshold for *singing*, where
onsets are genuinely soft, is itself an open question the corpus can answer.

Product-level success, in the owner's terms: **most songs work**, and when one doesn't,
fixing it is quick rather than annoying.

---

## 9. Platform and architecture

### 9.1 Start from the existing shell, not from zero

§1 says "built fresh for Android", which means *fresh relative to the PWA* — it does not
mean discarding the Kotlin already in `android/`.

That Phase 1 shell already has `:app`, `:data`, `:playback` and a pure-Kotlin `:align` with
LRC parsing, sheet-to-LRC matching, prior windows and a line clock, with tests passing. More
importantly its Room schema already implements the two structural decisions this design
depends on: **lines carry one start each**, and **anchors live in their own table, apart from
computed timings**, exactly as §7.1 and §7.4 require. Rebuilding that would be rebuilding the
right answer.

**So: extend the shell.** Two caveats the builder should expect. It has never been compiled
against an Android SDK, so budget for first-build friction before trusting any of it. And
§7.7 adds a per-line confidence column, which the schema does not yet have. *(Claude's call.)*

### 9.2 The rest

Per ADR-0002, and unchanged by this document:

- Kotlin, Jetpack Compose, Media3/ExoPlayer for playback, Room for storage, WorkManager for
  the background preparation queue.
- Computed timings and user pins are **separate stores** (§7.4).
- Alignment sits behind a pure-Kotlin interface so the engine can be replaced without
  touching the app.

**The alignment engine itself is not chosen by this document.** It remains the subject of
ADR-0003's Phase 0 experiment, which this design constrains in one important way: the
engine's job is now **known-text alignment** — given the words and the audio, find the
times — not transcription. Approaches should be judged on that problem, against the §8
corpus.

Do not port `src/ai-pipeline/` to Kotlin. In particular, do not carry over the
song-specific regexes in `src/lyrics/phraseAlignment.ts` (`ENTWINED_ROLLING_RE`,
`RUN_LINE_RE`), which encode one live recording of one song into the production path.

---

## 10. What is left to the builder

Decided here; everything below is yours.

- Screen structure, navigation, visual design, and how the library is browsed.
- How audio files are picked (one-at-a-time import versus scanning the device library) —
  judge on the "no hassle" goal.
- Waveform rendering and audio-scrub implementation.
- Dictionary choice, bundling, and how word roles are derived.
- The alignment engine (via the ADR-0003 experiment), and its model-download story.
- Error, empty and not-yet-ready states.
- Whether tap-along and nudge share one editing screen or are separate.
- Test strategy beyond the §8 accuracy corpus, which is mandatory.

## 11. Decisions made by Claude, flagged for the owner

These were not stated by the owner and should be checked:

1. Tap-along as the bulk timing path (§7.3).
2. The hashed-line corpus schema (§8.3) and its canonical normalisation.
3. Reporting rather than subtracting the offset (§8.2) — though this follows directly from
   the documented failure.
4. Furigana on by default, with a toggle (§7.6).
5. Roughly thirty automatic plus two hand-marked songs as the corpus size (§8.4).
6. Per-line confidence flags (§7.7) — note this reads as a reversal of an earlier answer and
   is explained there.
7. Extending the existing `android/` shell rather than starting over (§9.1).
8. Preparation time budget and minimum device (§5.4) — assumptions, to be replaced by
   measurement.
9. Network on by default during preparation only (§5.4).
10. Rung 1 is fetch-and-trust, with no verification pass in v1 (§6).
11. PWA migration via `.lrc` import only (§6).
12. A scoring run that scores too few songs fails rather than passes (§8.2).

## 11a. Owner decisions (raised by builder review, 2026-11-06)

Four questions an independent builder review exposed, and the owner's answers. These are
his, not Claude's.

### 1. Automatic alignment is a release gate

**Goal 2 is required for v1.** A release that only does rungs 1 and 4 plus tap-along is not
acceptable. This has three consequences the plan must honour:

- **The work is ordered experiment-first.** The §8 corpus is built *before* anything else,
  because Phase 0 cannot be judged without it. Then Phase 0 runs. Only then does app work
  that depends on the aligner begin.
- **The app is still built in parallel.** Everything in §6 rung 1/4, §7 playback, nudge,
  tap-along and understanding is independent of which engine wins and should not wait.
- **The risk is real and is accepted.** ADR-0003's own decision rule includes an outcome
  where no approach passes. Under this answer, that outcome means **no release**, not a
  reduced one. If Phase 0 fails, the honest response is to return to this decision rather
  than to start tuning — see anti-goal 2, which is exactly what tuning-without-a-gate
  produced last time.

### 2. Predominantly-Japanese songs first

Mixed Japanese/English songs are **not** a v1 requirement. They may be prepared and then
flagged as uncertain (§7.7) rather than silently mistimed. The corpus should still *contain*
a few so the failure is visible and measured — it simply must not gate the release.

This directly avoids the predecessor's worst failure class, where mixed-language consensus
collapsed a verse onto a chorus reprise with fabricated high confidence.

### 3. F-Droid is a preference, not a gate

Keep every decision F-Droid-compatible — no keys, no accounts, no proprietary dependencies —
but ship via GitHub Releases if their position on runtime model downloads blocks it. No
reproducible-build constraint is imposed on day one.

### 4. No on-device vocal separation in v1

Align against the mix. Separation roughly doubles preparation time, adds a large model
download and its own licensing question, and the predecessor's apparent evidence that it
helped was later traced to a resampling bug in the measurement harness — with the bug fixed,
two independent harnesses agreed it *hurt* at good transcription quality.

Revisit only if the §8 corpus shows a real gain. This also removes the YouTube I.7 concern
about isolating audio components, which is moot anyway now streaming is out.

## 12. ADR consequences

- **ADR-0003** should be revised: its premise (choose between alignment approaches) stands,
  but the problem is now explicitly known-text alignment, and its gate is unevaluable as
  written (§8.5).
- **A new ADR on measurement** is warranted, recording §8 — specifically that offsets are
  reported rather than normalised, and that truth lives in git as hashes.
- **ADR-0005** (local audio only) gains the verified external evidence in §5.1 and should
  cite it.
