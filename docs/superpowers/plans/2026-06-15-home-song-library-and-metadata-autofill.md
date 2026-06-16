# Home Song Library & Media Metadata Auto-fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users open previously-uploaded songs from the home screen, and auto-fill title/artist from an uploaded audio file's embedded tags.

**Architecture:** Add a third "My Songs" tab to the existing `HomeScreen` toggle that renders a new `SongLibrary` list; tapping a song reuses the existing `onSongReady(songId)` path into the player. Extract a shared `deleteSong` DB helper used by both `SongLibrary` and `SettingsView`. Add a lazy-imported `music-metadata` helper that `UploadAudioFlow` calls on file select to prefill empty title/artist fields.

**Tech Stack:** React 19, TypeScript, Dexie (IndexedDB), Vitest + @testing-library/react + fake-indexeddb, music-metadata.

---

## File Structure

- `src/core/db/deleteSong.ts` — new: shared "delete a song (audio + row)" helper.
- `src/settings/SettingsView.tsx` — modify: use the shared helper.
- `src/sources/audioMetadata.ts` — new: `deriveTitle` + `extractAudioMetadata`.
- `src/sources/UploadAudioFlow.tsx` — modify: auto-fill on file select.
- `src/sources/SongLibrary.tsx` — new: home-screen song list.
- `src/sources/HomeScreen.tsx` — modify: add `'songs'` tab + async default.
- `package.json` — add `music-metadata` dependency.

---

## Task 1: Add the music-metadata dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

Run:
```bash
npm install music-metadata@^11.13.0
```
Expected: `package.json` gains `"music-metadata"` under `dependencies`; install completes without errors.

- [ ] **Step 2: Verify it resolves**

Run:
```bash
node -e "import('music-metadata').then(m => console.log(typeof m.parseBlob))"
```
Expected output: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add music-metadata for audio tag parsing"
```

---

## Task 2: Shared deleteSong DB helper

**Files:**
- Create: `src/core/db/deleteSong.ts`
- Test: `tests/core/db/deleteSong.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/db/deleteSong.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../../src/core/db/schema'
import { deleteSong } from '../../../src/core/db/deleteSong'
import type { Song } from '../../../src/core/types'

