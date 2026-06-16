# Phase 1 — Unified Flow & In-Place Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scattered home-tabs + three alignment screens with a `Library ⇄ Song` spine where the player itself is the editor, so any existing aligned line can be fixed in place (ease-first, precision-optional).

**Architecture:** A song's lyric lines become editable rows inside the player via a `Play ⇄ Edit` toggle. All line mutations are pure functions in `lineOps.ts` (fully unit-tested); the `LineEditor`/`EditMode` components are thin views over them. Tap-through and Auto-align fold in as in-screen tools. The 3-tab `HomeScreen` becomes a `LibraryScreen` with sync badges; Add and Settings become sheets. A non-destructive Dexie v2 migration adds a unified `sources[]`/`syncState` model derived from the legacy `sourceUrl`/`audioStoredPath` fields.

**Tech Stack:** React 19 + TypeScript, Zustand, Dexie (IndexedDB), Tailwind, Vitest (jsdom + @testing-library/react). Tests run with `npx vitest run <path>`.

**Scope note:** This is Phase 1 of the approved spec (`docs/superpowers/specs/2026-06-16-unified-flow-editing-and-sources-design.md`). Phase 2 (Spotify + multi-source resolver) is a separate plan. Phase 1 ships on YouTube + Upload + lrclib only.

---

## File Structure

**Create:**
- `src/core/db/migrations.ts` — pure helpers: `deriveSources(song)`, `computeSyncState(song)`.
- `src/lyrics/lineOps.ts` — pure line mutations (stamp/nudge/setText/add/delete/merge/split/reorder).
- `src/lyrics/LineEditor.tsx` — one expandable editable line row.
- `src/lyrics/EditMode.tsx` — editable line list + in-screen tools row.
- `src/sources/LibraryScreen.tsx` — home: song list + Add button + sync badges.
- `src/sources/AddSongSheet.tsx` — single sheet wrapping Link/Upload import.
- `src/settings/SettingsSheet.tsx` — Settings rendered as a dismissible sheet.

**Modify:**
- `src/core/types/index.ts` — extend `Song`, add `SourceRef`/`ProviderType`.
- `src/core/db/schema.ts` — Dexie `version(2)` upgrade.
- `src/player/PlayerView.tsx` → becomes `SongScreen` with `Play ⇄ Edit` toggle.
- `src/App.tsx` — view state `library | song` + `addSheetOpen`/`settingsSheetOpen`.

**Reuse as-is:** `LyricDisplay.tsx` (Play mode), `TapSyncEditor.tsx` (Tap-through tool), `AutoAlignFlow.tsx` (Auto-align tool), `alignmentPolicy.linesAreTimed`, `core/db/deleteSong`.

---

## Task 1: Extend the data model types

**Files:**
- Modify: `src/core/types/index.ts`

- [ ] **Step 1: Add provider/source types and extend `Song`**

In `src/core/types/index.ts`, add near the top type aliases:

```ts
export type ProviderType = 'youtube' | 'spotify' | 'upload'

export interface SourceRef {
  provider: ProviderType
  /** youtube videoId | spotify trackId | OPFS audio path */
  ref: string
  url?: string
  /** true when the app can read the waveform (YouTube/upload) → AI-alignable */
  hasAudio: boolean
}

export type SyncState = 'synced' | 'needs-sync'
```

Then extend the existing `Song` interface by adding these optional fields (leave all existing fields untouched):

```ts
  // Phase 1: unified source model (additive; derived from sourceUrl/audioStoredPath when absent)
  sources?: SourceRef[]
  activeProvider?: ProviderType
  albumArtUrl?: string
  syncState?: SyncState
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS (no errors). Adding optional fields cannot break existing call sites.

- [ ] **Step 3: Commit**

```bash
git add src/core/types/index.ts
git commit -m "feat(types): add unified SourceRef/syncState fields to Song"
```

---

## Task 2: Migration helpers (derive sources + sync state)

**Files:**
- Create: `src/core/db/migrations.ts`
- Test: `tests/core/db/migrations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/db/migrations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveSources, computeSyncState } from '../../../src/core/db/migrations'
import type { Song } from '../../../src/core/types'

