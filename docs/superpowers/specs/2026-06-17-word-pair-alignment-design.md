# Word-pair color coding between original and translation lyrics

Date: 2026-06-17

## Problem

`LyricDisplay` already shows original and translated lyrics side by side
(or stacked), but gives no visual link between a word in one language and
its counterpart in the other. A learner has to manually puzzle out which
Japanese word corresponds to which English word in the translation. The
app already has unused scaffolding for this — `Token.alignmentIndices` and
`LyricsData.alignment?: WordAlignment[]` exist in the type system
([core/types/index.ts:28](src/core/types/index.ts:28),
[core/types/index.ts:59-63](src/core/types/index.ts:59)) — but nothing
computes or renders it.

Separately, Japanese grammatical particles (が/は/を/に/で/と/も, etc.) have
no translation counterpart at all, so they'd always show as "unmatched" —
but they're worth marking on their own as a distinct learnable category.

## Goals / Non-goals

**Goals:** compute and persist word-level alignment between a line's
original and translated text using an on-device model; render matched
pairs with consistent per-pair colors in Side-by-side layout; render
particles with a single fixed category color, independent of whether they
match anything.

**Non-goals:** no karaoke-style highlight-as-spoken animation (would
require persisting Whisper's per-word timestamps onto lines, which today
are discarded after line-level alignment — out of scope for this round).
No remote/LLM-based alignment (on-device only, see trade-off discussion
below). No change to `WordAlignment.tsx`'s existing grammar-annotation
tooltip behavior beyond adding the new coloring alongside it.

## Why on-device, not dictionary or LLM

Three approaches were considered:

- **Dictionary lookup (JMdict-style gloss matching):** fully on-device, no
  model download, works on every device tier — but fails exactly on the
  cases that make song lyrics hard: non-literal/poetic translations where
  a word's gloss doesn't textually match the translation's wording (e.g.
  長い "long" translated as "endless" — no dictionary entry connects them).
- **LLM-based (translate + align in one structured-output call):**
  produces the best quality by far (this is very likely how polished
  "color-coded caption" videos do it — ASR for word timing, LLM for
  translation + alignment) — but requires a remote API call per song,
  ongoing cost, a connectivity requirement, and a privacy/architecture
  shift for an app that's on-device-first everywhere else (Whisper,
  Demucs, tokenizers all run locally).
- **On-device embedding-based alignment (chosen):** a small multilingual
  embedding model run locally via `transformers.js` (same pattern as the
  existing Whisper/Demucs workers), used SimAlign-style: embed each
  token, build a similarity matrix between source and target tokens,
  extract pairs via greedy best-match above a similarity threshold.
  Meaningfully better than dictionary lookup on non-literal translations
  (catches "long"↔"endless"-style synonym pairs via semantic similarity,
  not exact gloss text), while staying fully local. Trade-off: same
  device-tier gating as Auto-Align — `manual`-tier devices don't get this
  feature, same as they don't get Auto-Align today.

---

## 1. Alignment computation (`src/ai-pipeline/wordAligner.ts`, new)

- Reuses existing tokenizers (`tokenizeJapanese`/`tokenizeEnglish`) for
  token boundaries — no new tokenization work.
- Loads a small multilingual embedding model via `transformers.js`
  (candidate: a quantized multilingual sentence-embedding model such as
  `Xenova/paraphrase-multilingual-MiniLM-L12-v2`; exact model validated
  during implementation against the existing worker-loading pattern used
  by `whisper.worker.ts`/`demucs.worker.ts`).
- For each line: embed every source token and every target word
  (mean-pooled subword embeddings per token), build a cosine-similarity
  matrix, extract pairs via greedy best-match (highest similarity first,
  each token/word consumed at most once) above a minimum similarity
  threshold (exact value tuned during implementation/testing, same
  approach as the stanza-gap threshold in the UI-cleanup spec). Tokens
  below threshold are left unmatched — no forced/wrong pairing.
