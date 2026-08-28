# Translation fitting: design

**Date:** 2026-08-27
**Status:** approved design, not yet planned
**Scope:** the second-language (translation) layer only. Audio alignment is untouched.

## Problem

A pasted translation rarely lines up one-for-one with the primary lyrics. Translators
work in whole thoughts: they fold two sung lines into one English sentence, expand one
into two, translate a repeated chorus once, and paste arrives wrapped in site headers,
translator notes and credits. The current fitter models some of this and silently
destroys the rest.

Concretely, today:

- Two source lines folded into one translation **cannot be represented**. The DP has no
  move for it, so one row is skipped and left permanently blank
  (`src/lyrics/lineAligner.ts:566`).
- Translation lines the DP could not place are **silently deleted**.
  `smartAttachSecondLanguageFromLines` correctly returns them as `extras` and sets
  `mismatchedBlocks` (`src/lyrics/lineAligner.ts:898`); `finalizeTimedAttach` hardcodes
  both back to empty one frame later (`src/lyrics/lineAligner.ts:808`, `:810`).
- Skipping is **free exactly when the mismatch is worst**:
  `skipPenalty = Math.abs(n - m) <= 1 ? 0.85 : 0` (`src/lyrics/lineAligner.ts:555`). At
  46-vs-40 the DP pays nothing to abandon whole regions.
- **No confidence is computed, surfaced or persisted.** `SmartAttachResult` carries a
  `method` but no score (`src/lyrics/lineAligner.ts:624`). Once applied, a bad pairing is
  indistinguishable from a good one. Contrast `lineAlignmentQuality` for audio alignment.
- The user is asked to vouch for the whole song on the strength of a **four-row preview**
  (`src/lyrics/SecondLanguagePanel.tsx:203`), and the "extra lines" that preview offers are
  a raw positional tail, not the aligner's real extras
  (`src/lyrics/SecondLanguagePanel.tsx:104`).
- Translation-side noise handling is far weaker than the primary side, which has
  `isPrimaryHeaderLine`, `isMetadataPrimaryLine` and `looksLikeJapaneseTitleLine`
  (`src/lyrics/lineAligner.ts:681-727`). The translation side has only
  `stripNonLyricLines` (`src/lyrics/bilingual.ts:97`).

### Why the tests do not catch any of this

Every committed fixture translation is **exactly line-parallel**: veil 48/48, akfg 30/30,
guitar-loneliness 47/47, zero blank lines in any of them. The pairing ratchet
(`tests/ai-pipeline/corpus-pairing.test.ts`) therefore exercises only the case that already
works. `tests/ai-pipeline/fixtures/pairing-truth.json` is hand-labeled known-bad **word**
pairs; there is no line-pairing truth anywhere in the repo.

The suite is green because it never sees a translation shaped like a real one.

## Measured finding: LRCLIB is not a translation source

Before designing an auto-fetch path, we probed the real API across ten well-known Japanese
songs (the corpus from `scripts/lyrics-source-coverage.mjs`), classifying every returned
entry with the same logic as `classifyLyricScript` (`src/sources/lyricsMatch.ts:149`):

| script | entries |
| --- | --- |
| native Japanese | 119 |
| romaji | 12 |
| **English / other** | **0** |

`findSecondLanguageInLRCLIB` (`src/sources/lrclib.ts:398`) — currently exported and called
from nowhere — would fire on **2 of 10** songs and return **romaji 100% of the time**,
because its `isAlternateLanguage` gate (`src/sources/lyricsMatch.ts:291`) tests script only.
Wiring it up as written would ship a bug that pastes a transliteration into the translation
layer.

**Decision: the translation source stays a human paste.** Machine translation and scraping
the translation sites were both considered and rejected for this round (see Alternatives).

**Carry-forward defect:** if `findSecondLanguageInLRCLIB` is ever used, for a *romaji* layer
where it is genuinely useful, it must be gated on `classifyLyricScript`, not
`isAlternateLanguage`.

## Goals

1. Represent a translation that spans two source lines, and render it honestly.
2. Never silently lose a pasted translation line.
3. Know, per row, how confident the fit is — and prove that signal is trustworthy.
4. Remove the review gate from the common case without hiding failure.
5. Be able to tell whether any of the above actually helped.

### Non-goals

- Reordering. The DP stays monotonic; real translations do not reorder lines.
- Replacing the five-route cascade (index / slots / semantic / mismatch / proportional
  time-spread). That is a defensible follow-up; it is not this round.
