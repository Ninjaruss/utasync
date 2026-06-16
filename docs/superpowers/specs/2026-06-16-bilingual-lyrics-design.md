# Bilingual Lyrics: Second-Language Fetch, Paste & Side-by-Side Display

Date: 2026-06-16

## Goal

Let a learner study Japanese songs with the original Japanese as the primary
line and a reference language (usually English) shown alongside. Support three
ways to obtain the second language, furigana over kanji, and a side-by-side
layout. Connect existing-but-orphaned translation scaffolding to the UI.

Japanese is **always the primary line**; the other language is the reference.

## What already exists (and is reused)

- `TimedLine.translation` — the second-language text per line. Stored, but only
  rendered as small italic text under the *active* line.
- `parseLRCPair(originalLRC, translationLRC)` in `lrc-parser.ts` — merges two LRC
  strings into dual-language timed lines. **Currently never called.**
- `AlignmentEditor.tsx` — manual original↔translation pairing UI. Only reachable
  today on a link import when line counts mismatch (which never happens).
- `toFurigana(text)` in `japanese/phonetics.ts` — returns kuroshiro `<ruby>` HTML.
  **Currently never called.**
- `phoneticMode` / `clozeMode` in `LyricsStore` — **no UI reads them.**

## Out of scope

- Machine translation (explicitly declined). No external translation service.

## Design

### 1. Display state — `LyricsStore`

Replace the unused `phoneticMode` with explicit, UI-backed prefs (all persisted):

- `furiganaMode: 'none' | 'romaji' | 'furigana'` — how Japanese readings show.
  - `none`: kanji only.
  - `romaji`: spaced hepburn romaji under the line (existing `reading`).
  - `furigana`: ruby readings above kanji (existing `toFurigana`).
- `showTranslation: boolean` — show the reference language on **every** line, not
  just the active one. Default `true`.
- `lyricsLayout: 'stacked' | 'sideBySide'` — `stacked` = reference under the
  Japanese; `sideBySide` = two columns (Japanese | reference). Default `stacked`.

`clozeMode` is left as-is (not in scope here).

### 2. Enrichment — `PlayerView.enrichLines`

Currently computes `reading` (romaji) per Japanese line. Add `furigana` (ruby
HTML from `toFurigana`) alongside `reading`, stored on `TimedLine` as a new
optional `furigana?: string`. Both are precomputed once on load so the display
toggle is instant and offline.

### 3. Display — `LyricDisplay` + options bar

A compact toggle bar lives in `PlayerView` (in the controls block, `shrink-0`):

`［あ Reading: none/romaji/furigana］ ［文 Translation］ ［⇄ Side-by-side］`

- `LyricDisplay` reads the new store flags.
- **Reading**: `none` → plain; `romaji` → small romaji line under original
  (active line keeps the larger treatment); `furigana` → render `line.furigana`
  via `dangerouslySetInnerHTML` inside a `.font-jp` ruby container with `<rt>`
  styled smaller/dimmer. Falls back to plain `original` when furigana is absent.
- **Translation**: when `showTranslation`, render `line.translation` for every
  line (dimmer than active), reusing the existing white-opacity dim styling.
- **Side-by-side**: each row becomes a 2-col grid — left = Japanese (primary,
  emphasized when active), right = reference (dimmer). Reading mode still applies
  to the left column. On very narrow widths it falls back to stacked via a
  `min-w` threshold (Tailwind responsive: `sm:grid-cols-2` else stacked).
- Active-line highlight, click-to-seek, and auto-scroll-to-center are unchanged
  and apply to the whole row.

Furigana HTML is sanitized by construction: it only ever comes from kuroshiro's
`toFurigana`, which emits a fixed `<ruby>/<rt>/<rp>` structure over our own text.

### 4. Ingestion — three paths, one `translation` field

A shared helper `attachSecondLanguage(primaryLines, secondaryText|secondaryLRC)`
in a new `lyrics/bilingual.ts`:
- If both sides are synced LRC → `parseLRCPair` (timestamp aligned).
- Else if line counts match → pair by index onto `primaryLines[i].translation`.
- Else → return a signal to open `AlignmentEditor`, then apply confirmed pairs.

`detectLanguage(text): 'ja' | 'other'` in `lyrics/bilingual.ts` — Japanese if the
text contains Han/Hiragana/Katakana (regex `/[぀-ヿ㐀-鿿]/`).
Used to guarantee the Japanese block becomes `original` and the other becomes
`translation`, regardless of paste order, and to decide which language to
auto-fetch as the opposite.

**Path A — Auto from LRCLIB** (`lrclib.ts: findSecondLanguageLyrics`):
After primary lyrics load, run `searchLRCLIB` again and pick the first result
whose lyric script *differs* from the primary (detected via `detectLanguage`),
preferring synced. Feed into `attachSecondLanguage`. Best-effort: many songs have
no alternate-language entry; on miss we do nothing and rely on manual paste.

**Path B — Manual paste** (`UploadAudioFlow` + `LinkParser`):
Add a "Second language lyrics (optional)" textarea. On submit, `detectLanguage`
assigns sides, then `attachSecondLanguage`.

**Path C — Auto-detect pasted language** (`UploadAudioFlow` paste source):
When the user pastes the *primary* lyrics and they're detected Japanese, offer to
auto-fetch the opposite language from LRCLIB (Path A) before continuing.

`buildSong` sets `sourceLanguage` from `detectLanguage(primary)` and
`translationLanguage` to the other, instead of hardcoding `ja`/`en`.

## Components & boundaries

- `lyrics/bilingual.ts` (new): `detectLanguage`, `attachSecondLanguage`. Pure,
  unit-tested, no React.
- `lrclib.ts`: add `findSecondLanguageLyrics` (network, best-effort).
- `LyricsStore.ts`: new display flags.
- `LyricDisplay.tsx`: rendering of reading modes, translation, side-by-side.
- `PlayerView.tsx`: options bar + furigana enrichment.
- `UploadAudioFlow.tsx` / `LinkParser.tsx`: second-language input + wiring.
- Reuse unchanged: `parseLRCPair`, `AlignmentEditor`, `toFurigana`, `toRomaji`.

## Testing

- `bilingual.test.ts`: `detectLanguage` (ja/en/mixed), `attachSecondLanguage`
  (synced-pair, index-pair, mismatch→signal).
- `lrclib` second-language selection (mock fetch, picks differing script).
- Browser: verify furigana ruby renders, translation on all lines, side-by-side
  two columns, toggles flip live. Use the `my-eyes-only` fixture / a JP song.

## Limitations (surfaced in UI, not hidden)

- LRCLIB rarely stores a separate translation entry, so Path A succeeds mainly
  for songs with a romaji or alternate-language upload. Manual paste is the
  reliable fallback; the UI states this when auto-fetch finds nothing.
