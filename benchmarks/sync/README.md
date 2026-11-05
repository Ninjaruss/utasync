# Seven-song sync benchmark pilot

This is a development benchmark, not evidence that Utasync works on most songs.
All seven songs have already been inspected during development. None is held out.
Expand later to 15–20 varied recordings, reserving at least five previously unseen
songs before tuning. Do not re-label these seven as held out.

## What is measured

`/?benchmark=<id>` mounts the actual AutoAlignFlow component in a real browser.
It seeds untimed lyrics and the hash-verified recording; supplies no truth to the
component; captures saved line timings, labels, runtime, logs and isolation verdict;
then removes its temporary song/audio and restores the settings it changed.
The ordinary isolation policy is the default. `stage --mix` is a separately labeled
configuration, not the product default. Use one model job at a time on a 16 GB Mac.
The run is the alignment workflow, not a verification of player highlighting,
audio-device latency, lyric lookup or subjective listening correctness.

Runs stop after 12 minutes and record timeout rather than pass. The time budget
includes model loading; report cold/warm cache state separately when benchmarking
latency. This pilot records user agent, not a controlled hardware performance test.

## Commands (repository root)

```sh
npm run benchmark:sync -- inventory
npm run benchmark:sync -- review will-death-poetry
npm run benchmark:sync -- template will-death-poetry
npm run benchmark:sync -- stage will-death-poetry
npm run dev -- --host 127.0.0.1 --port 5188 --strictPort
# Open http://127.0.0.1:5188/?benchmark=will-death-poetry
# Wait for completed / failed / timeout on the page, then:
npm run benchmark:sync -- collect
npm run benchmark:sync -- report
npm run benchmark:sync -- score will-death-poetry .cache/sync-benchmark/runs/<run-id>.json
npm run benchmark:test
```

For a sequential seven-song run, use `stage-pilot --mix` and open `/?benchmark=pilot`. The suite stops on timeout or cancellation rather than leaving model jobs running indefinitely.

`inventory` verifies files against the frozen manifest. Audio stays in ignored
`public/e2e/`; the Will recording is locally symlinked from Downloads. Other clones
must supply matching recordings. Missing recordings are missing, not skipped passes.
`stage` creates ignored browser inputs and records git revision/diff digest and harness hash. Early pilot records predate the harness-hash field; preserve the accompanying source snapshot with those records. Git diff alone does not describe untracked files. Model IDs use the app’s current unpinned model distribution, so exact weight identity is not established by this harness. Audio
can be copyrighted: do not commit or publish staged recordings or reference lyrics
without appropriate rights. Run server bound to loopback.

Run outputs are immutable files in `.cache/sync-benchmark/runs`. Collection reads
only final benchmark records from Vite's existing status sink. Collection also writes `unfinished.json` for starts lacking a final record (active or interrupted); these are not completed results. Keep failures and
all attempts: do not report only the best retry. Reload only after completion or
a recorded timeout; early navigation interrupts the run and has no final score. An interrupted/hot-reloaded run can also leave its temporary song/audio in that local test profile; normal terminal runs clean up their own fixtures.

## Reference policy

AKFG has 24 coarse caption starts and six excluded shared-caption rows. It can
reject gross errors, but cannot certify half-second accuracy. Its 177 s caption
is preserved consistently. The source is the existing repository fixture, not a
new caption retrieval.

Other legacy LRC references are quarantined as unverified until the exact version
and timing are listening-checked. Similar duration, a fitted median offset, text
agreement or model confidence cannot establish a correct reference. This also
applies to recordings described as "version matched" by older audit manifests.

The review HTML hides all predictions within the tool. Prior exposure elsewhere is unknown by default; record `priorPredictionExposure: "none"` only when true. Known exposure may still support diagnostic metrics, but cannot certify a blind-accuracy pass. Choose the exact audio, pause on the first
audible sung syllable, record uncertainty, and export. It creates draft annotations.
Do not inspect predictions first. A second listening pass/reviewer must resolve
uncertain marks. Do not automatically change draft to adjudicated. Once checked,
record reviewer/provenance, set `status: "adjudicated"`, and save at the manifest's
annotationPath. Preserve the original draft separately. Empty marks remain null.
The template command refuses to overwrite existing annotation work.

The scorer binds both audio and lyric-file hashes and exact text/order. It uses
absolute error, without offset fitting. Missing predictions count against the
reference denominator. Incomplete marks, coarse references and failed runs cannot
produce a precise-accuracy pass. Metrics computed from available predictions are
accompanied by missing-prediction counts; never read their p90 alone as success.

Proposed pilot criterion: at least 90% of all line starts within 0.5 seconds and
none over 2 seconds, using complete adjudicated blind human marks with uncertainty
at most ±0.25 s. This is a working engineering target, not established user research.
Report per-song pass rate, not just pooled lines (long songs must not dominate).
A line-start benchmark does not validate line ends or word/syllable karaoke timing.

## Next gates

1. Complete full-app baseline for all seven, retaining errors/timeouts.
2. Establish independent references before making a precise accuracy claim.
3. Test one change at a time; compare tails, missing lines and accurate-line regressions.
4. Log manual correction count and elapsed correction time during human review;
   neither can be inferred from confidence labels or transcript match coverage.
5. Freeze candidate and reference versions, then evaluate previously unseen songs.
6. Check real player playback, seeking and repeated choruses on target devices.

No global alignment settings or production behavior are changed by this benchmark.