function makeSong(id: string): Song {
  return {
    id,
    title: `Title ${id}`,
    artist: 'Artist',
    lyrics: { lines: [], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' },
    createdAt: new Date(),
    isTrialSong: false,
  }
}

describe('deleteSong', () => {
  beforeEach(async () => { await db.songs.clear() })

  it('removes the song row from the database', async () => {
    const song = makeSong('a')
    await db.songs.put(song)
    expect(await db.songs.get('a')).toBeDefined()

    await deleteSong(song)

    expect(await db.songs.get('a')).toBeUndefined()
  })
})
```

Note: this song has no `audioStoredPath`, so the helper does not touch OPFS
(which is unavailable in jsdom).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/db/deleteSong.test.ts`
Expected: FAIL — cannot resolve `../../../src/core/db/deleteSong`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/db/deleteSong.ts`:
```ts
import { db } from './schema'
import { deleteAudio } from '../opfs/audio'
import type { Song } from '../types'

// Deletes a song: its stored audio file (if any) and its database row.
export async function deleteSong(song: Song): Promise<void> {
  if (song.audioStoredPath) await deleteAudio(song.id)
  await db.songs.delete(song.id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/db/deleteSong.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/db/deleteSong.ts tests/core/db/deleteSong.test.ts
git commit -m "feat: shared deleteSong helper"
```

---

## Task 3: Use the shared helper in SettingsView

**Files:**
- Modify: `src/settings/SettingsView.tsx`

- [ ] **Step 1: Replace the inline delete logic**

In `src/settings/SettingsView.tsx`:

Add the import near the other imports (below `import { deleteAudio } from '../core/opfs/audio'`):
```ts
import { deleteSong as removeSong } from '../core/db/deleteSong'
```

Replace the existing handler:
```ts
  const deleteSong = async (song: Song) => {
    if (song.audioStoredPath) await deleteAudio(song.id)
    await db.songs.delete(song.id)
    setSongs((prev) => prev.filter((s) => s.id !== song.id))
  }
```
with:
```ts
  const handleDelete = async (song: Song) => {
    await removeSong(song)
    setSongs((prev) => prev.filter((s) => s.id !== song.id))
  }
```

Update the button to call the renamed handler:
```ts
              <button onClick={() => handleDelete(song)} className="text-xs text-red-400 hover:text-red-300">
```

Then remove the now-unused imports `deleteAudio` and `db` **only if** they are no
longer referenced elsewhere in the file. (`db` is still used by the
`db.songs.toArray()` call in the effect, so keep `db`. `deleteAudio` is no longer
used — remove its import line `import { deleteAudio } from '../core/opfs/audio'`.)

- [ ] **Step 2: Verify lint + typecheck**

Run: `npx eslint src/settings/SettingsView.tsx && npx tsc -b`
Expected: no errors (no unused-var warnings for `deleteAudio`).

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/settings/SettingsView.tsx
git commit -m "refactor: SettingsView uses shared deleteSong helper"
```

---

## Task 4: Audio metadata helper

**Files:**
- Create: `src/sources/audioMetadata.ts`
- Test: `tests/sources/audioMetadata.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/sources/audioMetadata.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deriveTitle, extractAudioMetadata } from '../../src/sources/audioMetadata'

const parseBlob = vi.fn()
vi.mock('music-metadata', () => ({ parseBlob: (...args: unknown[]) => parseBlob(...args) }))

describe('deriveTitle', () => {
  it('strips a file extension', () => {
    expect(deriveTitle('My Song.mp3')).toBe('My Song')
  })
  it('keeps dotted names, dropping only the final extension', () => {
    expect(deriveTitle('a.b.flac')).toBe('a.b')
  })
  it('returns the name unchanged when there is no extension', () => {
    expect(deriveTitle('no extension')).toBe('no extension')
  })
})

describe('extractAudioMetadata', () => {
  beforeEach(() => parseBlob.mockReset())

  it('returns trimmed title and artist from common tags', async () => {
    parseBlob.mockResolvedValue({ common: { title: '  Tagged Title ', artist: 'Tagged Artist' } })
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    expect(await extractAudioMetadata(file)).toEqual({ title: 'Tagged Title', artist: 'Tagged Artist' })
  })

  it('omits fields that are absent', async () => {
    parseBlob.mockResolvedValue({ common: { title: 'Only Title' } })
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    expect(await extractAudioMetadata(file)).toEqual({ title: 'Only Title' })
  })

  it('returns an empty object when parsing throws', async () => {
    parseBlob.mockRejectedValue(new Error('bad file'))
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' })
    expect(await extractAudioMetadata(file)).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/audioMetadata.test.ts`
Expected: FAIL — cannot resolve `../../src/sources/audioMetadata`.

- [ ] **Step 3: Write minimal implementation**

Create `src/sources/audioMetadata.ts`:
```ts
export interface AudioMetadata {
  title?: string
  artist?: string
}

// Filename without its final extension, e.g. "My Song.mp3" -> "My Song".
export function deriveTitle(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return (dot > 0 ? filename.slice(0, dot) : filename).trim()
}

// Best-effort read of embedded title/artist tags. Lazily loads music-metadata
// so it never affects initial page load, and never throws — a parse failure
// yields {} and the caller falls back (e.g. to the filename).
export async function extractAudioMetadata(file: File): Promise<AudioMetadata> {
  try {
    const { parseBlob } = await import('music-metadata')
    const { common } = await parseBlob(file)
    const result: AudioMetadata = {}
    const title = common.title?.trim()
    const artist = common.artist?.trim()
    if (title) result.title = title
    if (artist) result.artist = artist
    return result
  } catch {
    return {}
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/audioMetadata.test.ts`
Expected: PASS (all 6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/sources/audioMetadata.ts tests/sources/audioMetadata.test.ts
git commit -m "feat: extractAudioMetadata + deriveTitle helpers"
```

---

## Task 5: Auto-fill title/artist in UploadAudioFlow

**Files:**
- Modify: `src/sources/UploadAudioFlow.tsx`
- Test: `tests/sources/UploadAudioFlow.test.tsx`

- [ ] **Step 1: Write the failing test**

Append these tests inside the existing `describe('UploadAudioFlow', ...)` block in
`tests/sources/UploadAudioFlow.test.tsx` (add the imports/mock at the top of the
file, after the existing `audioIngest` mock):

```ts
import { extractAudioMetadata } from '../../src/sources/audioMetadata'
vi.mock('../../src/sources/audioMetadata', async (orig) => {
  const actual = await orig<typeof import('../../src/sources/audioMetadata')>()
  return { ...actual, extractAudioMetadata: vi.fn() }
})
```

Then add the test cases:
```ts
  it('auto-fills empty title and artist from file tags', async () => {
    vi.mocked(extractAudioMetadata).mockResolvedValue({ title: 'Tagged Title', artist: 'Tagged Artist' })
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'whatever.mp3', { type: 'audio/mpeg' })] } })

    await waitFor(() => expect(screen.getByPlaceholderText(/title/i)).toHaveValue('Tagged Title'))
    expect(screen.getByPlaceholderText(/artist/i)).toHaveValue('Tagged Artist')
  })

  it('falls back to the filename (without extension) when there is no title tag', async () => {
    vi.mocked(extractAudioMetadata).mockResolvedValue({})
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'My Eyes Only.mp3', { type: 'audio/mpeg' })] } })

    await waitFor(() => expect(screen.getByPlaceholderText(/title/i)).toHaveValue('My Eyes Only'))
  })

  it('does not overwrite a title the user already typed', async () => {
    vi.mocked(extractAudioMetadata).mockResolvedValue({ title: 'Tagged Title' })
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: 'My Manual Title' } })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'song.mp3', { type: 'audio/mpeg' })] } })

    await waitFor(() => expect(extractAudioMetadata).toHaveBeenCalled())
    expect(screen.getByPlaceholderText(/title/i)).toHaveValue('My Manual Title')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/UploadAudioFlow.test.tsx`
Expected: FAIL — title stays empty / equals filename only after wiring is added
(the new auto-fill tests fail; existing tests still pass).

- [ ] **Step 3: Write the implementation**

In `src/sources/UploadAudioFlow.tsx`:

Add imports (below the existing `import type { TimedLine }` line):
```ts
import { extractAudioMetadata, deriveTitle } from './audioMetadata'
```

Add a file-change handler inside the component (above `resolveLines` or
`handleSubmit`):
```ts
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (!f) return
    const meta = await extractAudioMetadata(f)
    // Only fill fields the user hasn't typed into; tags win over filename.
    setTitle((cur) => cur || meta.title || deriveTitle(f.name))
    setArtist((cur) => cur || meta.artist || '')
  }
