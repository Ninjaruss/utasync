# Android vs the PWA: what is still missing

Written 2026-11-22 from the state of the tree at `bc85940` (branch
`feat/android-lyric-sourcing`).

> **Added 2026-11-23.** Read the practice-layer scoring below as *of its date*. The
> understanding design approved since
> (`docs/superpowers/specs/2026-11-22-android-understanding-design.md`) deliberately drops two of
> the five features this document counts: **romaji** on screen, and **prose translation** of a
> line. Romaji because the parent design's §7.6 says so, and translation because §7.6 forbids
> republishing a third party's translation and the PWA's version works by fetching somebody
> else's translated `.lrc`. So the Android practice layer is heading for furigana, line repeat,
> speed and tap-to-look-up — not five of five, by decision rather than by shortfall. This note
> exists so a later reader does not mistake a deliberate narrowing for a permanent gap; the
> counts below are not edited, because a dated inventory should not be rewritten to match a
> later decision. An inventory, not a decision and not a plan — ADR-0002 owns the
decision to build the Android app, ADR-0003 owns the alignment engine, and nothing here
authorises work. Refresh it by re-running the commands in each section.

## Verdict

The Android app is a better **foundation** and not yet a better **app**. It gets right the one
thing the PWA got wrong (user timings cannot be destroyed) and it drops the browser tax, but on
the two things CLAUDE.md names as the product — preparation without manual work, and practice
with furigana/romaji/translation — it is behind. Preparation has no automatic alignment at all,
and the practice layer is two of five features.

Size, for scale:

| | Android | PWA |
| --- | --- | --- |
| Source lines | 6,491 Kotlin (73 files) | 39,977 TS/TSX (209 files) |
| Commits in the 60 days to 2026-11-22 | 51 | 27 |
| Last touched | 2026-11-20 | 2026-11-05 |

```sh
find android -name '*.kt' -exec wc -l {} + | tail -1
find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | tail -1
```

## Where Android is already better

1. **Pins survive everything.** `resolveStarts(lines, anchors)` is the only read path for a
   timing; `upsertAuto` and `upsertUser` are separate doors with the raw `upsertAnchor` left
   `protected`; `prepareSong` returns `RefusedHasPins` rather than reindex pins onto a
   differently split sheet. The PWA's recurring failure — corrections lost to a re-run — is
   designed out at the data layer, not patched per screen. ADR-0002 calls this the one
   non-negotiable guarantee.
2. **Background playback.** Media3 `MediaSessionService` + ExoPlayer, with notification
   controls. The PWA never had it.
3. **Honest state vocabulary.** `PrepareState` / `readinessOf` keep `NO_MATCH`, `FAILED` and
   `RATE_LIMITED` apart because merging any two would make one of their messages false, and
   lines outrank state so a label can never take a highlight away. Several PWA rounds
   (label honesty, approx-run display, quality-aware badges) were spent reaching the same
   property after the fact.
4. **No browser tax.** No WebGPU tier detection, no Firefox/Zen/SteamOS fallbacks, no
   hidden-tab `requestIdleCallback` suspension, no OPFS/Cache-Storage eviction, no main-chunk
   budget. A large share of the PWA's accumulated fixes exist only because it runs in a browser.

## Blocking gap 1 — there is no automatic alignment

This is the whole preparation half of the product.

- ADR-0003 is still **proposed**. The engine is decided by the Phase 0 gate, which has not
  been passed: arm C (MMS CTC, the measured ceiling) is **not run** — model not cached and
  huggingface.co unreachable from the agent environments — arm A has runs for 4 songs and arm B
  for 5, against a gate wanting ≥10 `corpus-onsets` songs (≥60 pooled lines) and ≥2
  `human-onsets` songs (≥50 pooled lines, ≥20 each).