- **Particles excluded from matching:** any source token whose kuromoji
  `pos` indicates a particle (助詞) is skipped in the similarity matching
  entirely — it never consumes a target word and is never reported as
  "matched" or "unmatched" through the normal pairing path (see §3 for its
  separate rendering treatment).
- Runs gated to `getDeviceTier() !== 'manual'`, same capability gate as
  `AutoAlignFlow`.

## 2. Storage

No schema change — fills existing, previously-unused types:

- `LyricsData.alignment?: WordAlignment[]` stores one entry per matched
  pair: `{ sourceTokenIndices, targetWordIndices, lineIndex }`.
- Computed once per song as part of the existing `enrichLines` pass in
  `PlayerView.tsx` (alongside tokens/reading/grammar annotations), on
  `full`/`lite` tier devices only.
- **Invalidation:** `lineOps.ts`'s `setText` currently clears
  `reading`/`furigana`/`tokens`/`grammarAnnotations` only when `original`
  changes. Extend it to also clear that line's alignment entries when
  either `original` **or** `translation` changes (alignment depends on
  both sides, unlike the other derived fields).

## 3. Display (`LyricDisplay.tsx`, `WordAlignment.tsx`)

- Active automatically whenever Side-by-side layout is on and the line
  `hasVisibleTranslation` (no separate toggle, per earlier decision).
- Each matched pair gets a color from a fixed ~6–8 color palette, cycling
  per line by pair order; applied as a subtle background/underline on
  both the source token span and its translation word span.
- **Particles** render with one single fixed, muted color reserved
  exclusively for them — visually distinct from the cycling match
  palette, so it reads as "grammatical particle" rather than "paired with
  something." This applies only in the same Side-by-side + has-translation
  condition as the rest of this feature (not shown in stacked layout).
- Unmatched non-particle tokens render plain — no color, no underline.
- `manual`-tier devices and stacked layout: no coloring of any kind: same
  appearance as today.

---

## Files touched

- `src/ai-pipeline/wordAligner.ts` — **new**, embedding + greedy-match
  alignment logic (1).
- `src/player/PlayerView.tsx` — call the aligner inside `enrichLines`,
  gated by device tier (1, 2).
- `src/lyrics/lineOps.ts` — extend `setText`'s invalidation to clear
  alignment on `original`/`translation` change (2).
- `src/lyrics/LyricDisplay.tsx` / `src/language/WordAlignment.tsx` —
  render matched-pair colors and the particle color in Side-by-side mode
  (3).
- `src/core/types/index.ts` — no change (existing `WordAlignment`/
  `alignmentIndices` types finally get used).

## Testing

- `wordAligner.test`: synthetic token/embedding fixtures verifying
  greedy best-match pairing, threshold cutoff (low-similarity pairs stay
  unmatched), particles excluded from matching entirely.
- `lineOps.test`: `setText` clears alignment entries on `original` change
  and on `translation` change.
- `LyricDisplay.test` / `WordAlignment.test`: matched pairs render with
  consistent colors across the source/target spans; particles render
  with the fixed particle color regardless of match state; stacked
  layout and lines without a visible translation show no coloring.
- Manual/integration check: `manual`-tier device simulation shows no
  alignment computed and no coloring rendered, consistent with
  `AutoAlignFlow`'s existing tier gating.

## Risks / edge cases

- **Model load cost** — same first-run download/caching consideration as
  Whisper/Demucs; should follow the same "loading AI model (first run
  only)" UX pattern already established in `AutoAlignFlow.tsx`.
- **Similarity threshold tuning** — too low produces wrong/noisy pairings
  (worse than no pairing); too high leaves real matches uncolored. Tuned
  empirically during implementation against real lyric lines, not preset
  here.
- **Greedy matching is not globally optimal** — a token's best match may
  get "stolen" by an earlier, slightly-better match for a different
  token, leaving a worse leftover pairing. Acceptable for a learning aid
  (not a translation engine); revisit only if it produces visibly wrong
  results often in practice.
- **Re-enrichment cost** — alignment runs alongside the existing
  tokenize/reading/grammar enrichment pass, so it adds to (rather than
  duplicates) an already-async, already-tier-gated pipeline.