```

Replace the file input's inline `onChange`:
```ts
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
```
with:
```ts
            onChange={handleFileChange} />
```

If `React` is not already imported as a value/type, add `import type React from 'react'`
at the top — but check first: the file already uses `useState` from `'react'`, so
add the React type import only if `tsc` complains about `React.ChangeEvent`.
(Project uses the automatic JSX runtime; `React.ChangeEvent` needs the type import.)
Concretely, change the existing `import { useState } from 'react'` to:
```ts
import { useState, type ChangeEvent } from 'react'
```
and use `ChangeEvent<HTMLInputElement>` instead of `React.ChangeEvent<HTMLInputElement>`
in the handler signature.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sources/UploadAudioFlow.test.tsx`
Expected: PASS (existing 3 tests + 3 new tests).

- [ ] **Step 5: Lint + typecheck**

Run: `npx eslint src/sources/UploadAudioFlow.tsx && npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/sources/UploadAudioFlow.tsx tests/sources/UploadAudioFlow.test.tsx
git commit -m "feat: auto-fill title/artist from uploaded file metadata"
```

---

## Task 6: SongLibrary component

**Files:**
- Create: `src/sources/SongLibrary.tsx`
- Test: `tests/sources/SongLibrary.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/sources/SongLibrary.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SongLibrary } from '../../src/sources/SongLibrary'
import { db } from '../../src/core/db/schema'
import type { Song } from '../../src/core/types'

function makeSong(id: string, title: string, createdAt: Date, timed = false): Song {
  return {
    id,
    title,
    artist: `Artist ${id}`,
    lyrics: {
      lines: [{ startTime: 0, endTime: timed ? 5 : 0, original: 'x', translation: '' }],
      sourceLanguage: 'ja',
      translationLanguage: 'en',
      alignmentMode: 'manual',
    },
    createdAt,
    isTrialSong: false,
  }
}

describe('SongLibrary', () => {
  beforeEach(async () => { await db.songs.clear() })

  it('lists saved songs newest-first and opens one on click', async () => {
    await db.songs.put(makeSong('old', 'Older Song', new Date('2026-01-01')))
    await db.songs.put(makeSong('new', 'Newer Song', new Date('2026-02-01')))
    const onOpen = vi.fn()
    render(<SongLibrary onOpen={onOpen} />)

    await waitFor(() => expect(screen.getByText('Newer Song')).toBeInTheDocument())
    const titles = screen.getAllByText(/Song$/).map((el) => el.textContent)
    expect(titles).toEqual(['Newer Song', 'Older Song'])

    fireEvent.click(screen.getByText('Newer Song'))
    expect(onOpen).toHaveBeenCalledWith('new')
  })

  it('shows an alignment hint per song', async () => {
    await db.songs.put(makeSong('t', 'Timed Song', new Date('2026-01-01'), true))
    render(<SongLibrary onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByText('Aligned')).toBeInTheDocument())
  })

  it('deletes a song without opening it', async () => {
    await db.songs.put(makeSong('d', 'Doomed Song', new Date('2026-01-01')))
    const onOpen = vi.fn()
    render(<SongLibrary onOpen={onOpen} />)

    await waitFor(() => expect(screen.getByText('Doomed Song')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))

    await waitFor(() => expect(screen.queryByText('Doomed Song')).not.toBeInTheDocument())
    expect(onOpen).not.toHaveBeenCalled()
    expect(await db.songs.get('d')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/SongLibrary.test.tsx`
