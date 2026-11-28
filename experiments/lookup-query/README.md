# Does rung 2 ask LRCLIB the wrong way?

**Written before the first run (rule 3). Time box: one day.**

## The observation that prompted it

`searchUrl` sends `/api/search?track_name=…&artist_name=…`. While measuring L67 it
turned out that the free-text parameter answers differently: for one of the owner's
files, `track_name=road to tomorrow` returns **0** records and `q=road to tomorrow`
returns **17**. If that holds across the corpus, the app is losing candidates to a
parameter choice rather than to the catalogue.

Rung 1 (`/api/get`) is **out of scope**: it is an exact lookup and must keep sending
exact fields. Only rung 2, the fuzzy search the user picks from, is in question.

## What is measured

The owner's local audio files — the corpus that matters, since the whole problem is
that they carry no embedded tags. For each file, two name forms:

- **as the app sees it today**: the filename with the L67 download tail removed;
- **as it would be after a rename**: a title and artist typed by hand.

and, for each form, the two ways of asking:

| regime | today | candidate |
| --- | --- | --- |
| no artist | `track_name=<name>` | `q=<name>` |
| with artist | `track_name=<title>&artist_name=<artist>` | `q=<artist> <title>` |

**Success for one probe is not "returned something".** A list of twenty wrong records
is worse than nothing: it costs the user a decision and invites a wrong pick. A probe
counts as a hit only when the returned list contains a record whose duration is within
**±3 s** of the user's own file — the same arithmetic `lengthComparison` already shows,
and the only objective signal available without hearing the songs. For veil the correct
record was 218.0 s against a 218.8 s file, so the window is wide enough to admit a true
match and narrow enough to exclude the 1:55-out studio cuts of a live recording.

The rank of the first such record is also recorded, because the user reads a list.

## The gate

Switch rung 2 to `q` only if **both** hold:

1. `q` produces a duration-matching candidate for **strictly more** files than
   `track_name` does, in at least one of the two regimes; and
2. `q` **never loses** a file that `track_name` found, in either regime.

Anything else and rung 2 stays as it is, and this file records why.

Condition 2 is there because "more results" is not the same as "better results", and a
change that trades one song for another is not an improvement — it is churn with a
migration cost.

## Limits, stated before the run

- A duration match is a proxy for the right record, not proof of it; nothing here was
  heard. It can admit a coincidental match and can miss a correct record whose declared
  length is wrong.
- Ten files, one person's library, heavy on Japanese titles. The result does not
  generalise to anyone else's catalogue.
- The hand-typed names are my reading of what each file is; where I could not establish
  a title and artist with confidence, the file is reported in the no-artist regime only.
- LRCLIB is a live service. Counts may drift.

## Reproduce

    node experiments/lookup-query/probe.mjs <folder-of-audio-files>

No lyric text is read, stored or printed (rule 6). Filenames stay on the local machine:
the script takes a folder, and the report prints shapes and counts, never the corpus.
