# Version-aware lyric sourcing — Phase 1 measurement

**Date:** 2026-08-18
**Branch:** `fix/ux-audit-2026-08`
**Spec:** `docs/superpowers/specs/2026-08-18-version-aware-lyric-sourcing-design.md`
**Plan:** `docs/superpowers/plans/2026-08-18-version-aware-sourcing-phase1.md` (Task 7)

## Why

Phase 1 made LRCLIB matching version-aware. The change most likely to matter is that
`resolveLyricsForSong` now forwards a track duration to `findLyrics`; before, it
passed a literal `undefined`, so the scorer's duration term (+0.15 within 2s, −0.25
for a large mismatch) had **never fired** on the YouTube or lyrics-import paths.

This measurement exists to answer two questions with data rather than intuition —
every prior round in this project that shipped a threshold on judgement had it later
refuted by measurement.

## Instruments

- `scripts/lyrics-source-coverage.mjs` — queries the real LRCLIB API with exact
  `track_name` + `artist_name` and reports, per song, how many results are synced and
  how far their durations spread.
- `tests/sources/lrclib.coverage.live.test.ts` — probes the same songs through the
  **real `findLyrics`**, which additionally expands title/artist variants. Gated on
  `RUN_LRCLIB_LIVE=1`; never runs in CI.

The second instrument turned out to be necessary: the script's numbers are a **lower
bound**, because the app finds songs the raw API misses on an exact query.

## Corpus

Ten tracks: the reported case, two heavily re-released Yamashita songs, the AKFG
track already used by the existing live test, and six plain popular J-pop tracks as a
regression guard.

## Result 1 — duration is decisive far more often than expected

| Song | Results | Synced | Duration spread |
|---|---|---|---|
| 山下達郎 – RIDE ON TIME | 20 | 20 | **502.5s** |
| King Gnu – 白日 | 20 | 20 | **402.1s** |
| ヨルシカ – ただ君に晴れ | 20 | 19 | **296.3s** |
| YOASOBI – 夜に駆ける | 20 | 20 | **277.0s** |
| 米津玄師 – Lemon | 20 | 20 | **224.7s** |
| Official髭男dism – Pretender | 20 | 19 | **91.6s** |
| あいみょん – マリーゴールド | 1 | 1 | 0s |
| 山下達郎 – クリスマス・イブ | 10 | 0 | — |
| 山下達郎 – 幸せにさよなら | 0 | 0 | — |
| AKFG – Rockn Roll Morning Lights… | 0 (exact) | — | — |

**6 of 10 songs return ~20 candidates whose lengths span minutes.** Before Phase 1,
the matcher chose among those on title and artist similarity alone — and for a query
like "RIDE ON TIME" by 山下達郎, twenty candidates all match the title and artist
essentially perfectly. Selection was effectively arbitrary among near-identical
scores.

This is a stronger result than expected and directly validates the Phase 1 fix.

**Incidental finding:** あいみょん – マリーゴールド returns exactly **one** synced
entry, and it is a live recording (`Live in 阪神甲子園球場, 2022.11.05`, 5:07). A user
with the studio version gets live timings with no alternative available — precisely
the version-mismatch class this work targets, and a case where the version-marker
penalty correctly signals the mismatch even though nothing better exists.

## Result 2 — a real but modest population has no usable timings

Probed through the real `findLyrics`, not the raw API:

| Song | Found? | Synced? |
|---|---|---|
| 山下達郎 – 幸せにさよなら | **no** | — |
| 山下達郎 – クリスマス・イブ | yes | **no — plain text only** |
| AKFG – Rockn Roll Morning Lights… | yes | **yes** |

The AKFG case is the caveat that matters: the raw API returns nothing for an exact
query, but `findLyrics` resolves it via variant expansion to
`Rockn' Roll, Morning Light Falls on You` (apostrophe and comma). Any coverage number
taken from the raw API alone understates what the app can actually find.

**2 of 10 songs (20%) cannot be timed from sourcing** — one absent entirely, one with
text but no timings.

## Decision numbers

| Question | Answer |
|---|---|
| Songs where duration can change the pick | **6 / 10** |
| Songs with no synced lyrics the app can reach | **2 / 10** |

## The reported case cannot be fixed by Phase 1 — or by Phase 2 as designed

`幸せにさよなら (山下ヴォーカル・バージョン)` has **no LRCLIB entry at all**, in any
spelling, through either instrument. That has two consequences worth stating plainly:

1. Phase 1 cannot help this song. No scoring improvement finds a record that does not
   exist.
2. **Phase 2's Option A does not help it either.** That design assumed a *different
   version's synced timings* could be imported and warped. There are no timings for
   this song under any version, so there is nothing to warp.

What this song actually needs is its lyric text from some other source plus
audio-based auto-align — which the user already has, since the original bug report
showed vocal separation running on stored audio for this very track.

## Recommendation on Phase 2

**Build it, but not next, and revise its justification first.**

- The population is real (20%) but smaller than the population Phase 1 serves (60%).
- More importantly, the measured shape of the gap does not match Phase 2's premise.
  Of the two uncovered songs, one has **no lyrics at all** and one has **plain text
  without timings**. Neither is the "synced timings for a different master" case that
  `linearTimingFit` + drag-to-sync was designed around.
- The more valuable fallback for what was actually measured is the **plain-text
  path**: take unsynced lyrics and align them to the user's own audio. That already
  exists and works.

Phase 2 should be re-scoped against this evidence before being planned. Its
drag-to-sync UX remains the right answer for imported timings — but imported timings
turn out to be rarer than the design assumed.

## Tuning

`AGREE = 0.12` / `CONFLICT = -0.18` in `src/sources/versionMarker.ts` were **left
unchanged**. No regression appeared in the corpus that would justify moving them, and
moving them without a regression to justify it would be exactly the unmeasured
threshold-setting this task exists to avoid. They remain judgement values; a corpus
containing a *confirmed* wrong-version pick would be needed to tune them honestly.

## What could not be measured

- **No ground-truth "correct" answer per song.** Establishing which of twenty
  candidates is right for a given user's file needs that user's actual audio. The
  measurement therefore shows where duration *can* decide, not that it always decides
  correctly.
- **No before/after ranking diff.** Comparing selections against `main` needs a
  worktree checkout and a stable ground truth; without the latter the comparison would
  produce numbers without meaning.
- **Corpus is J-pop only**, matching the app's focus, so it says nothing about
  Western catalogue behaviour.
