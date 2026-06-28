# Content-based sung-reading alignment — design

Date: 2026-06-27
Status: Approved (pre-implementation)

## Problem

Furigana over kanji can show either the **dictionary reading** (kuromoji, derived from
the user's correct lyrics — always accurate) or a **sung reading** detected from the
Whisper transcript (intended to catch deliberate non-standard readings, e.g. 術 sung
as すべ). The sung-reading path is unreliable.

Validation over the AKFG First Take transcripts (word + segment caches) showed:

- **Segment mode:** 0 adopted, 0 flagged — everything suppressed, catches nothing.
- **Word mode:** 5 sung readings adopted, **all garbage, 0 real**:
  逸れ→レタ, 術→ニス, 嗚呼→ナア, 心→ミモ, 絡まっ→ッテル.

The most telling case is 術. The lyric 術 is genuinely sung **すべ**, and Whisper
*correctly transcribed* すべ (`そんな僕にすべはないよな`). Yet the reconciler adopted
**ニス** — it stitched `に`+`す` across a word boundary — and missed the real reading
that was present in the transcript.

### Root cause

`reconcileTokenReadings` estimates each token's audio window by **proportionally
dividing the line's duration by mora-weight**, not from the real transcript word
timestamps or content. Even when Whisper's text and timing are accurate, the estimated
window is offset from where the sung kana actually sit, so kana extraction straddles
neighbouring words. Every prior fix (車→なは, 戦争, 理由, the owned-word gate) patched a
symptom of this proportional-window fragility; garbage keeps resurfacing elsewhere.

## Goal

Replace proportional-time token windows with **content-based alignment**: align the
line's expected reading-kana against the transcript kana, let the matching kana
(particles, okurigana, kana words) anchor the frame, and read each kanji token's sung
reading out of the correctly-bracketed gap.

Acceptance: catch 術→すべ; produce **0 garbage adoptions** on the AKFG fixtures; keep all
existing reading tests passing. When evidence is not trustworthy, fall back to the
**neutral** dictionary reading with no flag — never to the old proportional guess.

## Non-goals

- Improving the Whisper transcription itself (out of scope; client-side whisper-small).
- Changing the display layer, the async kanji-substitution pass, or line timing.
- Changing the `Token` reading flags or their meaning.

## Architecture

New pure module **`src/ai-pipeline/readingAlignment.ts`** holding the Needleman–Wunsch
aligner and the per-token reading resolver. `reconcileTokenReadings`
(`src/ai-pipeline/readingReconciler.ts`) keeps its exact signature and `Token` output
flags (`audioReading`, `readingVerified`, `readingMismatch`, `readingConfidence`); it
delegates the per-token decision to the new module. Keeping the aligner in its own file
prevents `readingReconciler.ts` from growing further.

The existing helpers `wordsInLineWindow`, `normalizeKanaForCompare`, `katakanaToHiragana`,
`hasKanji`, `transcriptKanjiCovers`, `readingsEquivalent`, and `HIGH_READING_CONFIDENCE`
are reused.

## Data flow (per line)

1. **Build `A` (expected kana)** — concatenate each token's dictionary reading in
   hiragana. Kana-only tokens contribute their own kana; punctuation/symbol tokens
   contribute nothing. Keep a parallel `tokenIndex[]` mapping each kana position in `A`
   back to its source token.
2. **Build `B` (sung kana)** — `normalizeKanaForCompare` over the joined transcript text
   from `wordsInLineWindow`. Transcript kanji are dropped from `B`; they are handled by
   the existing "Whisper wrote the kanji" guard.
3. **Align `A`↔`B`** with Needleman–Wunsch (global alignment). Scoring: match positive,
   mismatch and gap negative, tuned so matching kana dominate. Produce, for each position
   in `A`, the `B` index it aligns to (or a gap marker).
4. **Resolve each token** from the `B` span its `A`-range aligns to.

## Per-token decision rules

For a kanji token with hiragana reading `R` and aligned `B` span `S`:

1. Transcript window contains the token's kanji run → **verified** (dictionary), conf 1.
2. ≥60% of `R`'s kana matched exactly in alignment → **verified** (dictionary confirmed),
   conf scaled by match ratio.
3. `S` is **bracketed by matched-anchor kana on both sides** (or line edge), `|S|` ≥ 2
   morae, `S` is clean (contiguous, no large indel), and `S` differs from `R`, AND the
   adoption confidence ≥ `HIGH_READING_CONFIDENCE` → **adopt** `S` as `audioReading`.
4. Bracketed by anchors but `S` not clean/confident enough → **amber** `readingMismatch`,
   mid confidence.
5. Otherwise → **neutral**: dictionary reading, no flag.

The "bracketed by anchors" requirement is the precision lever: a span is trusted only
when the kana immediately before and after it matched. For 術 (`…に ▢ は…`, both
brackets anchors) → `▢ = すべ` trusted. For 逸れ inside the misheard `大勢れた` region →
brackets are not clean anchors → rejected.

## Confidence gates

- **Global precondition:** `lineAnchorScore` = exact-matched kana across the line ÷
  `|A|`. Below ~0.4 the transcript does not correspond to this line → **all tokens
  neutral**. Kills wholesale-misaligned lines (e.g. 嗚呼→ナア, line score ≈ 0).
- **verified** → `readingVerified: true`, `readingConfidence` scaled by match ratio.
- **adopt** → `audioReading: S`, `readingConfidence` = blend of bracket tightness and
  `lineAnchorScore`, emitted only when ≥ `HIGH_READING_CONFIDENCE` (0.8).
- **amber** → `readingMismatch: true`, mid confidence.
- **neutral** → no flags.

Thresholds (match/gap scores, 0.6 verify ratio, 0.4 line floor, bracket definition) are
tuned empirically during TDD to satisfy the acceptance set below.

## Testing

TDD each case (failing test → watch fail → implement). Existing 26 reconciler tests and
the reading-display/phrase-enrichment suites must stay green.

Acceptance set:

1. 術「ジュツ」 in `そんな僕に術はないよな`, transcript `…僕にすべはない…` → **adopts すべ**.
2. The 5 validated garbage cases → neutral or verified, **never adopted**; 術 must not
   become ニス.
3. Misaligned line (`lineAnchorScore` ≈ 0) → all tokens neutral.
4. 理由「リユウ」 with a clean aligned わけ bracketed by anchors → adopts わけ.
5. Whisper spelled the kanji (車 written as 車) → verified dictionary, never adopts
   okurigana.
6. Fully-matching transcript (戦争 ↔ せんそう) → verified, conf 1.

**Throwaway validation harness** (not committed): re-run the full align+reconcile over
the AKFG word + segment caches; confirm 術→すべ is caught and **0 garbage adoptions**
(down from 5), directly comparable to the pre-change measurement.

## Risks

- Over-tight anchoring could drop genuine alternates whose neighbours Whisper also
  misheard. Acceptable under the user's high-precision choice (neutral beats wrong).
- Needleman–Wunsch is O(|A|·|B|) per line; lyric lines are short, so cost is negligible.