Expected: FAIL — cannot resolve `../../src/sources/SongLibrary`.

- [ ] **Step 3: Write the implementation**

Create `src/sources/SongLibrary.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { db } from '../core/db/schema'
import { deleteSong } from '../core/db/deleteSong'
import { linesAreTimed } from '../player/alignmentPolicy'
import type { Song } from '../core/types'

interface Props {
  onOpen: (songId: string) => void
}

export function SongLibrary({ onOpen }: Props) {
  const [songs, setSongs] = useState<Song[]>([])

  useEffect(() => {
    db.songs.orderBy('createdAt').reverse().toArray().then(setSongs)
  }, [])

  const handleDelete = async (song: Song) => {
    await deleteSong(song)
    setSongs((prev) => prev.filter((s) => s.id !== song.id))
  }

  if (songs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/30 text-sm">
        No songs yet
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      {songs.map((song) => (
        <div
          key={song.id}
          onClick={() => onOpen(song.id)}
          className="bg-cinnabar-900 rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-cinnabar-800 transition-colors"
        >
          <div>
            <p className="text-sm font-medium text-white">{song.title}</p>
            <p className="text-xs text-white/40">{song.artist}</p>
            <p className="text-[10px] text-white/30 mt-0.5">
              {linesAreTimed(song.lyrics.lines) ? 'Aligned' : 'Tap-sync needed'}
            </p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(song) }}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/SongLibrary.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint + typecheck**

Run: `npx eslint src/sources/SongLibrary.tsx && npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/sources/SongLibrary.tsx tests/sources/SongLibrary.test.tsx
git commit -m "feat: SongLibrary list component"
```

---

## Task 7: Wire SongLibrary into HomeScreen

**Files:**
- Modify: `src/sources/HomeScreen.tsx`
- Test: `tests/sources/HomeScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `tests/sources/HomeScreen.test.tsx` (add the `db` import at the top and a
`beforeEach`/`afterEach` to keep the DB clean):

```tsx
import { waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'

// inside describe('HomeScreen', ...):
  it('exposes a My Songs tab and lands on it when songs exist', async () => {
    await db.songs.put({
      id: 's1', title: 'Saved Song', artist: 'A',
      lyrics: { lines: [], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' },
      createdAt: new Date(), isTrialSong: false,
    })
    render(<HomeScreen onSongReady={() => {}} />)

    expect(screen.getByRole('button', { name: /my songs/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Saved Song')).toBeInTheDocument())
    await db.songs.clear()
  })
```

