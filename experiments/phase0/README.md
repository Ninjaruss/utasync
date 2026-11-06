# Phase 0 — alignment decision experiment

Decides the Android alignment engine (ADR-0003). Built on the hash-locked
`benchmarks/sync` manifest and its blind human-onset annotations.

## Arms

| Arm | What | Status |
| --- | --- | --- |
| A | Current PWA pipeline, live (`npm run benchmark:sync`, real browser) | runs exist for going-my-way, guitar, veil, will |
| B | Catalogue LRC as-is (prior of D@lrc) | 5 songs (legacy LRCs) |
| C | MMS CTC forced aligner, windowed, `<star>` skip token — **ceiling only** (CC-BY-NC) | **not run**: model not cached and huggingface.co unreachable from the agent environments |
| D | Whisper-small known-text alignment (cross-attention DTW) in windows around a prior | `knownTextAlign.mjs` |

D forces the decoder through `[sot, ja, transcribe, notimestamps, prev line, line, next line]`
on a ≤30 s window placed from the prior only (never from D's own output) and reads the line
start from transformers.js `_extract_token_timestamps`. The same window planner is ported to
Kotlin in `android/align` (`Windows.kt`) and matches this script exactly (48/48 windows on veil).

Each line carries `pinned: true` when its start sits on its window edge (it was the first text
in the window and follows the prior, not the audio). The flag is free and caught 8 of 10
planted failures with no false alarms (ledger L37); a `♪` filler that tried to fix the cause
failed its gate (`spikes/2026-11-04-prior-following.md`).

## Run

```sh
node experiments/phase0/knownTextAlign.mjs veil --prior lrc
node experiments/phase0/knownTextAlign.mjs veil --prior run:.cache/sync-benchmark/runs/<id>.json
node experiments/phase0/knownTextAlign.mjs veil --prior lrc --prior-shift 0.8   # planted offset
bash experiments/phase0/runAll.sh        # the whole batch, resumable
node experiments/phase0/score.mjs        # markdown report
```

Uses the cached `Xenova/whisper-small` in `node_modules/@huggingface/transformers/.cache`
(no network). Set `PHASE0_TRANSFORMERS=<dir>` to load a platform-matched install of
transformers.js 3.8.1 (needed inside the Linux VM, whose `node_modules` were installed on macOS).
About 5 s per line on 2 CPU cores; peak memory over 2 GB.

## Gate (pre-registered in ADR-0003)

The gate's evidence terms were **restated on 2026-11-06** (ADR-0003, "Gate"; thresholds in
ledger L41; measurement rules in ADR-0006). In short: only `human-onsets` (blind, adjudicated)
and `corpus-onsets` certify; ≥10 PJS medleys (≥3 accompanied, ≥60 lines) **and** ≥2 real
accompanied songs with no catalogue LRC (≥50 lines, ≥20 per song, on the stratified sample
ADR-0003 fixes in advance); each kind must separately reach ≥85% of starts within 250 ms with
no unflagged line over 1 s and beat arms A and B on p90, paired on the same lines. The two
kinds are never pooled, so PJS volume alone cannot pass the gate.

**Both kinds in one report.** The real songs and the medleys live in different manifests, and
`--manifest` may be repeated (or given a comma-separated list), so one invocation covers both:

```sh
node experiments/phase0/score.mjs --manifest benchmarks/sync/manifest.json --manifest .cache/pjs/manifest.json
```

Scoring one manifest alone shows the other kind with zero songs, which can never be MET.
Section 2 prints every clause, what was scored, the shortfall and the verdict; too few songs
or lines is NOT MET, never a pass.

**What MET does and does not certify.** Clause 2 exempts a *flagged* line from the over-1 s check
entirely, at any error, and clause 1 tolerates the rest, so a kind can read MET with ~15% of its
scored lines wrong by any amount provided the aligner flagged them. Section 2 therefore prints
three **reported, not gating** rows — flagged lines, the worst scored line, and the missing
predictions counted in "scored lines" — and they are the rows to read beside the verdict. ADR-0003
states the consequence beside clause 2: the gate certifies that false confidence is *labelled*,
not that it is gone. The constant behind the flag (`PIN_SEC`) is ledger L42.

Two further checks the scorer makes for itself: a `human-onsets` song is gate-ineligible, with the
reason printed, when its scored lines are not the ones ADR-0003's sampling rule selects (recomputed
from the raw sheet, blank lines and all, since the rule is defined on blocks); and a sheet of fewer
than 20 lines can never satisfy the per-song clause, which is why `will-death-poetry` (18 lines)
cannot be one of the gate's two real songs.

**Arms A and B on a medley.** Arm B is the synthetic prior `buildCorpus.mjs` plants (constants:
ledger L42) — which is why the report's row reads `D p90 below arm B, per song with an arm B prior`
rather than "with an LRC". The gate's real songs must have no catalogue LRC, so arm B does not
exist for any of them and the gate never compares D against a real catalogue artefact. Arm A is a
run of the current PWA pipeline over the medley's own `.wav` and sheet. The plumbing for that now
exists: `scripts/sync-benchmark.mjs` takes `--manifest` (repeatable, comma lists, as `score.mjs`
does) and `runAll.sh` has a PJS section (`PJS_MANIFESTS` overrides its two default manifests).
Arm A is still a real-browser run per medley, so the order is:

