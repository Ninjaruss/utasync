# Edit-mode second language, dedup display, tap-safe timing, A/B by line, upload autofill

Date: 2026-06-16

## Problem

Five gaps in the song editor / upload flow:

1. **No way to add a second language while editing a song.** Second-language
   lyrics can only be attached at song-creation time (`LinkParser`,
   `UploadAudioFlow`). An existing song with only the primary language is stuck.
2. **Duplicate lines are shown.** `LyricDisplay` renders `original`, `reading`
   (romaji), and `translation` independently. For an English song the romaji and
   the translation are just the English text again, so the same line appears two
   or three times.
3. **Tapping a lyric overwrites its timing.** In `EditMode` the entire lyric row
   is a button that calls `stampStart(..., playhead())`. A single tap meant to
   select/inspect a line silently overwrites its start time.
4. **A/B loop can only be set from the live playhead.** No way to anchor A or B
   to a specific lyric line.
5. **Upload autofill is incomplete.** Title preloads from tags → filename, but
   artist only fills from tags. Files named `Artist - Title.mp3` with no tags
   leave the artist blank.

## Goals / Non-goals

**Goals:** the five items above, each isolated and testable.

**Non-goals:** No changes to the song-creation flows beyond reusing their
helpers (`attachSecondLanguage`, `extractSecondLanguageLines`,
`findSecondLanguageLyrics`) and the small upload-autofill enhancement in item 5.
No redesign of `AlignmentEditor` internals (only how it's hosted).

---

## 1. Second language while editing

### Component: `SecondLanguagePanel`

New file `src/lyrics/SecondLanguagePanel.tsx`. Owns the find → fallback-paste →
align state machine. Rendered as an overlay/sheet over `EditMode` when opened.

**Props**
```ts
interface Props {
  lines: TimedLine[]            // current primary lines
  title: string
  artist: string
  sourceLanguage: Language      // 'ja' | 'en'
  onApply: (lines: TimedLine[]) => void  // routes through handleEditLines
  onClose: () => void
}
```

**State machine** (`phase`):
- `searching` — initial. Calls
  `findSecondLanguageLyrics(title, artist, sourceLanguage === 'ja' ? 'ja' : 'other')`.
  Shows a spinner.
- On result:
  - Run `attachSecondLanguage(lines, found.lrc)`.
  - If `needsAlignment` (count mismatch) → `phase = 'align'` (AlignmentEditor).
  - Else → `phase = 'confirm'`: attach the paired lines into a local preview and
    show a banner *"Found translation from LRCLIB — [Looks good] [Fix pairings]
    [Use different / paste]"*. This makes a false positive recoverable.
    - **Looks good** → `onApply(paired)`, close.
    - **Fix pairings** → `phase = 'align'` seeded with the found pairing.
    - **Use different / paste** → `phase = 'paste'`.
- On no result → `phase = 'paste'`.
- `paste` — textarea for plain text or LRC. Submit runs
  `attachSecondLanguage(lines, pasted)`; `needsAlignment` → `phase = 'align'`,
  else `phase = 'confirm'`.
- `align` — hosts `AlignmentEditor` (see hosting note). Confirm → build
  `TimedLine[]` by writing each pair's `translation` onto the matching primary
  line (preserving primary timing), then `onApply`, close.

**AlignmentEditor hosting.** `AlignmentEditor` is currently a full-screen view
(`min-h-screen`). Wrap its usage here in a modal container
(`fixed inset-0 z-50 overflow-y-auto`) so it overlays the editor instead of
replacing the app shell. No change to `AlignmentEditor.tsx` itself.

**Mapping aligned pairs back to TimedLine[].** `AlignmentEditor.onConfirm` yields
`Array<{ original, translation }>`. Reuse the existing convention: the confirmed
`original` list replaces line text and `translation` is attached by index,
matching how `LinkParser` consumes it (see `LinkParser.tsx` confirm handler).
Extract that mapping into a small pure helper
`pairsToTimedLines(existing: TimedLine[], pairs): TimedLine[]` in
`src/lyrics/bilingual.ts` so both `LinkParser` and `SecondLanguagePanel` share it
(and it gets a unit test). Preserve existing timing for matched-by-index lines.

### EditMode wiring

`EditMode` gains props `title`, `artist`, `sourceLanguage`, and renders a footer
button:
- `＋ 2nd language` when no line has a `translation`.
- `↻ Replace 2nd language` when at least one does.

Clicking opens `SecondLanguagePanel`. Its `onApply` calls the existing
`onChangeLines` (which in `PlayerView` is `handleEditLines` → persists +
re-enriches). `PlayerView` passes `song.title`, `song.artist`,
`song.lyrics.sourceLanguage` to `EditMode`.

---

## 2. Tap-safe timing in EditMode

Restructure the collapsed row in `EditMode.tsx`:

- **Left timestamp pill = the stamp button.** It shows the time (or `—`) and a
  `⏱` affordance, `aria-label="Set start to current time for line N"`, and calls
  `onChangeLines(stampStart(lines, i, playhead()))`. Visually a button (border /
  active state) so it reads as tappable.
- **Lyric text = open editor.** The text region becomes the button that calls
  `setExpanded(i)` (same as the current `✎`). The `✎` button may remain as a
  redundant affordance or be removed; keep it for discoverability.

Net effect: the large tap target no longer stamps — accidental overwrites are
impossible — while one-tap manual stamping is still available via the pill.

No logic changes to `lineOps` or `LineEditor`.

---

## 3. Hide duplicate lines

Add a pure helper to `src/lyrics/bilingual.ts`:
```ts
// Case- and whitespace-insensitive equality for redundant-line suppression.
export function isSameText(a: string | undefined, b: string | undefined): boolean
```
Normalizes with `trim().toLowerCase()` and collapsed internal whitespace;
returns false if either side is empty.

In `LyricDisplay.tsx`:
- **Romaji:** in `PrimaryText`, render the `reading` block only when
  `furiganaMode === 'romaji' && line.reading && !isSameText(line.reading, line.original)`.
- **Translation:** in `Line`, treat translation as absent for display when
  `isSameText(line.translation, line.original)` — i.e. fold the check into
  `hasTranslation`.

Unit-test `isSameText` (identical, case/space variants, empty, distinct).

---

## 4. A/B from a specific lyric line

**Store.** `PlayerStore` gains:
```ts
armingAB: 'a' | 'b' | null
armAB: (which: 'a' | 'b' | null) => void
```
`setABLoop` clears `armingAB` after a successful set.

**A/B buttons (`PlayerView`).** Each A/B button gets long-press handling
(pointer-down timer ≈ 500 ms):
- **Tap** → existing behavior: `setABLoop({ a: position })` / `{ b: position }`.
- **Long-press** → `armAB('a')` / `armAB('b')`. Armed endpoint shows a pulsing
  border (e.g. `animate-pulse`) and the row shows a hint *"Tap a lyric line to
  set A/B"*. Pressing again or tapping Clear disarms.

**Line click routing.** `LyricDisplay`'s line `onClick` already calls
`onSeek(line.startTime)`. Rename the prop path so `PlayerView` decides:
- Pass `onLineClick(line: TimedLine)` into `LyricDisplay` instead of bare
  `onSeek`. `LyricDisplay`/`Line` call `onLineClick(line)`.
- In `PlayerView`: if `armingAB` is set, `setABLoop({ [armingAB]: line.startTime })`
  (which clears arming); otherwise `seek(line.startTime)`.

Keep the change minimal: `LyricDisplay`'s `Props` switches from
`onSeek: (t) => void` to `onLineClick: (line: TimedLine) => void`.

---

## 5. Upload autofill: artist from filename

Files are commonly named `Artist - Title.ext`. Tags still take priority.

Add to `src/sources/audioMetadata.ts`:
```ts
// Splits "Artist - Title" (also " – " / " — "). Returns {} when no separator.
export function parseFilename(filename: string): { title?: string; artist?: string }
```
Strips the extension via `deriveTitle`, splits on the first ` - ` / en/em-dash
with surrounding spaces, trims both sides. No separator → `{ title: deriveTitle(...) }`.

In `UploadAudioFlow.handleFileChange`, compute a filename fallback and apply it
under the tags:
```ts
const meta = await extractAudioMetadata(f)
const fromName = parseFilename(f.name)
setTitle((cur) => cur || meta.title || fromName.title || deriveTitle(f.name))
setArtist((cur) => cur || meta.artist || fromName.artist || '')
```
Tags win; filename fills the gaps; artist now preloads for `Artist - Title.mp3`.

Unit-test `parseFilename` (dash, en-dash, em-dash, no separator, extension only,
extra dashes in title).

---

## Files touched

- `src/lyrics/SecondLanguagePanel.tsx` — **new**, item 1.
- `src/lyrics/bilingual.ts` — add `pairsToTimedLines` (1), `isSameText` (3).
- `src/lyrics/EditMode.tsx` — 2nd-language button + panel (1), tap-safe row (2).
- `src/lyrics/LyricDisplay.tsx` — dedup (3), `onLineClick` routing (4).
- `src/sources/LinkParser.tsx` — adopt shared `pairsToTimedLines` (1, refactor).
- `src/player/PlayerStore.ts` — `armingAB` / `armAB` (4).
- `src/player/PlayerView.tsx` — pass edit props (1), long-press A/B + line
  routing (4).
- `src/sources/audioMetadata.ts` — `parseFilename` (5).
- `src/sources/UploadAudioFlow.tsx` — filename fallback for artist (5).

## Testing

- `bilingual.test`: `isSameText`, `pairsToTimedLines`.
- `audioMetadata.test`: `parseFilename`.
- Component-level: `SecondLanguagePanel` phase transitions (found→confirm,
  found→align on mismatch, no-result→paste); `EditMode` row tap opens editor and
  pill stamps; `LyricDisplay` suppresses identical romaji/translation; A/B line
  routing sets endpoint when armed and seeks otherwise.

## Risks / edge cases

- **False-positive translation** — mitigated by the `confirm` banner (item 1).
- **Long-press vs scroll** — A/B long-press lives on the button, not the
  scrollable lyric list, so it won't fight scroll. Use a movement threshold to
  cancel the timer if the pointer drags.
- **`detectLanguage` returns `'other'`**, while `Song.sourceLanguage` is `'ja' |
  'en'` — map `'en' → 'other'` when calling `findSecondLanguageLyrics`, matching
  `UploadAudioFlow`.