Keep the existing two tests as-is; they assume an empty DB and the default
`'youtube'` tab, which still holds because the async default only switches when
`count > 0`. To guarantee isolation, add at the top of the describe block:
```tsx
import { beforeEach } from 'vitest'
beforeEach(async () => { await db.songs.clear() })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/HomeScreen.test.tsx`
Expected: FAIL — no "My Songs" button; "Saved Song" never appears.

- [ ] **Step 3: Write the implementation**

Replace the body of `src/sources/HomeScreen.tsx` with:
```tsx
// src/sources/HomeScreen.tsx
import { useEffect, useState } from 'react'
import { LinkParser } from './LinkParser'
import { UploadAudioFlow } from './UploadAudioFlow'
import { SongLibrary } from './SongLibrary'
import { db } from '../core/db/schema'

type Mode = 'youtube' | 'upload' | 'songs'

interface Props {
  onSongReady: (songId: string) => void
}

export function HomeScreen({ onSongReady }: Props) {
  const [mode, setMode] = useState<Mode>('youtube')

  // Returning users with saved songs land on their library; new users keep the
  // YouTube-link default.
  useEffect(() => {
    db.songs.count().then((n) => { if (n > 0) setMode('songs') })
  }, [])

  const tab = (m: Mode, label: string) => (
    <button
      onClick={() => setMode(m)}
      className={`px-4 py-1.5 rounded-full text-xs ${mode === m ? 'bg-cinnabar-accent text-white' : 'bg-cinnabar-900 text-white/50'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col">
      <div className="flex justify-center gap-2 pt-6">
        {tab('youtube', 'YouTube link')}
        {tab('upload', 'Upload audio')}
        {tab('songs', 'My Songs')}
      </div>
      <div className="flex-1 flex flex-col">
        {mode === 'youtube' && <LinkParser onSongReady={onSongReady} />}
        {mode === 'upload' && <UploadAudioFlow onSongReady={onSongReady} />}
        {mode === 'songs' && <SongLibrary onOpen={onSongReady} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sources/HomeScreen.test.tsx`
Expected: PASS (existing 2 tests + new test).

- [ ] **Step 5: Full suite + lint + typecheck**

Run: `npx vitest run && npx eslint src && npx tsc -b`
Expected: all PASS, no lint/type errors.

- [ ] **Step 6: Commit**

```bash
git add src/sources/HomeScreen.tsx tests/sources/HomeScreen.test.tsx
git commit -m "feat: My Songs tab on home screen with saved-song library"
```

---

## Task 8: Manual verification in the browser

**Files:** none (manual)

- [ ] **Step 1: Run the dev server and exercise the flow**

Run: `npm run dev`, open the app.
Verify:
1. With saved songs present, the home screen opens on **My Songs** and lists them
   newest-first; each shows title, artist, and an "Aligned"/"Tap-sync needed" hint.
2. Tapping a song opens it in the player.
3. Tapping **Delete** removes it from the list (and does not open it).
4. On **Upload audio**, choosing a file with ID3 tags fills Title/Artist; a file
   without tags fills Title from the filename; typing a Title first is not
   overwritten.

- [ ] **Step 2: Commit (if any docs/notes updated)**

No code commit expected unless issues are found and fixed under the relevant task.

---

## Self-Review Notes

- **Spec coverage:** home-screen entry point (Task 7), default-tab-when-songs-exist
  (Task 7), `SongLibrary` open/delete/hint (Task 6), shared `deleteSong` + SettingsView
  refactor (Tasks 2–3), `music-metadata` dependency (Task 1), `extractAudioMetadata` +
  `deriveTitle` (Task 4), UploadAudioFlow auto-fill incl. filename fallback and
  no-overwrite (Task 5). All spec sections covered.
- **Types:** `deleteSong(song: Song)`, `extractAudioMetadata(file): Promise<AudioMetadata>`,
  `deriveTitle(filename): string`, `SongLibrary` prop `onOpen`, `HomeScreen` `Mode`
  union — consistent across tasks.
- **No placeholders:** every code step shows full code and exact commands.