- Stanza-structure recovery for timed primaries (`src/lyrics/lineAligner.ts:934`).
  Deferred — see Deferred, below.
- Grouping the `SungPhrase` layer, which duplicates the `translation: string` shape
  (`src/core/types/index.ts:98`).
- Reviving the dead `preferFast` option (`src/lyrics/lineAligner.ts:633`).

## Design

### 1. The instrument (built first, before any fitter change)

Two layers, matching this repo's established pattern: a hand-run scorecard plus a vitest
ratchet that locks its numbers.

**`scripts/audit-line-pairing.mjs`** takes each clean 1:1 fixture pair, perturbs the
**English side only**, and scores what the fitter recovers. Because the perturbation is
synthetic, the true mapping is known by construction — no hand-labeling.

| perturbation | models | truth |
| --- | --- | --- |
| `merge-adjacent` | two lines folded into one thought | both JA rows to that one line |
| `split-line` | one line expanded into two | both EN lines to that one JA row |
| `drop-repeat` | chorus translated once, not every time | later chorus rows to nothing |
| `title-prefix` | site header pasted with the lyrics | to nothing |
| `translator-note` | a "(TN: ...)" line mid-song | to nothing |
| `section-headers` | `[Verse 1]` / `[Chorus]` markers | to nothing |
| `trailing-credit` | "Translated by ..." at the end | to nothing |
| `composite` | 2-3 of the above at once, a realistic paste | union |

Metrics per row of the scorecard:

- `line_correct` — assigned set exactly equals truth.
- `line_wrong` — assigned something, but the wrong thing. **Weighted worst**: a
  confidently wrong translation teaches the wrong meaning, which for a language-learning
  app is worse than a blank.
- `line_missing` — truth non-empty, assigned nothing.
- `lines_lost` — input translation lines appearing nowhere in the output. This is the
  silent-deletion bug as a number. Ratchets at 0 after Phase 1.
- `flag_precision` / `flag_recall` — of the rows flagged uncertain, how many were actually
  wrong; and how many of the wrong ones were caught.

Seeded and deterministic (no `Math.random`), so the baseline is reproducible.

**`tests/lyrics/linePairing.ratchet.test.ts`** plus a committed baseline JSON,
re-snapshotted only via `--write-baseline`, exactly like `corpus-baseline.json`.

### 2. The fitter

**2.1 The `G` move (merge originals).** `autoAlignLines` (`src/lyrics/lineAligner.ts:524`)
has `D` (1:1), `M` (two translations to one original), `U` (skip original), `L` (skip
translation). Add `G`: **two originals to one translation**.

Mechanically the mirror of `M`. Where `M` pre-embeds each adjacent *translation* pair and
reads `dp[i-1][j-2]`, `G` pre-embeds each adjacent *original* pair and reads
`dp[i-2][j-1]`. Cost is n-1 extra vectors in an already-batched call.

Two gates, mirroring `canMergeOnto` (`src/lyrics/lineAligner.ts:391`), which requires the
original be at least 16 glyphs before `M` may fire:

- the **translation** must be substantial before it may span two originals;
- the grouped score must beat `D + U`, so that pairing one row and blanking the other wins
  whenever that is the better reading.

The traceback assigns both originals to the same translation. That *is* the grouping
annotation — the bracket falls out of the alignment rather than being bolted on.

**2.2 The skip penalty — the same change.** The free skip is **compensating for the missing
move**. With no `G`, a folded translation cannot be expressed except by skipping originals,
so making skips expensive would force bad 1:1 pairings instead. The existing rule is the
right local call given the current move set. Once `G` exists, a constant penalty becomes
correct, because genuine structural mismatch now has a move that represents it.

`G` and the penalty ship and are measured **together**. Separating them makes both look
worse than they are.

**2.3 Stop losing lines.** Thread the real `extras` and `mismatchedBlocks` through
`finalizeTimedAttach` (`src/lyrics/lineAligner.ts:786`). `SmartAttachResult.extras` becomes
authoritative; `SecondLanguagePanel` reads it instead of rebuilding a positional tail
(`src/lyrics/SecondLanguagePanel.tsx:104`), which cannot represent a mid-song miss.

**2.4 Per-row confidence.** The DP computes a score for every move it takes and discards it.
Emit it, normalize per row, persist it. The flag threshold leans toward **over-flagging**,
per the `line_wrong` weighting above.