- What ships today in `android/` is the *sourcing* ladder, not alignment: `prepareSong` asks
  LRCLIB (title + artist, duration where known from the user's own file tags), or the user
  imports an `.lrc`, or the user taps the song in by hand (`TapAlongScreen`) and nudges lines
  (`NudgeScreen`). If LRCLIB has no record and the user has no LRC, the song is hand-timed.
- `:align` holds the pieces an engine would need — `Windows.kt` (matching
  `experiments/phase0/knownTextAlign.mjs` exactly, 48/48 windows on veil), `Lrc`, `SheetMatch`,
  `Anchors`, `LineClock` — but there is no model and no `:inference` module.
- Per CLAUDE.md, the answer is **not** to port `src/ai-pipeline/`. The PWA's pipeline is the
  part the 2026-11-03 audit called the weak point (~18,600 lines, 195 numeric thresholds).

**Unblocked by:** finishing Phase 0 to its pre-registered gate. Nothing else in this document
is worth doing first.

## Blocking gap 2 — the Japanese learning layer does not exist

`grep -rniE 'furigana|romaji|translat|kuromoji|jmdict' android` returns **nothing**. Neither
`:inference` nor `:japanese` (both named in ADR-0002) has been created.

Practice features, as CLAUDE.md lists them:

| Feature | PWA | Android |
| --- | --- | --- |
| Line repeat | ✅ `ABLoop`, `retimeLoop` | ✅ `RepeatRange` + per-frame loop in `PlayerScreen` |
| Speed | ✅ `snapPlaybackRate` | ✅ speed chips → `setPlaybackSpeed` |
| Furigana | ✅ `readingDisplay`, `jmdictReadings`, `readingCorrections` | ❌ |
| Romaji | ✅ `language/japanese/phonetics` | ❌ |
| Translation | ✅ `bilingual`, `translationGroups`, `SecondLanguagePanel` | ❌ |

Beyond that list, the PWA also has tap-to-look-up (`WordLookupPopover`, `wordLookup`,
`jmdictPopover`, three dictionary directions), cloze practice (`src/cloze/`), word colouring,
phrase-layer display (`phraseLayout`, `phraseProjection`), English enrichment
(`language/english/`) and grammar glosses. Android's lyric view shows plain line text.

A good deal of the PWA's accuracy work lives in this layer rather than in the pipeline — the
reading-accuracy audit, the word-pairer rounds, the popover-definition rounds. That work is
evidence to carry over (the measured carve-outs, the audit scripts), not code to port blind.

## Smaller gaps

- **Correction surface.** Android has nudge + tap-along + export `.lrc`. The PWA additionally
  has waveform scrubbing (`WaveformStrip`, `waveformPeaks`), drag retiming
  (`DragRetimeStrip`, `TimingDragInput`), onset snapping (`onsetSnap`), an offset screen
  (`OffsetAlignScreen`) and an alignment editor. Android has `WaveformDecoder` and
  `ScrubAudio`, so the primitives are started.
- **Library and ingest.** Android: local audio import plus tags (ADR-0005, local audio only).
  PWA: YouTube playback and captions, cover art, artist aliases, multi-source lyric resolution
  with reranking (`lyricsResolver`, `lyricsRerank`, `lyricsOvh`). Most of that is out of scope
  by ADR-0005; the lyric reranking is not, and Android currently has only LRCLIB.
- **Settings.** PWA has a settings view with persisted preferences; Android has one setting
  (`FetchSetting`, lyric fetching on/off).
- **Shared UI vocabulary.** The PWA's `core/ui/` (Overlay, ConfirmDialog, Toast, Banner,
  ProgressOverlay, the dismiss/modal hooks) is the output of the UI-finalization phases.
  Android has 15 UI files and no equivalent primitives yet; worth taking the *conclusions*
  from those phases (one door for every layered surface, non-optional `onClose`) when the
  Android surface count grows.
- **Export, both ways.** Android exports `.lrc` with pins folded in. ADR-0002 promises the PWA
  a library JSON export path and it has **not** landed — `grep -rniE 'libraryExport|exportLibrary|backup' src`
  finds nothing — so there is currently no route for a library prepared in the PWA to reach the
  Android app except one `.lrc` at a time.

## Verification debt on the Android side

From `android/README.md`, restated because it bears on "is it better":

- The app **has never shipped**, and there is no Room migration — an older build's database
  makes Room throw on first access.
- CI runs every JVM unit test and `:app:assembleDebug`. The instrumented tests do **not** run
  in CI: `PinsSurviveReAlignmentTest`, `LineCountsTest`, `ClearAnchorsTest`,
  `WaveformDecoderTest`. `:data`'s three ran once on an API-35 emulator (10 tests, 0 failures,
  as reported by the person who ran them); `WaveformDecoderTest` was not in that run.
- The export menu, file picker and file write in `PlayerScreen` have no automated test and have
  not been exercised on a device.
- "Nothing in the playback path reaches the network" rests on the call graph, not on anyone
  watching traffic.
- `allWarningsAsErrors` was verified by planting a warning in `:prepare` only; the other four
  modules were observed to compile clean, not planted in.

So the pin guarantee is proven at the DAO/resolver layer against real Room, and **not** proven
end to end through the UI with a file-backed database.

## If you want one ordering

1. Phase 0 to its gate (ADR-0003). Everything about preparation waits on it.
2. The pin guarantee end to end on a device, in CI if an emulator can be had.
3. `:japanese` — furigana first, since it is the feature that makes the lyric view teach
   anything, and it needs no model.
4. Romaji, then translation.
5. Correction ergonomics (waveform drag, onset snap) once alignment produces something to fix.
