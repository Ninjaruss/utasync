# Tap-to-Look-Up Word Popover — Design

**Date:** 2026-07-11
**Status:** Approved

## Problem

Desktop users can hover-scan Utasync lyrics with the Yomitan browser extension (the lyric text already carries `yomitan-text select-text` classes and `lang="ja"`). Mobile users have no equivalent: Yomitan is unavailable on iOS Safari and awkward on most mobile browsers. Yomitan has no plugin API a website can hook into, so an integrated experience must be built in-app.

## Decision summary

- **Built-in dictionary popup**, not external-app handoff or mobile-extension docs.
- **Compact depth:** headword, kana reading, part of speech, top JMdict glosses, plus a jisho.org link for depth.
- **Scope:** main lyric display only (token-rendered lines). Cloze overlay, tap-sync editor, and alignment views are out of scope for v1.
- **Available on all platforms**, gated by a settings toggle ("Tap to look up words", default on) so desktop Yomitan users can disable it.
- **Playback keeps playing** while the popup is open.

## What exists today

- Lyric lines render as per-token `<span>`s in `ColoredTokens` (`src/lyrics/LyricDisplay.tsx`) with hover handlers already wired — per-word tap targets are essentially free.
- `tokenizeJapanese` (`src/language/japanese/tokenizer.ts`) produces `Token { surface, reading, pos, posDetail1, startIndex, endIndex }` from kuromoji, but does **not** capture kuromoji's `basic_form` (dictionary/lemma form), which lookups need (泣いた → 泣く).
- A condensed JMdict gloss map already ships and lazy-loads in the browser (`src/ai-pipeline/jmdictGloss.ts`: `romaji` and `kanji` keyed maps, one gloss string per entry), with curated overrides in `lyricGloss.ts`.
- `TimestampPopover` (`src/lyrics/TimestampPopover.tsx`) is the existing anchored-popover pattern to follow.

## Design

### Data

- `Token` gains `baseForm?: string`, set in `tokenizeJapanese` from kuromoji's `basic_form` when it is present and not `*`.
- New module `src/language/japanese/wordLookup.ts`:

  ```ts
  interface WordLookupResult {
    headword: string      // baseForm if available, else surface
    reading: string | null
    pos: string
    glosses: string[]     // may be empty
  }
  function lookupWord(token: Token): Promise<WordLookupResult | null>
  ```

  Lookup chain: curated `lyricGloss` entries first, then the `jmdictGloss` kanji map keyed by `baseForm`, falling back to `surface`. Returns `null` only for pure punctuation/symbols; words with no dictionary entry still return a result (reading + POS, empty glosses) so the popup can show the reading.

### UI

- New component `WordLookupPopover` (in `src/lyrics/`), pattern-matched to `TimestampPopover`.
- On wide viewports: anchored popover next to the tapped token span.
- On narrow viewports: a small fixed bottom card instead, so it never fights with thumb position or covers the tapped line.
- Content: headword (with reading as ruby or beside it), POS tag, glosses, and a "jisho.org ↗" external link (`https://jisho.org/search/<headword>`).
- Dismissal: outside tap or tapping another word (which replaces the content). It is **not** auto-dismissed by scroll or by the active line changing; playback continues.

### Wiring

- `ColoredTokens` spans get an `onClick`/tap handler that calls `lookupWord` and opens the popover, gated by a new `tapLookupEnabled` setting (default `true`) in the existing settings module, surfaced as "Tap to look up words".
- Yomitan compatibility is untouched: `yomitan-text` classes and selectable text remain; the click handler does not interfere with hover-scan.
- Lines rendered via the plain-text/furigana-HTML path (no tokens) have no tap targets in v1.

### Error handling

- `jmdict-gloss.json` fetch failure (already handled as `null` in `jmdictGloss.ts`): popup shows reading/POS with a "definitions unavailable" note and the jisho.org link.
- Lookup is async; show the popover immediately with the surface/reading and fill glosses when resolved (the gloss map load is one-time).

### Testing

- Unit tests for `lookupWord`: lemma-first fallback chain (baseForm hit, surface fallback, curated override wins), missing entries, kana-only words, punctuation → null.
- Unit test that `tokenizeJapanese` populates `baseForm` for conjugated forms.
- Component test for `WordLookupPopover`: opens on token tap, replaces content on second tap, dismisses on outside tap, hidden when `tapLookupEnabled` is off.

## Alternatives considered

1. **Full JMdict lookup engine** (IndexedDB import + deinflection table, Yomitan-style): much richer entries, works on arbitrary text, but a multi-week subsystem duplicating Yomitan on desktop. Can be layered behind the same popover later if the condensed glosses feel thin.
2. **External dictionary handoff** (jisho links / app deep links): zero UI to build but inconsistent across platforms; kept only as the "more" link inside the popup.
3. **Selection-based lookup:** flexible but mobile text selection is the clunky experience this feature exists to avoid.
