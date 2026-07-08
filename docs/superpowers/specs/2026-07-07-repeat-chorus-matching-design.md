# Repeat-Chorus Matching for the Lyric Aligner

**Date:** 2026-07-07
**Status:** Approved (Approach A, interviewed 2026-07-07)
**Prereq:** Line-boundary accuracy work (PR #3, merged) — locked boundary
baseline + findings in `docs/superpowers/2026-07-line-boundary-findings.md` §5.

## Problem

Repeated chorus lines collapse onto the wrong occurrence: the first occurrence
of a chorus matches the transcript cleanly, later copies fail (cov 2/33–12/36)
and fall to `needs_review`. Stranger than Heaven — the mixed JP+EN reference
song — has 27/59 (word) and 21/59 (segment) lines flagged, ~13× the corpus
median, making its per-line anchors unusable. Findings §5 shows this is a
repeat-disambiguation problem, not an EN-tokenization problem.

The existing re-anchor machinery (`realignRepeatedStanzaOccurrences` in
`src/lyrics/repeatedStanzaAlignment.ts`) misses this song for three specific
reasons:

1. **Verbatim-only repeat detection.** The final chorus differs from earlier
   ones only by ad-libs — "(Ah)", "(Tested my fate)", "、oh" — so
   `findRepeatedStanzas` never groups it with its family.
2. **Blanket 2-occurrence skip.** The `occurrences.length < 3` guard (added
   because Veil's verse pairs diverge in Whisper text) also skips stranger's
   bridge (L44–47 vs L48–51) and main chorus (L15–21 vs L32–38), which repeat
   exactly twice.
3. **Interjection lines are scored.** L39–L43 ("Ahh, ooh-hmm, yeah-yeah" …)
   have no phonetic content a JP Whisper model can transcribe; they fail 100%
   and land in `needs_review` although no review can improve them.

## Decisions from interview

- **Goal:** correct timing anchors for later occurrences (not just label
  cleanup) — measured by the corpus scorecard.
- **Interjections:** formal carve-out — interpolated timing, `approximate`
  quality, excluded from match-rate metrics as un-scoreable.
- **Fuzzy repeats:** yes — near-identical variants (~85%+ similar after
  ad-lib-stripped normalization) count as the same repeat.

## Design (Approach A — extend existing machinery)

No changes to the core LCS/contentAligner matching. Three localized changes:

### 1. Fuzzy repeat keys (`repeatedStanzaAlignment.ts`)

`findRepeatedStanzas` currently keys stanzas on exact
`normalizeForMatch(line)` joins. Change:

- Strip parenthetical ad-libs — `(...)` / `（…）` groups — from the normalized
  key text before comparison.
- Two stanza keys match when their per-line normalized texts are each ≥ 0.85
  similar (char-level similarity ratio, e.g. LCS-length / max-length — small
  helper, no dependency). Exact match remains the fast path.
- Occurrence grouping must remain deterministic: keep the existing
  earliest-first / longest-block preference untouched.

### 2. Evidence-gated 2-occurrence re-anchor (`repeatedStanzaAlignment.ts`)

Replace the blanket `if (stanza.occurrences.length < 3) continue` with a
score gate applied per re-anchored occurrence:

- Compute the candidate window as today (forward cursor + reference duration
  from the first occurrence).
- Accept the re-anchor only if `scoreLineAlignment` over the candidate window
  yields quality `good`/`approximate` (coverage ≥ 0.35 with an `lcs` anchor)
  AND the candidate scores at least as well as the line's current placement.
- 3+-occurrence blocks keep today's behavior (no new gate — they are already
  shipped and baseline-locked); the gate applies only to the newly-allowed
  2-occurrence blocks. Veil's divergent verse pairs must fail the gate (its
  Whisper text for the second pass diverges, so coverage stays low) — this is
  a regression test, not a hope.

### 3. Interjection carve-out (`phraseAlignment.ts` + audit)

- Quality classification: a line matching the existing
  `isInterjectionLyricLine` predicate (`src/ai-pipeline/contentAligner.ts:63`)
  whose LCS span is null/low-coverage gets quality `approximate` (timing
  interpolated between neighbours, as today) instead of `needs_review`.
  Note: an `interjection` anchor source already maps to `approximate` in
  `classifyLineQuality` — the change covers interjection lines that fail to
  anchor at all.
- Scorecard: `scripts/audit-corpus.mjs` (and the CI guard test) report
  un-scoreable interjection lines as a separate informational column
  (`unscoreable`, string) and exclude them from `align_needs_review`-driven
  expectations for match-rate purposes. `bnd_*` metrics already skip them
  (null spans).

## Success bar

On the committed stranger-than-heaven fixtures (word + segment), after the
interjection carve-out:

- `align_needs_review` ≤ 1.5× the corpus median (median ≈ 2, so ≤ 3–4), from
  27 (word) / 21 (segment) today. If transcript garbling makes a specific
  chorus copy genuinely unmatchable, it is documented with transcript
  evidence (same carve-out discipline as the boundary work) and excluded.
- Later chorus occurrences carry `good`/`approximate` quality with timing
  anchored inside their own sung occurrence (verified per line against the
  transcript in tests).
- **Zero regressions**: all locked `bnd_*` baseline counters and all existing
  alignment metrics hold on the other 7 corpus entries; the full test suite
  stays green (Veil's 2-occurrence verse pairs specifically must not move).

## Out of scope

- Core LCS/matching-stage rewrites (occurrence-banded matching — Approach B).
- Phonetic matching of interjection vocalizations.
- Whisper/transcription changes; UI changes.

## Testing

- TDD per change against committed fixtures: stranger-than-heaven for the
  fixes, veil for the do-not-regress gate.
- Corpus scorecard is the instrument; baseline re-snapshot at the end locks
  the improvements (same workflow as the boundary effort).
