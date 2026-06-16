# Home Song Library & Media Metadata Auto-fill — Design

**Date:** 2026-06-15
**Status:** Approved (pending spec review)

## Problem

1. **No way to reach saved songs.** Songs are listed inside `SettingsView`'s
   "Song Library", but those rows can only export-LRC or delete — they cannot be
   opened/played. And `SettingsView` is only reachable from inside the player, so
   from the home screen there is no path to previously uploaded songs at all.
2. **Manual title/artist entry.** The "Upload audio" flow requires typing title
   and artist by hand even when the uploaded file already carries that metadata.

## Goals

- Surface saved songs on the home screen and let the user open one in the player.
- Auto-fill title and artist from the uploaded file's embedded metadata.

## Non-goals

- Making `SettingsView` reachable from the home screen (separate, known gap).
- Editing/renaming songs from the library.
- Search, sort options, or pagination of the library.

---

## Feature 1 — Saved songs on the home screen

### Entry point

Add a third segment to the existing `HomeScreen` toggle:

```
YouTube link | Upload audio | My Songs
```

`HomeScreen` mode type becomes `'youtube' | 'upload' | 'songs'`.

### Default tab

On mount, `HomeScreen` checks whether any songs exist (`db.songs.count()`):

- ≥ 1 song → default mode is `'songs'` (returning users land on their library).
- 0 songs → default mode is `'youtube'` (unchanged from today).

The default is resolved once asynchronously; until it resolves, render the
current default (`'youtube'`) to avoid a flash/empty state.

### New component: `SongLibrary`

Location: `src/sources/SongLibrary.tsx`

```ts
interface Props {
  onOpen: (songId: string) => void
}
```

Behavior:

- On mount, load songs newest-first:
  `db.songs.orderBy('createdAt').reverse().toArray()`.
- Render each song as a tappable card showing:
  - title
  - artist
  - an alignment hint derived from `linesAreTimed(song.lyrics.lines)`
    (`alignmentPolicy.ts`): "Aligned" when timed, "Tap-sync needed" otherwise.
- Tapping the card body calls `onOpen(song.id)`.
- Each card has a small **Delete** button (stops click propagation so it does not
  also open the song). Delete removes the song and updates local state.
- Empty state ("No songs yet") only appears if the component is shown with zero
  songs (unusual, since the tab defaults away when empty).

`HomeScreen` passes its existing `onSongReady` prop as `onOpen`, so opening a
saved song reuses the exact path a freshly created song already takes
(`App` sets `songId` + view `'player'`). No new navigation plumbing.

### Shared delete helper

`SettingsView.deleteSong` currently inlines: delete OPFS audio (if any) + delete
the DB row. Extract this into a shared helper so `SongLibrary` and `SettingsView`
use one implementation:

Location: `src/core/db/deleteSong.ts`

```ts
export async function deleteSong(song: Song): Promise<void> {
  if (song.audioStoredPath) await deleteAudio(song.id)
  await db.songs.delete(song.id)
}
```

`SettingsView` is refactored to call this helper (keeping its own local-state
update). No behavior change there.

---

## Feature 2 — Auto-fill title/artist from media metadata

### Dependency

Add `music-metadata` to `dependencies`. It is **lazy-imported** only when a file
is selected, so it does not affect initial page load.

### New helper: `extractAudioMetadata`

Location: `src/sources/audioMetadata.ts`

```ts
export interface AudioMetadata {
  title?: string
  artist?: string
}

export async function extractAudioMetadata(file: File): Promise<AudioMetadata>
```

Behavior:

- Dynamically `import('music-metadata')` and call its blob parser.
- Return `{ title, artist }` from the parsed common tags when present.
- On any parse error, return `{}` (non-fatal — auto-fill is best-effort).
- This helper does **not** apply the filename fallback; that is the caller's job
  (the helper only reports what the file's tags contain).

### Wiring in `UploadAudioFlow`

On file `onChange` (when a file is chosen):

1. Set the file state as today.
2. Call `extractAudioMetadata(file)`.
3. Fill **title** only if the current title field is empty:
   - use `metadata.title` if present, else the filename without its extension.
4. Fill **artist** only if the current artist field is empty and
   `metadata.artist` is present.

Never overwrite a non-empty field — typed input always wins. Re-selecting a
different file fills only the still-empty fields.

---

## Error handling

- Metadata parse failure: swallowed; fields fall back to filename (title) / stay
  blank (artist). No error surfaced to the user.
- Library DB read failure: render empty state. (Consistent with existing
  `SettingsView` behavior, which does not special-case read errors.)
- Delete failure: propagates as a rejected promise; local state only updates
  after the delete resolves (matches current `SettingsView` behavior).

## Testing

- `SongLibrary` (`tests/sources/SongLibrary.test.tsx`): seed `fake-indexeddb`
  with two songs, render, assert both titles appear and that clicking a card
  body calls `onOpen` with the right id; assert Delete removes the row.
- `extractAudioMetadata` (`tests/sources/audioMetadata.test.ts`): with
  `music-metadata` mocked, assert tag mapping; assert `{}` on thrown parse error.
- Filename-fallback logic lives in `UploadAudioFlow`; cover it via the helper's
  contract (helper returns no title → caller uses filename). A focused unit test
  on a small `deriveTitle(filename)` pure function (extension stripping) is
  included to keep the fallback testable without a DOM file input.

## Files touched

- `src/sources/HomeScreen.tsx` — add `'songs'` mode, third toggle, async default.
- `src/sources/SongLibrary.tsx` — new component.
- `src/sources/audioMetadata.ts` — new metadata helper (+ `deriveTitle`).
- `src/sources/UploadAudioFlow.tsx` — auto-fill on file select.
- `src/core/db/deleteSong.ts` — new shared delete helper.
- `src/settings/SettingsView.tsx` — use shared delete helper.
- `package.json` — add `music-metadata`.
- Tests as listed above.