```sh
npm run benchmark:sync -- stage-pilot --manifest .cache/pjs/manifest.json   # then open /?benchmark=pilot
npm run benchmark:sync -- collect
bash experiments/phase0/runAll.sh      # per medley: D@lrc (arm B), and D@run from its newest completed run (arm A)
```

A medley with no completed browser run is skipped and logged; its arm A then reads "not evaluated"
(NOT MET), never a guess. **Unexercised on a real medley**: this was built and tested on synthetic
fixtures because the PJS archive was not available, so whether the pipeline aligns a medley sensibly
is untested. See ADR-0003. Truth-free
diagnostics in section 3 show whether D is anchored to the audio; they cannot pass the gate.

## What is needed next

1. Blind human onsets on the stratified sample, for two real accompanied songs with no
   catalogue LRC (`npm run benchmark:sync -- review <song>`), then a second listening pass and
   adjudication. Today only `will-death-poetry` has marks, still `status: "draft"` after one
   pass, so nothing certifies: the report lists it as not gate-eligible, and
   `npm run benchmark:sync -- inventory` prints `referenceCertifies: false` beside its
   `human-onsets` kind. Its sheet is 18 lines, below the gate's per-song minimum, so **both**
   gate songs still have to be found and marked.
2. More songs with catalogue LRC priors (target 20, with ≥5 held out).
3. Arm C, if the MMS model can be fetched once on a machine with network access.

## PJS medleys (truth without a listening pass)

`pjs/buildCorpus.mjs` builds songs with known onsets from the PJS corpus (real Japanese singing,
CC BY-SA 4.0). Download PJS ver. 1.1 from
https://sites.google.com/site/shinnosuketakamichi/research-topics/pjs_corpus and unzip it to
`.cache/pjs-src/`, then:

```sh
node experiments/phase0/pjs/buildCorpus.mjs .cache/pjs-src            # unaccompanied
node experiments/phase0/knownTextAlign.mjs pjs-medley-01 --manifest .cache/pjs/manifest.json --prior lrc
node experiments/phase0/score.mjs --manifest .cache/pjs/manifest.json
```

**The gate's "≥ 3 accompanied" row needs two builder runs, and therefore two manifests.** `--bed`
is a single global flag for a whole run and the manifest is written once at `--out`, so one run
cannot produce both kinds of medley. Build them separately, into separate output directories, and
pass every manifest to the scorer (`--manifest` may be repeated, or given a comma-separated list):

```sh
node experiments/phase0/pjs/buildCorpus.mjs .cache/pjs-src                         # -> .cache/pjs/manifest.json
node experiments/phase0/pjs/buildCorpus.mjs .cache/pjs-src --bed <backing.wav> \
     --out .cache/pjs-bed                                                          # -> .cache/pjs-bed/manifest.json
# align each medley against the manifest that knows it, then one report over all three manifests:
node experiments/phase0/score.mjs \
  --manifest benchmarks/sync/manifest.json \
  --manifest .cache/pjs/manifest.json \
  --manifest .cache/pjs-bed/manifest.json
```

The `--bed` run names its medleys `pjs-medley-NN-bed`, so the two sets never collide and the
scorer's own duplicate-id guard stays quiet. ADR-0003 names `.cache/pjs/manifest.json` as *the*
medley manifest; read that as "the medley manifests", one per builder run.

**Rebuilding with a different `--per` orphans annotations.** The medleys are numbered by group, so
changing `--per` renumbers them and the previous `pjs-medley-NN.json` files stay on disk. They are
well-formed `corpus-onsets` files, so `corpus-ci` still passes *and still counts* them, which makes
its PJS count read higher than the evidence — nothing in the new manifest can ever score them. The
builder now warns and lists them at the end of a run (scoped to its own `--bed`-ness, so the
two-run workflow above does not cry wolf). Delete them, or rebuild with the options that made them.

What is committed and what is not:

| Output | Where | Committed |
| --- | --- | --- |
| Hash-only truth annotation (`kind: corpus-onsets`, per-line `textHash`, no lyric text) | `experiments/phase0/pjs/annotations/<id>.json` | yes; validated by `node scripts/corpus-ci.mjs` |
| Medley `.wav`, lyric sheet `.lyrics.txt`, synthetic prior `.lrc.json`, `manifest.json` | `.cache/pjs/` | never (audio and lyric sheets stay local; the manifest names local paths) |
| The PJS archive itself | `.cache/pjs-src/` | never |

PJS is CC BY-SA 4.0 (Koguchi & Takamichi, arXiv:2006.02959). The download is manual (a Google Drive
link) and is not fetched by any script. The committed annotations hold onsets and hashes only, so
no corpus audio or text is redistributed. The builder refuses to overwrite an annotation that is not
already `corpus-onsets`. `uncertainty` per line (0.02 s from a phoneme label, 0.05 s from an energy
onset) is explained in ledger L40. Medley audio is rebuilt locally; its hash depends on the local
ffmpeg, so rebuild and re-score together rather than mixing audio from one machine with
annotations from another unless `audioSha256` matches.

Limits: each PJS song is one composed sentence sung solo, so medleys are clean, short-line
material. They test whether the aligner places sung lines correctly; they do not replace marks on
real mixed J-pop for the ADR-0003 gate.
