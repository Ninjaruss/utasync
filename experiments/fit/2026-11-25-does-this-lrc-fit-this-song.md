# Spike: does this LRC belong to this audio file?

**Written 2026-11-25, before the first run.** Rule 3: the gate below is pre-registered. Whatever
comes out is recorded, pass or fail.

## Why

ADR-0007 proposes that Android v1 does no automatic alignment: a song is singable because a
catalogue LRC already fits it, or because the user timed it by hand. L65 then measured that 105
of the owner's 111 songs already have synced lyrics on LRCLIB, so the catalogue path is the
app's main path, not a fallback.

That makes one unmeasured risk the dominant one, and L65 names it: **a synced record can belong
to a different cut than the audio the user owns.** A TV-size record against the full version, a
live take against the studio one, an edit against an album master. The lyrics are the right
lyrics; the timings are for a different recording, so every line is wrong by a growing amount.
`stranger-than-heaven` in the benchmark corpus is exactly this (a 237 s LRC against 233.57 s of
audio).

What the app checks today, read off the code:

| Path | Check |
| --- | --- |
| Rung 1, `/api/get` | duration sent; **LRCLIB's server** rejects a record more than ±2 s from it |
| Rung 2, `/api/search` → user picks | none. `candidateLabel` *shows* each record's length and the user compares by eye |
| Paste an LRC / open an `.lrc` file (`importLrc`) | **none at all.** Parse, store, done |

So two of the three ways lyrics get into the app have no fit check, and none of the three looks
at the lyric **timestamps** — the ±2 s rule compares the record's *metadata* duration, which a
record can state correctly while carrying timings for another cut.

## The question

Can a check that compares an LRC's own timestamps (and, where there is one, the record's declared
duration) against the audio's real duration catch a wrong cut without crying wolf on good records?

## Arms

Each judged alone, on the same pairs.

- **A — past the end (deductive).** Any line starts after the audio ends.
- **B — trailing gap.** The last line starts more than *G* seconds before the audio ends.
- **C — declared duration.** |record's declared duration − audio duration| > *D* seconds.
  Only available for a catalogue record; a dropped `.lrc` file declares nothing.
- **D — span ratio.** (last line − first line) / audio duration outside [*lo*, *hi*].

*G*, *D*, *lo*, *hi* are read off the matched population below — never tuned to improve recall.
Each is set at the matched population's 95th percentile (or 2.5/97.5 for the two-sided ratio), so
the false-alarm rate is fixed at ~5% by construction and recall is what the arm earns.

## Pairs

Built from the owner's playlist (111 songs, `song-coverage.csv`), whose `source_url` resolves
each song to an LRCLIB record id.

- **Matched (the false-alarm population).** Each synced record's own lyrics against **its own
  declared duration**. These are the records the October pipeline matched to these songs; they
  stand in for "the user's audio is the cut this record is for". ~105 pairs.
- **Mismatched (the recall population).** For each song, `/api/search` returns the other records
  of the same song. Pair record X's synced lyrics with record Y's duration where
  |dur X − dur Y| ≥ 10 s. That is the real failure: the user's file is cut Y, the lyrics fetched
  are cut X. 10 s is the experiment's own line, not the app's: a track that differs by ten
  seconds has lines out by seconds somewhere, past any tolerance for singing along, while a
  second or two is usually a remaster whose lyrics still work.

A declared duration is not a measured one, and that is this design's main weakness: it is stated
in **Limits** and does not get argued away afterwards.

## Gate

Pass needs **both**, for at least one arm, with that arm judged alone:

1. **Recall ≥ 80%** of mismatched pairs flagged.
2. **False alarms ≤ 5%** of matched pairs flagged.

- **Pass** → implement that arm in `:align` as a pure function, shown at every point lyrics
  enter a song (rung 1, rung 2, file import), with the threshold and this measurement in the
  ledger.
- **Fail** → arm A ships anyway, because it is arithmetic and not a threshold: a line that starts
  after the audio ends cannot be right, whatever the measurement says about the rest. Nothing
  else ships, and the failure is recorded.

Either way the app only ever **warns**. It never refuses lyrics and never rewrites a timing: a
flag the user disagrees with must cost them nothing.

## Limits, written now

- A declared duration is metadata, not a measurement of the user's file. A record could state a
  duration it does not have, which would show up as a false alarm here and not in life, or hide a
  real mismatch.
- The matched pairs are *presumed* correct because a pipeline matched them. None was heard.
- The playlist is one person's, curated by a pipeline that needed lyric text (L65).
- Flagging is not fixing. A caught mismatch leaves the user where they were: pick another record,
  paste the words, or time it by hand.

## Result

Filled in by `node experiments/fit/fitScreen.mjs` after the run, below this line.

---

**Run 2026-11-25. The gate FAILS. No arm meets it.** 105 matched pairs, 291 mismatched pairs
over 72 songs. Thresholds off the matched population: *G* = 41.6 s, ratio ∈ [0.754, 0.974].

| arm | recall | false alarms | gate |
| --- | --- | --- | --- |
| A past the end | 49% | **0%** | fail (recall) |
| B trailing gap | 23% | 5% | fail (both) |
| D span ratio | 65% | 6% | fail (both) |
| A or B | 73% | 5% | fail (recall) |

Arm C was not evaluated: the pairs are built from the declared-duration difference, so scoring it
here would be circular.

**What ships, per the fail branch written above: arm A, and nothing else.** Not because 49% is
good, but because it is arithmetic — a line that starts after the audio ends cannot be right —
and because it cost nothing: of 105 real records, **none** has a timestamp past its own declared
length, so the false-alarm rate is 0% measured as well as 0% by argument.

**What arm A does not do, which matters more than what it does.** Split the mismatched pairs by
how far apart the two cuts are:

- 131 pairs differ by ≥ 60 s (a TV-size record against the full song, say): arm A catches **85%**.
- 116 pairs differ by < 30 s (an edit, a single version, a remaster): arm A catches **13%**;
  A-or-B, 34%.

So the gross mismatch is caught and the near one is not — and the near one is the dangerous one,
because the lyrics look plausible for the first verse and drift after. B and D were the arms aimed
at it, and neither earned its place: at a false-alarm rate fixed at ~5%, B sees almost nothing and
D is no better than a coin flip on the pairs it is meant for.

**The conclusion for the app is not a better threshold.** It is that a timestamp-only check cannot
tell a nearly-right cut from a right one, so nothing in the import path should claim to have
verified the fit. The app says what it knows (this LRC runs past the end of your file; this record
is N seconds longer than your file) and leaves the verdict to the one instrument that can settle
it — the user pressing play.