**2.5 Translation-side noise.** Mirror the primary-side detectors
(`src/lyrics/lineAligner.ts:681-727`) onto the translation side: title/artist matching and
translator-credit detection. Scored directly by the `title-prefix`, `trailing-credit` and
`translator-note` perturbations.

### 3. Data model

All additive, all optional. **No DB schema migration and no `PIPELINE_VERSION` bump** — absence means exactly
today's behavior.

On `TimedLine` (`src/core/types/index.ts:71`):

```ts
translationGroup?: number       // rows sharing an id share one translation
translationConfidence?: number  // 0-1
```

Rows in a group each keep the **same `translation` string**. This keeps `line.translation`
the single source of truth every existing consumer already reads — exporter, word pairer,
phrase layer, gloss, `hasVisibleTranslation` — so nothing has to learn about groups to keep
working.

It also fails in the right direction: code that ignores `translationGroup` renders the
translation repeated on both rows, which is a *degraded but correct* reading. Storing the
text only on the group's first row would instead degrade to a blank second row, which is
the exact symptom being fixed.

On `LyricsData` (`src/core/types/index.ts:105`):

```ts
unplacedTranslations?: Array<{ text: string; afterLineIndex: number }>
translationSource?: string      // the raw pasted block, retained for re-fitting
translationPairing?: {
  method: PairingMethod
  meanConfidence: number
  flaggedLineCount: number
  version: number
}
```

`afterLineIndex` is free — the traceback already knows where each `L` skip occurred — and it
is what lets the repair UI show an orphan *in context* rather than as an anonymous tail.

`version` is a *content* version for the pairing itself, independent of the DB schema and of
`PIPELINE_VERSION`; it follows the same convention those use, so a future fitter improvement
can re-fit stored songs instead of stranding them. **It is inert
without `translationSource`**; the two are one feature.

**Known leak.** The word pairer colours English words against JA tokens per row. Given a
grouped translation it would offer the whole sentence to both rows' tokens, when half
belongs to each. Fix: run the pairer over the group as a unit (concatenated originals
against the one translation), then distribute indices back per row via
`offsetTokenAlignmentIndices` (`src/lyrics/lineAligner.ts:206`), which exists for exactly
this offsetting. This cannot move `pair_wrong` on the existing corpus, because no groups
form on 1:1 input.

### 4. Experience

Paste, Attach, applied. The four-row confirm
(`src/lyrics/SecondLanguagePanel.tsx:199`) is removed.

**One gate remains, on a different question.** Per-row uncertainty is normal and is flagged,
not gated. *Global* low confidence means the paste is for the wrong song, and applying it
overwrites any existing translation. So: a single sanity check on mean confidence — below a
floor, ask; otherwise apply. **The floor is not specified here** — it is set from the
Phase 0 baseline, by picking the value that separates the wrong-song case from a merely
messy fit on the `composite` perturbation. Guessing it before measuring would be exactly
the kind of unmeasured constant this design is trying to remove.

**The flag** is a dotted underline, not a colour or dim treatment, because
`ColoredTranslation` (`src/lyrics/LyricDisplay.tsx:216`) already colours translation words
by token alignment for hover-matching, and a colour-based flag would fight a signal that
already carries meaning. It must also read as distinct from the existing `needs_review`
*timing* flag.

**Repair is in-context and offers candidates, not a text box.** Embeddings are already
computed and cached, so scoring a flagged row against translation lines in a small window
around its assignment, plus the unplaced lines, costs nothing and yields "it chose this; the
next best were these." A full k-best traceback would be nicer and is not worth it.

**Unplaced lines** get one quiet line of text, not a modal, opening them positioned by
`afterLineIndex`.

**`AlignmentEditor` survives as the escape hatch** for a broadly-wrong fit, but it currently
hangs off the confirm screen being deleted, so it is re-homed under Edit mode's More menu.

**Progress.** The overlay shows a single hardcoded step
(`src/lyrics/SecondLanguagePanel.tsx:122`) while, on a first attach, silently downloading
multilingual MiniLM behind it. `embedTexts` already accepts an `onProgress`
(`src/ai-pipeline/textEmbedder.ts:21`) that `autoAlignLines` never forwards. Thread it, and
say when a model is downloading.

**Re-fit on primary change.** Auto-align and gap re-scan can change line boundaries after a
translation is attached, staling the pairing. With `translationSource` retained this is a
re-fit, not a re-paste. Automatic when line count or text changed, since a stale pairing is
strictly wrong and re-fitting costs one cached embedding pass.

