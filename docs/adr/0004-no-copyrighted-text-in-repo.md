# ADR-0004: No copyrighted song text in the repository

- Status: accepted (partially implemented)
- Date: 2026-11-03

## Context

The public, MIT-licensed repository tracked full lyric sheets for commercial songs,
catalogue LRC files (full timed lyrics) and Whisper transcripts (near-verbatim lyrics) as
test fixtures. Publishing them is not ours to do. (This is an engineering decision, not
legal advice.)

## Decision

- Whole-song text fixtures are untracked and listed in `tests/privateFixtures.mjs`; local
  copies stay at the same paths so local tests run unchanged. `vite.config.ts` excludes
  the dependent tests when any of those files is missing (CI, fresh clones).
- Benchmarks and experiments store hashes, line indices and times, never lyric text, and
  their logs never print lyric text.
- Real-audio regression tests in CI should use openly licensed recordings.

## Not yet done

1. **Git history** still contains the files. Removing them needs a history rewrite
   (e.g. `git filter-repo --invert-paths --paths-from-file …`) and a force-push, which
   breaks existing clones and forks. Owner decision.
2. **Inline excerpts** remain in some test sources, scripts and docs (for example
   `tests/lyrics/fixtures/akfg-korogaru.ts`, `tests/ai-pipeline/wordAligner.test.ts`,
   `scripts/audit-rockn-roll-pairings.mjs`). Short quotes may be defensible; whole verses
   should be replaced with invented text that has the same structure.

## Reversal

None expected.
