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

`node experiments/phase0/score.mjs` section 2 prints every clause, what was scored, the
shortfall and the verdict; too few songs or lines is NOT MET, never a pass. Truth-free
diagnostics in section 3 show whether D is anchored to the audio; they cannot pass the gate.

## What is needed next

1. Blind human onsets on the stratified sample, for two real accompanied songs with no
   catalogue LRC (`npm run benchmark:sync -- review <song>`), then a second listening pass and
   adjudication. Today only `will-death-poetry` has marks, still `status: "draft"` after one
   pass, so nothing certifies: the report lists it as not gate-eligible.
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