## Phasing

| Phase | Content | User-visible | Exit gate |
| --- | --- | --- | --- |
| 0 | Harness, metric, baseline. No production code. | no | baseline committed |
| 1 | Model fields, `translationSource`, extras threading, confidence emission | no | `lines_lost` = 0; `pair_*` unmoved |
| 2 | `G` move + skip penalty (one change) | no | `line_correct` up, `line_wrong` down vs Phase 0 |
| 3 | Translation-side header / title / credit detection | no | the four noise perturbations improve |
| 4 | Optimistic apply, flags, in-context repair, progress, re-homed editor, re-fit | **yes** | the go/no-go below |

Each phase ships and is measured independently.

## Testing

- **New:** the Phase 0 harness and ratchet.
- **Control:** `tests/ai-pipeline/corpus-pairing.test.ts` must come out **byte-identical** —
  no groups form on 1:1 input. If `pair_unpaired` / `pair_magnet` / `pair_wrong` move, the
  change hurt the clean case and Phase 2 stops.
- **Unit, TDD.** The load-bearing cases are the negative ones: a short translation must not
  swallow two long originals; `D+U` must beat `G` when blanking is the better reading; a
  diverged-count song must stop collapsing into long unpaired runs; `translationGroup`
  absent must round-trip as today's behavior.
- **Reality check.** `tests/lyrics/akfg-user-paste.test.ts` is a real messy user paste with a
  count mismatch. If the harness says a change helped but that paste gets worse, the
  perturbation set is wrong, not the paste.
- **Caveat.** This suite is load-sensitive; a failure must be re-run in isolation before
  being called a regression.

## Go/no-go on Phase 4

Phase 4 rests entirely on the flag being trustworthy. If `flag_precision` / `flag_recall`
come out poor, then "apply and flag the shaky rows" is a **dishonest interface** — telling
the user which rows to trust on a signal that does not know.

In that case Phase 4 does **not** ship as designed. The fallback is the gated variant:
apply silently when the fit is clean; when it is not, show only the uncertain rows and the
unplaced lines — not all of them — and resolve before attaching.

## What this will not tell us

Three songs, JA-to-EN only, synthetic perturbations. It says nothing about other language
pairs, very long tracks, or a translation made from a genuinely different source text (a
cover, an alternate version). The metric is narrower than the feature.

## Deferred

- **Stanza structure for timed primaries** (`src/lyrics/lineAligner.ts:934`). The fixture
  `.txt` files contain zero blank lines, so stanza structure is not in them at all and the
  `stanza-regroup` perturbation would have to be built on invented structure — which is how
  a change gets fitted to its own test. Deferred until JA stanza boundaries can be derived
  from the timing fixtures.
- Collapsing the five-route cascade into one confidence-scored alignment. The critique is
  fair — the proportional time-spread fallback (`src/lyrics/bilingual.ts:233`) abandons
  content matching entirely and spreads lines by character count — but with the Phase 0
  instrument in hand, this becomes a decision with evidence rather than a guess.
- Grouping the `SungPhrase` layer.
- `parseLRCPair` (`src/lyrics/lrc-parser.ts:64`) is a working two-file bilingual LRC merge
  with zero production callers.
- Bilingual export. `exporter.ts` takes `field: 'original' | 'translation'` but both call
  sites use the default.
- `LyricsData.translationLanguage` is written by four call sites and read by none; the
  second language is always hardcoded as the opposite of `sourceLanguage`.

## Alternatives considered

- **On-device machine translation.** Fully automatic for every song, and it dissolves the
  fitting problem entirely, since a translation you generate yourself is 1:1 by construction.
  Rejected for this round: a third model download on a stack already asking for 240MB +
  65MB, and for a language-learning app a mediocre gloss may be worse than none.
- **Auto-fetch from LRCLIB.** Rejected on measurement — 0 of 131 entries were a translation.
- **Scraping Animelyrics / LyricsTranslate.** Best quality and fully automatic, but no API,
  fragile HTML parsing, requires a CORS proxy that breaks the all-on-device model, and
  carries real terms-of-service exposure.
- **Anchor-and-fill**, mirroring the audio aligner's consensus-anchor architecture.
  Structurally immune to the cascade failures a global DP shows on long inputs, but there is
  no evidence yet that a 40x60 text DP actually cascades. Revisit if Phase 0 shows it does.
