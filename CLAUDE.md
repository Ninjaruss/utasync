# Utasync — instructions for coding agents

Utasync (歌sync) makes Japanese songs karaoke-ready with as little effort as possible, then
helps you learn Japanese by singing along. Two experiences matter: **preparation** (correct
lyrics, correctly timed, without manual work) and **practice** (sing along with furigana,
romaji, translation, line repeat, speed). Everything else is secondary.

## Where the project is

- This repo is the **React/TypeScript PWA**. It is in **maintenance**: fix bugs and data
  export; do not add features (ADR-0002).
- The successor is a **native Android app** (`android/`, Kotlin + Compose + Media3 + Room).
- The alignment engine for Android is **not chosen yet**. It is decided by the Phase 0
  experiment (`experiments/phase0/`, ADR-0003). Do not port `src/ai-pipeline/` to Kotlin.

## Commands

```sh
npm run dev                 # Vite dev server
npx tsc -b                  # typecheck (src + build config; tests/ is NOT typechecked yet)
npm run lint
npx vitest run              # unit tests; tests needing private fixtures auto-skip when absent
npm run benchmark:sync -- inventory        # human-onset benchmark (benchmarks/sync/README.md)
node experiments/phase0/knownTextAlign.mjs <song> --prior lrc   # Phase 0 arm D
node experiments/phase0/score.mjs                               # Phase 0 report
```

Android (`android/`): `./gradlew :app:assembleDebug test` — see `android/README.md`.

## Rules

1. **Accuracy claims need the benchmark.** Any change that can move lyric timing includes a
   before/after table from `benchmarks/sync` (blind human onsets) or `experiments/phase0`.
   LRC files, stored transcripts and model confidence are not truth. Never tune on a
   held-out song.
2. **No new threshold without a measurement.** A numeric constant that gates behaviour gets
   a line in `docs/superpowers/audits/2026-09-28-measurement-ledger.md` saying what was
   measured and how to reproduce it.
3. **Spike before building.** New ideas start in `experiments/` with a pass/fail gate written
   *before* the first run, time-boxed to one day. Nothing enters `src/` or `android/` until
   the gate passes. Record the result (pass or fail) in the ledger or an ADR.
4. **Small diffs.** One concern per change, about 400 changed lines at most. No drive-by
   refactors. Never edit or delete a test to make it pass; never loosen a ratchet to green.
5. **Ask first** before adding a dependency, a model, a network service, or anything that
   downloads data at build time.
6. **No copyrighted song text in git.** Lyrics, catalogue LRCs and transcripts of real songs
   stay local (`tests/privateFixtures.mjs`, `public/e2e/`, `benchmarks/sync` audio). Logs and
   reports print line indices and times, never lyric text (ADR-0004).

## Decisions

Architecture and product decisions live in `docs/adr/` (one page each, with the condition
that would reverse them). Read the relevant ADR before changing an area; write a new one
when you make a decision another session would otherwise re-litigate. The long plans in
`docs/superpowers/` are history: useful evidence, not instructions.

| ADR | Decision |
| --- | --- |
| 0001 | Record decisions as short ADRs; plans are not instructions |
| 0002 | Native Android successor; PWA in maintenance |
| 0003 | Known-text alignment is the lead hypothesis, pending the Phase 0 gate |
| 0004 | No copyrighted song text in the repository |
| 0005 | Android v1 is local audio only (no YouTube) |
| 0006 | How alignment accuracy is measured (offsets reported, truth as hashes, shortfall fails) |

## Measured facts worth knowing (see the ledger for sources)

- Refining against an already-timed LRC beats aligning from scratch, 8 of 8 pairs (L12).
- Stored transcript fixtures flatter the live pipeline badly (guitar p90 2.29 s fixture vs
  10.73 s live, L32/L33). Do not benchmark against them.
- Vocal isolation fixes tails but worsens most lines on clean songs (L35).
- Lyric-prompted Whisper echoes the prompt even over non-vocal audio (L18).