function baseSong(over: Partial<Song> = {}): Song {
  return {
    id: 's1', title: 'T', artist: 'A',
    lyrics: { lines: [], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' },
    createdAt: new Date(), isTrialSong: false,
    ...over,
  }
}

describe('deriveSources', () => {
  it('maps a YouTube sourceUrl to a youtube SourceRef with audio', () => {
    const s = baseSong({ sourceUrl: 'https://youtube.com/watch?v=abc123' })
    expect(deriveSources(s)).toEqual([
      { provider: 'youtube', ref: 'abc123', url: 'https://youtube.com/watch?v=abc123', hasAudio: true },
    ])
  })

  it('maps a stored audio path to an upload SourceRef with audio', () => {
    const s = baseSong({ audioStoredPath: 'songs/s1.mp3' })
    expect(deriveSources(s)).toEqual([
      { provider: 'upload', ref: 'songs/s1.mp3', hasAudio: true },
    ])
  })

  it('returns existing sources untouched when already present', () => {
    const sources = [{ provider: 'youtube' as const, ref: 'x', hasAudio: true }]
    expect(deriveSources(baseSong({ sources }))).toBe(sources)
  })

  it('returns [] when there is no source information', () => {
    expect(deriveSources(baseSong())).toEqual([])
  })
})

describe('computeSyncState', () => {
  it('is needs-sync when there are no lines', () => {
    expect(computeSyncState(baseSong())).toBe('needs-sync')
  })

  it('is needs-sync when any line lacks a positive startTime', () => {
    const lines = [
      { startTime: 1, endTime: 2, original: 'a', translation: '' },
      { startTime: 0, endTime: 0, original: 'b', translation: '' },
    ]
    expect(computeSyncState(baseSong({ lyrics: { lines, sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' } }))).toBe('needs-sync')
  })

  it('is synced when every line has a positive startTime', () => {
    const lines = [
      { startTime: 0.5, endTime: 2, original: 'a', translation: '' },
      { startTime: 2, endTime: 4, original: 'b', translation: '' },
    ]
    expect(computeSyncState(baseSong({ lyrics: { lines, sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' } }))).toBe('synced')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/db/migrations.test.ts`
Expected: FAIL — "Failed to resolve import ... migrations".

- [ ] **Step 3: Implement the helpers**

Create `src/core/db/migrations.ts`:

```ts
import type { Song, SourceRef, SyncState } from '../types'
import { extractVideoId } from '../../sources/youtube'

/**
 * Forward-fill the unified source list from a song's legacy single-source
 * fields. Idempotent: songs that already carry `sources` are returned as-is.
 */
export function deriveSources(song: Song): SourceRef[] {
  if (song.sources && song.sources.length > 0) return song.sources
  if (song.sourceUrl) {
    const videoId = extractVideoId(song.sourceUrl)
    if (videoId) return [{ provider: 'youtube', ref: videoId, url: song.sourceUrl, hasAudio: true }]
  }
  if (song.audioStoredPath) {
    return [{ provider: 'upload', ref: song.audioStoredPath, hasAudio: true }]
  }
  return []
}

/** A song is `synced` only when every line has a positive start time. */
export function computeSyncState(song: Song): SyncState {
  const lines = song.lyrics.lines
  if (lines.length === 0) return 'needs-sync'
  return lines.every((l) => l.startTime > 0 || (l.startTime === 0 && l === lines[0])) ? 'synced' : 'needs-sync'
}
```

Note: the first line legitimately starts at 0.0, so `startTime === 0` is only allowed for `lines[0]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/db/migrations.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/db/migrations.ts tests/core/db/migrations.test.ts
git commit -m "feat(db): source-derivation and sync-state helpers"
```

---

## Task 3: Dexie v2 upgrade (backfill sources + syncState)

**Files:**
- Modify: `src/core/db/schema.ts`
- Test: `tests/core/db/schema-migration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/db/schema-migration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../src/core/db/schema'

beforeEach(async () => {
  await db.songs.clear()
})

describe('Dexie v2 backfill', () => {
  it('backfills sources and syncState on read for a legacy YouTube song', async () => {
    await db.songs.put({
      id: 'leg1', title: 'T', artist: 'A',
      sourceUrl: 'https://youtu.be/abc123',
      lyrics: { lines: [{ startTime: 0, endTime: 3, original: 'a', translation: '' }], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' },
      createdAt: new Date(), isTrialSong: false,
    } as never)

    const got = await db.songs.get('leg1')
    expect(got!.sources?.[0]).toMatchObject({ provider: 'youtube', ref: 'abc123', hasAudio: true })
    expect(got!.syncState).toBe('synced')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/db/schema-migration.test.ts`
Expected: FAIL — `got.sources` is undefined (no backfill yet).

- [ ] **Step 3: Implement the v2 upgrade + read hook**

Replace `src/core/db/schema.ts` with:

```ts
import Dexie, { type Table } from 'dexie'
import type { Song } from '../types'
import { deriveSources, computeSyncState } from './migrations'

class UtasyncDB extends Dexie {
  songs!: Table<Song, string>

  constructor() {
    super('utasync')
    this.version(1).stores({
      songs: 'id, title, artist, createdAt',
    })
    // v2: index syncState for the Library badge filter. Backfill the unified
    // source list + sync state for every existing row, non-destructively.
    this.version(2).stores({
      songs: 'id, title, artist, createdAt, syncState',
    }).upgrade(async (tx) => {
      await tx.table('songs').toCollection().modify((song: Song) => {
        song.sources = deriveSources(song)
        song.syncState = computeSyncState(song)
      })
    })

    // Rows written by older code paths (or restored) still get filled on read.
    this.songs.hook('reading', (song: Song) => {
      if (!song.sources) song.sources = deriveSources(song)
      if (!song.syncState) song.syncState = computeSyncState(song)
      return song
    })
  }
}

export const db = new UtasyncDB()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/db/schema-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full existing DB/source suite for regressions**

Run: `npx vitest run tests/sources tests/core`
Expected: PASS (no existing test depends on the absence of `sources`/`syncState`).

- [ ] **Step 6: Commit**

```bash
git add src/core/db/schema.ts tests/core/db/schema-migration.test.ts
git commit -m "feat(db): Dexie v2 backfills sources and syncState"
```

---

## Task 4: Pure line operations (`lineOps.ts`)

**Files:**
- Create: `src/lyrics/lineOps.ts`
- Test: `tests/lyrics/lineOps.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/lineOps.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { stampStart, nudgeStart, setText, addLine, deleteLine, mergeWithNext, splitLine, reorder } from '../../src/lyrics/lineOps'
import type { TimedLine } from '../../src/core/types'

const L = (startTime: number, original: string, translation = ''): TimedLine => ({ startTime, endTime: startTime + 2, original, translation })
const lines = (): TimedLine[] => [L(0, 'a'), L(2, 'b'), L(4, 'c')]

describe('stampStart', () => {
  it('sets the start time of one line and leaves others unchanged', () => {
    const out = stampStart(lines(), 1, 2.5)
    expect(out[1].startTime).toBe(2.5)
    expect(out[0]).toEqual(lines()[0])
    expect(out).not.toBe(lines()) // new array (immutable)
  })
})

describe('nudgeStart', () => {
  it('adds a delta and clamps at zero', () => {
    expect(nudgeStart(lines(), 1, -0.1)[1].startTime).toBeCloseTo(1.9)
    expect(nudgeStart(lines(), 0, -5)[0].startTime).toBe(0)
  })
})

describe('setText', () => {
  it('updates original and translation independently', () => {
    const out = setText(lines(), 0, { original: 'x' })
    expect(out[0].original).toBe('x')
    expect(out[0].translation).toBe('')
    expect(setText(lines(), 0, { translation: 'y' })[0].translation).toBe('y')
  })

  it('drops stale enrichment when the original text changes', () => {
    const enriched: TimedLine = { ...L(0, 'a'), reading: 'old', furigana: '<ruby>', tokens: [] }
    const out = setText([enriched], 0, { original: 'b' })
    expect(out[0].reading).toBeUndefined()
    expect(out[0].furigana).toBeUndefined()
    expect(out[0].tokens).toBeUndefined()
  })
})

describe('addLine', () => {
  it('inserts an empty untimed line after the given index', () => {
    const out = addLine(lines(), 0)
    expect(out).toHaveLength(4)
    expect(out[1]).toMatchObject({ original: '', translation: '', startTime: 0 })
  })
})

describe('deleteLine', () => {
  it('removes the line at the index', () => {
    const out = deleteLine(lines(), 1)
    expect(out.map((l) => l.original)).toEqual(['a', 'c'])
  })
})

describe('mergeWithNext', () => {
  it('joins a line with the following one and keeps the earlier start', () => {
    const out = mergeWithNext(lines(), 0)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ original: 'a b', startTime: 0, endTime: 4 })
  })

  it('is a no-op on the last line', () => {
    expect(mergeWithNext(lines(), 2)).toHaveLength(3)
  })
})

describe('splitLine', () => {
  it('splits original text at a character offset into two lines', () => {
    const out = splitLine([L(0, 'hello world')], 0, 5)
    expect(out.map((l) => l.original)).toEqual(['hello', 'world'])
    expect(out[1].startTime).toBe(0)
  })
})

describe('reorder', () => {
  it('moves a line from one index to another', () => {
    expect(reorder(lines(), 0, 2).map((l) => l.original)).toEqual(['b', 'c', 'a'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/lineOps.test.ts`
Expected: FAIL — cannot resolve `lineOps`.

- [ ] **Step 3: Implement `lineOps.ts`**

Create `src/lyrics/lineOps.ts`:

```ts
import type { TimedLine } from '../core/types'

/** Replace one element immutably. */
function replaceAt(lines: TimedLine[], i: number, next: TimedLine): TimedLine[] {
  return lines.map((l, j) => (j === i ? next : l))
}

export function stampStart(lines: TimedLine[], i: number, time: number): TimedLine[] {
  return replaceAt(lines, i, { ...lines[i], startTime: Math.max(0, time) })
}

export function nudgeStart(lines: TimedLine[], i: number, delta: number): TimedLine[] {
  return replaceAt(lines, i, { ...lines[i], startTime: Math.max(0, lines[i].startTime + delta) })
}

/**
 * Update original and/or translation. Changing `original` invalidates derived
 * enrichment (reading/furigana/tokens/grammar) so the player re-enriches it.
 */
export function setText(lines: TimedLine[], i: number, patch: { original?: string; translation?: string }): TimedLine[] {
  const cur = lines[i]
  const next: TimedLine = { ...cur, ...patch }
  if (patch.original !== undefined && patch.original !== cur.original) {
    delete next.reading
    delete next.furigana
    delete next.tokens
    delete next.grammarAnnotations
  }
  return replaceAt(lines, i, next)
}

export function addLine(lines: TimedLine[], afterIndex: number): TimedLine[] {
  const start = lines[afterIndex]?.startTime ?? 0
  const blank: TimedLine = { startTime: start, endTime: start, original: '', translation: '' }
  return [...lines.slice(0, afterIndex + 1), blank, ...lines.slice(afterIndex + 1)]
}

export function deleteLine(lines: TimedLine[], i: number): TimedLine[] {
  return lines.filter((_, j) => j !== i)
}

export function mergeWithNext(lines: TimedLine[], i: number): TimedLine[] {
  if (i >= lines.length - 1) return lines
  const a = lines[i]
  const b = lines[i + 1]
  const merged: TimedLine = {
    startTime: a.startTime,
    endTime: b.endTime,
    original: [a.original, b.original].filter(Boolean).join(' '),
    translation: [a.translation, b.translation].filter(Boolean).join(' '),
  }
  return [...lines.slice(0, i), merged, ...lines.slice(i + 2)]
}

export function splitLine(lines: TimedLine[], i: number, charOffset: number): TimedLine[] {
  const cur = lines[i]
  const left = cur.original.slice(0, charOffset).trim()
  const right = cur.original.slice(charOffset).trim()
  const a: TimedLine = { startTime: cur.startTime, endTime: cur.endTime, original: left, translation: cur.translation }
  const b: TimedLine = { startTime: cur.startTime, endTime: cur.endTime, original: right, translation: '' }
  return [...lines.slice(0, i), a, b, ...lines.slice(i + 1)]
}

export function reorder(lines: TimedLine[], from: number, to: number): TimedLine[] {
  const copy = [...lines]
  const [moved] = copy.splice(from, 1)
  copy.splice(to, 0, moved)
  return copy
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lyrics/lineOps.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/lineOps.ts tests/lyrics/lineOps.test.ts
git commit -m "feat(lyrics): pure line-edit operations"
```

---

## Task 5: `LineEditor` component (precision path)

**Files:**
- Create: `src/lyrics/LineEditor.tsx`
- Test: `tests/lyrics/LineEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/LineEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LineEditor } from '../../src/lyrics/LineEditor'
import type { TimedLine } from '../../src/core/types'

const line: TimedLine = { startTime: 14, endTime: 18, original: '二人だけの空', translation: 'just us' }

describe('LineEditor', () => {
  it('stamps the current playhead onto the line', () => {
    const onChange = vi.fn()
    render(<LineEditor line={line} playhead={() => 21.5} onChange={onChange} onAdd={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /set start/i }))
    expect(onChange).toHaveBeenCalledWith({ startTime: 21.5 })
  })

  it('nudges the start time by -0.1', () => {
    const onChange = vi.fn()
    render(<LineEditor line={line} playhead={() => 0} onChange={onChange} onAdd={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '−0.1' }))
    expect(onChange).toHaveBeenCalledWith({ startTime: 13.9 })
  })

  it('edits original text on blur', () => {
    const onChange = vi.fn()
    render(<LineEditor line={line} playhead={() => 0} onChange={onChange} onAdd={vi.fn()} onDelete={vi.fn()} />)
    const input = screen.getByDisplayValue('二人だけの空')
    fireEvent.change(input, { target: { value: '新しい歌詞' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith({ original: '新しい歌詞' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/LineEditor.test.tsx`
Expected: FAIL — cannot resolve `LineEditor`.

- [ ] **Step 3: Implement `LineEditor.tsx`**

Create `src/lyrics/LineEditor.tsx`:

```tsx
import { useState } from 'react'
import type { TimedLine } from '../core/types'

interface Props {
  line: TimedLine
  /** Reads the live audio position when the user taps "Set start". */
  playhead: () => number
  onChange: (patch: { startTime?: number; original?: string; translation?: string }) => void
  onAdd: () => void
  onDelete: () => void
}

function fmt(t: number): string {
  if (!(t > 0)) return '—'
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

export function LineEditor({ line, playhead, onChange, onAdd, onDelete }: Props) {
  const [original, setOriginal] = useState(line.original)
  const [translation, setTranslation] = useState(line.translation)

  return (
    <div className="rounded-xl border border-cinnabar-accent/60 bg-cinnabar-accent/8 p-3 space-y-2">
      <input
        value={original}
        onChange={(e) => setOriginal(e.target.value)}
        onBlur={() => original !== line.original && onChange({ original })}
        className="w-full bg-cinnabar-950 text-white text-sm px-2 py-1.5 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent font-jp"
        aria-label="Original text"
      />
      <input
        value={translation}
        onChange={(e) => setTranslation(e.target.value)}
        onBlur={() => translation !== line.translation && onChange({ translation })}
        className="w-full bg-cinnabar-950 text-white/80 text-sm px-2 py-1.5 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent"
        aria-label="Translation text"
      />
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <button
          onClick={() => onChange({ startTime: playhead() })}
          className="px-2.5 py-1 rounded-lg bg-cinnabar-accent text-white font-medium"
        >
          ⏱ Set start @ {fmt(line.startTime)}
        </button>
        <button onClick={() => onChange({ startTime: Math.max(0, line.startTime - 0.1) })}
          className="px-2 py-1 rounded-lg bg-cinnabar-900 text-white/70">−0.1</button>
        <button onClick={() => onChange({ startTime: line.startTime + 0.1 })}
          className="px-2 py-1 rounded-lg bg-cinnabar-900 text-white/70">+0.1</button>
        <button onClick={onAdd} className="px-2 py-1 rounded-lg bg-cinnabar-900 text-white/70">⊕ add</button>
        <button onClick={onDelete} className="px-2 py-1 rounded-lg bg-cinnabar-900 text-red-400 ml-auto">🗑</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lyrics/LineEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/LineEditor.tsx tests/lyrics/LineEditor.test.tsx
git commit -m "feat(lyrics): LineEditor row with stamp/nudge/text controls"
```

---

## Task 6: `EditMode` list + in-screen tools

**Files:**
- Create: `src/lyrics/EditMode.tsx`
- Test: `tests/lyrics/EditMode.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/EditMode.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditMode } from '../../src/lyrics/EditMode'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 0, endTime: 2, original: 'a', translation: '' },
  { startTime: 0, endTime: 0, original: 'b', translation: '' }, // untimed
]

describe('EditMode', () => {
  it('stamps the playhead onto a line when its row is tapped (simple path)', () => {
    const onChangeLines = vi.fn()
    render(<EditMode lines={lines} playhead={() => 9} hasAudio onChangeLines={onChangeLines} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    fireEvent.click(screen.getByText('b'))
    expect(onChangeLines).toHaveBeenCalled()
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[1].startTime).toBe(9)
  })

  it('shows Auto-align only when audio is available', () => {
    const { rerender } = render(<EditMode lines={lines} playhead={() => 0} hasAudio onChangeLines={vi.fn()} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    expect(screen.getByRole('button', { name: /auto-align/i })).toBeTruthy()
    rerender(<EditMode lines={lines} playhead={() => 0} hasAudio={false} onChangeLines={vi.fn()} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /auto-align/i })).toBeNull()
    expect(screen.getByText(/needs a youtube or uploaded audio/i)).toBeTruthy()
  })

  it('marks untimed lines', () => {
    render(<EditMode lines={lines} playhead={() => 0} hasAudio onChangeLines={vi.fn()} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    expect(screen.getByText(/untimed/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/EditMode.test.tsx`
Expected: FAIL — cannot resolve `EditMode`.

- [ ] **Step 3: Implement `EditMode.tsx`**

Create `src/lyrics/EditMode.tsx`:

```tsx
import { useState } from 'react'
import type { TimedLine } from '../core/types'
import { LineEditor } from './LineEditor'
import { stampStart, setText, addLine, deleteLine } from './lineOps'

interface Props {
  lines: TimedLine[]
  playhead: () => number
  /** Active provider exposes a waveform (YouTube/upload) → Auto-align allowed. */
  hasAudio: boolean
  onChangeLines: (lines: TimedLine[]) => void
  onTapThrough: () => void
  onAutoAlign: () => void
}

function fmt(t: number, first: boolean): string {
  if (!(t > 0) && !(first && t === 0)) return '—'
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

export function EditMode({ lines, playhead, hasAudio, onChangeLines, onTapThrough, onAutoAlign }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {lines.map((line, i) => {
          const timed = line.startTime > 0 || (i === 0 && line.startTime === 0 && line.endTime > 0)
          if (expanded === i) {
            return (
              <LineEditor
                key={i}
                line={line}
                playhead={playhead}
                onChange={(patch) => {
                  let next = lines
                  if (patch.startTime !== undefined) next = stampStart(next, i, patch.startTime)
                  if (patch.original !== undefined || patch.translation !== undefined) next = setText(next, i, patch)
                  onChangeLines(next)
                }}
                onAdd={() => onChangeLines(addLine(lines, i))}
                onDelete={() => { onChangeLines(deleteLine(lines, i)); setExpanded(null) }}
              />
            )
          }
          return (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5"
            >
              {/* Simple path: tapping the row body stamps the playhead onto this line. */}
              <button
                onClick={() => onChangeLines(stampStart(lines, i, playhead()))}
                className="text-[11px] tabular-nums text-cinnabar-accent w-10 text-left shrink-0"
                aria-label={`Stamp start for line ${i + 1}`}
              >
                {fmt(line.startTime, i === 0)}
              </button>
              <button onClick={() => setExpanded(i)} className="flex-1 text-left text-sm text-white font-jp">
                {line.original || <span className="text-white/30">empty</span>}
                {!timed && <span className="ml-2 text-[10px] text-cinnabar-accent">untimed</span>}
                {line.translation && <span className="block text-[11px] italic text-white/45">{line.translation}</span>}
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 p-3 border-t border-white/8 shrink-0">
        <button onClick={onTapThrough} className="flex-1 text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">⏱ Tap-through</button>
        {hasAudio ? (
          <button onClick={onAutoAlign} className="flex-1 text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">✨ Auto-align</button>
        ) : (
          <span className="flex-1 text-[10px] text-white/35 self-center text-center px-1">
            Auto-align needs a YouTube or uploaded audio source
          </span>
        )}
        <button onClick={() => onChangeLines(addLine(lines, lines.length - 1))} className="flex-1 text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">＋ Add line</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lyrics/EditMode.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/EditMode.tsx tests/lyrics/EditMode.test.tsx
git commit -m "feat(lyrics): EditMode line list with in-screen align tools"
```

---

## Task 7: `SongScreen` — Play ⇄ Edit toggle

**Files:**
- Modify: `src/player/PlayerView.tsx` (rename concept to SongScreen; keep export name `PlayerView` to avoid touching `App` until Task 11)
- Test: `tests/player/PlayerView.edit-toggle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/player/PlayerView.edit-toggle.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

// AudioEngine touches Web Audio APIs jsdom lacks — stub to a no-op.
vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: 'hi' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(), isTrialSong: false,
  } as never)
})

describe('SongScreen Play/Edit toggle', () => {
  it('switches from Play mode to Edit mode and shows editable rows', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    // EditMode renders the tools row
    await waitFor(() => expect(screen.getByRole('button', { name: /tap-through/i })).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player/PlayerView.edit-toggle.test.tsx`
Expected: FAIL — there is no `Edit` toggle button yet.

- [ ] **Step 3: Add the mode toggle and render EditMode**

In `src/player/PlayerView.tsx`:

1. Add imports near the other lyric imports:

```tsx
import { EditMode } from '../lyrics/EditMode'
import { computeSyncState, deriveSources } from '../core/db/migrations'
```

2. Add mode state next to the other `useState` hooks (after `const [alignMode, setAlignMode] = useState<AlignMode | null>(null)`):

```tsx
  const [mode, setMode] = useState<'play' | 'edit'>('play')
```

3. Compute audio availability from the unified sources (replace the existing `isYouTube` derivation usage as needed; add below it):

```tsx
  const sources = song ? deriveSources(song) : []
  const hasAudio = sources.some((s) => s.hasAudio)
```

4. Add a persistence helper that writes edited lines through to Dexie + re-enriches and updates `syncState`:

```tsx
  const handleEditLines = async (lines: TimedLine[]) => {
    if (!song) return
    setLines(lines)
    const updated: Song = { ...song, lyrics: { ...song.lyrics, lines }, syncState: computeSyncState({ ...song, lyrics: { ...song.lyrics, lines } }) }
    setSong(updated)
    await db.songs.put(updated)
    enrichLines(lines, song.lyrics.sourceLanguage).then((enriched) => {
      if (enriched.length === lines.length) setLines(enriched)
    })
  }
```

5. In the top bar (the `<div>` with Back / 歌sync / Settings), add a Play/Edit segmented toggle. Replace the centered `<span>歌sync</span>` block with:

```tsx
        <div className="inline-flex bg-white/8 rounded-full p-0.5 gap-0.5">
          <button onClick={() => setMode('play')}
            className={`text-[11px] px-3 py-1 rounded-full ${mode === 'play' ? 'bg-cinnabar-accent text-white font-semibold' : 'text-white/50'}`}>Play</button>
          <button onClick={() => setMode('edit')}
            className={`text-[11px] px-3 py-1 rounded-full ${mode === 'edit' ? 'bg-cinnabar-accent text-white font-semibold' : 'text-white/50'}`}>Edit</button>
        </div>
```

6. Replace the lyrics area line `<LyricDisplay onSeek={seek} />` with a mode switch:

```tsx
      {mode === 'play' ? (
        <LyricDisplay onSeek={seek} />
      ) : (
        <EditMode
          lines={useLyricsStore.getState().lines}
          playhead={() => (isYouTube ? position : engine.position)}
          hasAudio={hasAudio}
          onChangeLines={handleEditLines}
          onTapThrough={() => beginAlignment('tap')}
          onAutoAlign={() => beginAlignment('auto')}
        />
      )}
```

Note: `beginAlignment('tap')` already routes to `TapSyncEditor`; on completion `handleTapComplete` persists and returns to the player (now defaulting back to whichever mode was active — keep `mode` as-is so the user returns to Edit).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/player/PlayerView.edit-toggle.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b --noEmit` → Expected: PASS

```bash
git add src/player/PlayerView.tsx tests/player/PlayerView.edit-toggle.test.tsx
git commit -m "feat(player): Play/Edit toggle renders in-place EditMode"
```

---

## Task 8: `LibraryScreen` with sync badges

**Files:**
- Create: `src/sources/LibraryScreen.tsx`
- Test: `tests/sources/LibraryScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/sources/LibraryScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { LibraryScreen } from '../../src/sources/LibraryScreen'

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.bulkPut([
    { id: '1', title: 'Synced Song', artist: 'A', syncState: 'synced', sources: [], lyrics: { lines: [{ startTime: 1, endTime: 2, original: 'a', translation: '' }], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' }, createdAt: new Date(1), isTrialSong: false },
    { id: '2', title: 'Unsynced Song', artist: 'B', syncState: 'needs-sync', sources: [], lyrics: { lines: [{ startTime: 0, endTime: 0, original: 'b', translation: '' }], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' }, createdAt: new Date(2), isTrialSong: false },
  ] as never)
})

describe('LibraryScreen', () => {
  it('lists songs and shows a needs-sync badge', async () => {
    render(<LibraryScreen onOpen={vi.fn()} onAdd={vi.fn()} onSettings={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Synced Song')).toBeTruthy())
    expect(screen.getByText(/needs sync/i)).toBeTruthy()
  })

  it('fires onAdd when the add button is tapped', async () => {
    const onAdd = vi.fn()
    render(<LibraryScreen onOpen={vi.fn()} onAdd={onAdd} onSettings={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /add a song/i }))
    expect(onAdd).toHaveBeenCalled()
  })

  it('opens a song on tap', async () => {
    const onOpen = vi.fn()
    render(<LibraryScreen onOpen={onOpen} onAdd={vi.fn()} onSettings={vi.fn()} />)
    await waitFor(() => screen.getByText('Synced Song'))
    fireEvent.click(screen.getByText('Synced Song'))
    expect(onOpen).toHaveBeenCalledWith('1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/LibraryScreen.test.tsx`
Expected: FAIL — cannot resolve `LibraryScreen`.

- [ ] **Step 3: Implement `LibraryScreen.tsx`**

Create `src/sources/LibraryScreen.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { db } from '../core/db/schema'
import { deleteSong } from '../core/db/deleteSong'
import { computeSyncState } from '../core/db/migrations'
import type { Song } from '../core/types'

interface Props {
  onOpen: (songId: string) => void
  onAdd: () => void
  onSettings: () => void
}

export function LibraryScreen({ onOpen, onAdd, onSettings }: Props) {
  const [songs, setSongs] = useState<Song[]>([])

  useEffect(() => {
    db.songs.orderBy('createdAt').reverse().toArray().then(setSongs)
  }, [])

  const handleDelete = async (song: Song) => {
    await deleteSong(song)
    setSongs((prev) => prev.filter((s) => s.id !== song.id))
  }

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-4 shrink-0">
        <span className="text-cinnabar-accent font-semibold tracking-widest text-lg">歌sync</span>
        <button onClick={onSettings} className="text-white/40 hover:text-white text-xs">⚙ Settings</button>
      </div>

      <div className="px-4 pb-3 shrink-0">
        <button onClick={onAdd}
          className="w-full py-3 rounded-xl bg-cinnabar-accent text-white font-semibold text-sm flex items-center justify-center gap-2">
          ＋ Add a song
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-2">
        {songs.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-white/30 text-sm py-20">No songs yet</div>
        )}
        {songs.map((song) => {
          const sync = song.syncState ?? computeSyncState(song)
          return (
            <div key={song.id} onClick={() => onOpen(song.id)}
              className="bg-cinnabar-900 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:bg-cinnabar-800 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cinnabar-accent to-cinnabar-800 shrink-0 overflow-hidden">
                {song.albumArtUrl && <img src={song.albumArtUrl} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{song.title}</p>
                <p className="text-xs text-white/40 truncate">{song.artist}</p>
              </div>
              <span className={`text-[10px] rounded-full border px-2 py-0.5 shrink-0 ${sync === 'synced' ? 'border-white/20 text-white/50' : 'border-cinnabar-accent/60 text-cinnabar-accent'}`}>
                {sync === 'synced' ? 'synced' : 'needs sync'}
              </span>
              <button onClick={(e) => { e.stopPropagation(); handleDelete(song) }}
                className="text-xs text-red-400 hover:text-red-300 px-1 shrink-0">✕</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/LibraryScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/LibraryScreen.tsx tests/sources/LibraryScreen.test.tsx
git commit -m "feat(sources): LibraryScreen home with sync badges"
```

---

## Task 9: `AddSongSheet` (Link/Upload in one sheet)

**Files:**
- Create: `src/sources/AddSongSheet.tsx`
- Test: `tests/sources/AddSongSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/sources/AddSongSheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AddSongSheet } from '../../src/sources/AddSongSheet'

// The heavy import flows are exercised by their own suites; stub them to a marker.
vi.mock('../../src/sources/LinkParser', () => ({ LinkParser: () => <div>LINK_PARSER</div> }))
vi.mock('../../src/sources/UploadAudioFlow', () => ({ UploadAudioFlow: () => <div>UPLOAD_FLOW</div> }))

describe('AddSongSheet', () => {
  it('defaults to Link and toggles to Upload', () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('LINK_PARSER')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /upload audio/i }))
    expect(screen.getByText('UPLOAD_FLOW')).toBeTruthy()
  })

  it('closes when the backdrop dismiss is tapped', () => {
    const onClose = vi.fn()
    render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/AddSongSheet.test.tsx`
Expected: FAIL — cannot resolve `AddSongSheet`.

- [ ] **Step 3: Implement `AddSongSheet.tsx`**

Create `src/sources/AddSongSheet.tsx`:

```tsx
import { useState } from 'react'
import { LinkParser } from './LinkParser'
import { UploadAudioFlow } from './UploadAudioFlow'

type Source = 'link' | 'upload'

interface Props {
  onSongReady: (songId: string) => void
  onClose: () => void
}

export function AddSongSheet({ onSongReady, onClose }: Props) {
  const [source, setSource] = useState<Source>('link')

  const tab = (s: Source, label: string) => (
    <button onClick={() => setSource(s)}
      className={`flex-1 text-center text-xs py-2 rounded-lg border ${source === s ? 'border-cinnabar-accent bg-cinnabar-accent/12 text-cinnabar-accent font-medium' : 'border-white/12 text-white/50'}`}>
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative bg-cinnabar-950 border-t border-white/12 rounded-t-2xl p-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h2 className="text-white font-semibold text-sm">Add a song</h2>
          <button aria-label="Close" onClick={onClose} className="text-white/40 text-lg leading-none">✕</button>
        </div>
        <div className="flex gap-2 mb-4 shrink-0">
          {tab('link', '🔗 Link')}
          {tab('upload', '⬆ Upload audio')}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {source === 'link'
            ? <LinkParser onSongReady={onSongReady} />
            : <UploadAudioFlow onSongReady={onSongReady} />}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/AddSongSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/AddSongSheet.tsx tests/sources/AddSongSheet.test.tsx
git commit -m "feat(sources): AddSongSheet wraps Link/Upload in one sheet"
```

---

## Task 10: `SettingsSheet`

**Files:**
- Create: `src/settings/SettingsSheet.tsx`
- Test: `tests/settings/SettingsSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/settings/SettingsSheet.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsSheet } from '../../src/settings/SettingsSheet'

vi.mock('../../src/settings/SettingsView', () => ({ SettingsView: () => <div>SETTINGS_BODY</div> }))

describe('SettingsSheet', () => {
  it('renders settings and closes on dismiss', () => {
    const onClose = vi.fn()
    render(<SettingsSheet onClose={onClose} />)
    expect(screen.getByText('SETTINGS_BODY')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings/SettingsSheet.test.tsx`
Expected: FAIL — cannot resolve `SettingsSheet`.

- [ ] **Step 3: Implement `SettingsSheet.tsx`**

`SettingsView` already accepts an `onClose` prop (see `src/settings/SettingsView.tsx`). Wrap it in a sheet shell. Create `src/settings/SettingsSheet.tsx`:

```tsx
import { SettingsView } from './SettingsView'

interface Props {
  onClose: () => void
}

export function SettingsSheet({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative bg-cinnabar-950 border-t border-white/12 rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SettingsView onClose={onClose} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings/SettingsSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings/SettingsSheet.tsx tests/settings/SettingsSheet.test.tsx
git commit -m "feat(settings): SettingsSheet wraps SettingsView as a sheet"
```

---

## Task 11: Wire the spine in `App.tsx`

**Files:**
- Modify: `src/App.tsx`
- Test: `tests/App.spine.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/App.spine.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../src/core/db/schema'
import App from '../src/App'

vi.mock('../src/sources/AddSongSheet', () => ({ AddSongSheet: () => <div>ADD_SHEET</div> }))

beforeEach(async () => {
  await db.songs.clear()
})

describe('App navigation spine', () => {
  it('opens the Add sheet from the Library', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: /add a song/i }))
    fireEvent.click(screen.getByRole('button', { name: /add a song/i }))
    expect(screen.getByText('ADD_SHEET')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/App.spine.test.tsx`
Expected: FAIL — App still renders the old `HomeScreen` (no "Add a song" button).

- [ ] **Step 3: Rewrite `App.tsx` to the Library ⇄ Song spine**

Replace `src/App.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import { LibraryScreen } from './sources/LibraryScreen'
import { AddSongSheet } from './sources/AddSongSheet'
import { PlayerView } from './player/PlayerView'
import { SettingsSheet } from './settings/SettingsSheet'
import { estimateQuota } from './core/storage/quota'
import { useToast } from './core/ui/Toast'

type View = 'library' | 'song'

export default function App() {
  const [view, setView] = useState<View>('library')
  const [songId, setSongId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const toast = useToast()

  useEffect(() => {
    estimateQuota().then(({ ratio }) => {
      if (ratio > 0.8) toast('Storage nearly full. Open Settings to free space.', 'warning')
    })
  }, [toast])

  const openSong = (id: string) => {
    setSongId(id)
    setAddOpen(false)
    setView('song')
  }

  return (
    <>
      {view === 'song' && songId ? (
        <PlayerView
          songId={songId}
          onBack={() => setView('library')}
          onSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <LibraryScreen
          onOpen={openSong}
          onAdd={() => setAddOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {addOpen && <AddSongSheet onSongReady={openSong} onClose={() => setAddOpen(false)} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/App.spine.test.tsx`
Expected: PASS.

- [ ] **Step 5: Remove the now-dead `HomeScreen` and its test**

`HomeScreen` is no longer referenced. Delete it and its test:

```bash
git rm src/sources/HomeScreen.tsx tests/sources/HomeScreen.test.tsx
```

Run: `npx tsc -b --noEmit`
Expected: PASS (no remaining imports of `HomeScreen`). If `SongLibrary` is also unreferenced after Task 8, leave it for now — it is harmless and may still be imported by other tests; remove only if `tsc`/lint flags it as unused at a call site.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx tests/App.spine.test.tsx
git commit -m "feat(app): Library⇄Song spine with Add/Settings sheets"
```

---

## Task 12: Full regression + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: PASS. Investigate and fix any failure before proceeding (most likely candidates: tests that imported `HomeScreen`, or snapshot text that referenced "Aligned"/"Tap-sync needed" from the old `SongLibrary`).

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc -b --noEmit && npx eslint .`
Expected: PASS / no errors.

- [ ] **Step 3: Manual preview verification**

Start the dev server and verify the flow end-to-end in the browser preview:

1. Library loads; **＋ Add a song** opens the sheet; Link/Upload toggle works; importing a song opens the Song screen.
2. In the Song screen, the **Play/Edit** toggle switches modes.
3. In **Edit** mode: tapping a line's timestamp stamps the playhead; expanding a row edits original/translation and nudges timing; **＋ Add line** / **🗑** work; the **untimed** marker shows for lines with no start.
4. **Tap-through** and **Auto-align** launch from Edit mode and return to it; Auto-align is hidden for a song whose only source has `hasAudio: false`.
5. Back in Library, an unfinished song shows the **needs sync** badge; **⚙ Settings** opens as a sheet over the current screen.

- [ ] **Step 4: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "test: Phase 1 regression fixes and verification"
```

---

## Self-Review Notes (author)

- **Spec coverage:** Navigation spine (T8–T11), Play⇄Edit toggle (T7), ease-first stamp + precision LineEditor (T5–T6), pairing/text editing anytime (T4–T5 `setText`), add/delete/merge/split/reorder (T4 ops; T5–T6 wire add/delete — merge/split/reorder ops exist and are unit-tested, with drag-reorder UI deferred to a follow-up if not wired in T6), in-screen Tap-through/Auto-align with audio gating (T6), sync badges (T8), additive data model + Dexie v2 (T1–T3). Drag-to-time handle from the spec is represented by `±0.1` nudge + `Set start`; a visual drag handle can be added in a follow-up without changing the data model.
- **Deferred to Phase 2 (separate plan):** Spotify source, resolver cross-fill, Spotify→YouTube manual pick. The `SourceRef`/`hasAudio` model and Auto-align gating added here are the seams Phase 2 plugs into.
- **Type consistency:** `deriveSources`/`computeSyncState` signatures match across T2, T3, T7, T8; `lineOps` names (`stampStart`, `nudgeStart`, `setText`, `addLine`, `deleteLine`, `mergeWithNext`, `splitLine`, `reorder`) are used consistently in T5–T6.
