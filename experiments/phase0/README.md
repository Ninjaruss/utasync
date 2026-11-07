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

Evaluated **only** against complete, adjudicated, blind human onsets (`benchmarks/sync`),
on ≥10 songs: D passes if ≥85% of line starts are within 250 ms, no unflagged line is over
1 s, and D beats both B and A on p90. Truth-free diagnostics in `score.mjs` section 2 show
whether D is anchored to the audio; they cannot pass the gate.

## What is needed next

1. Blind human onsets for the songs D has run on (`npm run benchmark:sync -- review <song>`),
   then adjudication. Today only `will-death-poetry` has (draft) marks, and its audio was not
   reachable from the agent session.
2. More songs with catalogue LRC priors (target 20, with ≥5 held out).
3. Arm C, if the MMS model can be fetched once on a machine with network access.

## PJS medleys (truth without a listening pass)

`pjs/buildCorpus.mjs` builds songs with known onsets from the PJS corpus (real Japanese singing,
CC BY-SA 4.0). Download PJS ver. 1.1 from
https://sites.google.com/site/shinnosuketakamichi/research-topics/pjs_corpus and unzip it to
`.cache/pjs-src/`, then:

```sh
node experiments/phase0/pjs/buildCorpus.mjs .cache/pjs-src            # unaccompanied
node experiments/phase0/pjs/buildCorpus.mjs .cache/pjs-src --bed <openly licensed backing.wav>
node experiments/phase0/knownTextAlign.mjs pjs-medley-01 --manifest .cache/pjs/manifest.json --prior lrc
node experiments/phase0/score.mjs --manifest .cache/pjs/manifest.json
```

Limits: each PJS song is one composed sentence sung solo, so medleys are clean, short-line
material. They test whether the aligner places sung lines correctly; they do not replace marks on
real mixed J-pop for the ADR-0003 gate.
