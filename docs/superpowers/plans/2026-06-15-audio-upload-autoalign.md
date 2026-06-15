# Local Audio Upload + AI Auto-Align Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload a local audio file with lyrics (LRCLIB / pasted text / subtitle file), then guarantee the lyrics end up time-aligned to the audio via AI auto-align (capable devices) or manual tap-sync (no-WebGPU devices).

**Architecture:** A new home screen toggles between the existing YouTube `LinkParser` and a new `UploadAudioFlow`. Upload ingests audio into OPFS and creates a `Song` with `audioStoredPath`. `PlayerView` owns the "alignment guarantee": when a stored-audio song has untimed lyrics it routes into the (lazy-loaded) `AutoAlignFlow` or the `TapSyncEditor`. The previously-orphaned `src/ai-pipeline/` and `TapSyncEditor` get wired in for the first time.

**Tech Stack:** React 19 + TypeScript + Vite 8 (Rolldown), Zustand, Dexie (IndexedDB), Howler, OPFS, `@xenova/transformers` (Web Worker), kuromoji/kuroshiro. Tests: vitest + jsdom + @testing-library/react + fake-indexeddb.

---

## Before you start

The repo is on `main` with uncommitted QC fixes already in the working tree. Create a feature branch and commit the existing QC work first so feature commits are isolated:

```bash
cd /Users/ninjaruss/Documents/GitHub/utasync
git checkout -b feature/audio-upload-autoalign
git add -A && git commit -m "chore: QC fixes — bugs, types, lint clean"
```

(Or use the `superpowers:using-git-worktrees` skill to create an isolated worktree.) Verify the baseline is green before adding anything:

```bash
npm run lint && npx tsc -b && npx vitest run
```

Expected: lint clean, no TS errors, 55 tests pass.

---

## File structure

**Create**
- `src/sources/songBuilder.ts` — `buildSong`, `linesFromPlainText` (pure).
- `src/lyrics/subtitle-parser.ts` — `parseSubtitle` (pure).
- `src/sources/audioIngest.ts` — `ingestAudioFile`.
- `src/player/alignmentPolicy.ts` — `linesAreTimed`, `chooseAutoAlignment`, `manualAlignMode` (pure).
- `src/sources/UploadAudioFlow.tsx` — upload UI.
- `src/sources/HomeScreen.tsx` — YouTube/Upload toggle.
- Tests: `tests/sources/songBuilder.test.ts`, `tests/lyrics/subtitle-parser.test.ts`, `tests/sources/audioIngest.test.ts`, `tests/player/alignmentPolicy.test.ts`, `tests/sources/UploadAudioFlow.test.tsx`, `tests/sources/HomeScreen.test.tsx`.

**Modify**
- `src/sources/LinkParser.tsx` — use `buildSong` (no behavior change).
- `src/ai-pipeline/AutoAlignFlow.tsx` — add `default` export.
- `src/player/PlayerView.tsx` — alignment orchestration + re-align button.
- `src/App.tsx` — render `HomeScreen` for the `home` view.

---

### Task 1: songBuilder.ts (buildSong + linesFromPlainText)

**Files:**
- Create: `src/sources/songBuilder.ts`
- Test: `tests/sources/songBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/sources/songBuilder.test.ts
import { describe, it, expect } from 'vitest'
import { buildSong, linesFromPlainText } from '../../src/sources/songBuilder'

describe('buildSong', () => {
  it('applies defaults and passes through fields', () => {
    const song = buildSong({ title: 'T', artist: 'A', lines: [] })
    expect(song.title).toBe('T')
    expect(song.artist).toBe('A')
    expect(song.isTrialSong).toBe(false)
    expect(song.lyrics.alignmentMode).toBe('manual')
    expect(song.lyrics.sourceLanguage).toBe('ja')
    expect(song.lyrics.translationLanguage).toBe('en')
    expect(typeof song.id).toBe('string')
    expect(song.createdAt).toBeInstanceOf(Date)
  })

  it('reuses a provided id', () => {
    const song = buildSong({ id: 'fixed-id', title: 'T', artist: 'A', lines: [], audioStoredPath: 'songs/fixed-id.mp3' })
    expect(song.id).toBe('fixed-id')
    expect(song.audioStoredPath).toBe('songs/fixed-id.mp3')
  })
})

describe('linesFromPlainText', () => {
  it('splits, trims, drops blanks, yields untimed lines', () => {
    const lines = linesFromPlainText('  hello \n\n  world  \n')
    expect(lines).toEqual([
      { startTime: 0, endTime: 0, original: 'hello', translation: '' },
      { startTime: 0, endTime: 0, original: 'world', translation: '' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/songBuilder.test.ts`
Expected: FAIL — cannot find module `../../src/sources/songBuilder`.

- [ ] **Step 3: Write the implementation**

```ts
// src/sources/songBuilder.ts
import { v4 as uuidv4 } from 'uuid'
import type { Song, TimedLine, AlignmentMode, Language } from '../core/types'

export interface BuildSongInput {
  id?: string
  title: string
  artist: string
  sourceUrl?: string
  audioStoredPath?: string
  lines: TimedLine[]
  sourceLanguage?: Language
  translationLanguage?: Language
  alignmentMode?: AlignmentMode
  isTrialSong?: boolean
}

export function buildSong(input: BuildSongInput): Song {
  return {
    id: input.id ?? uuidv4(),
    title: input.title,
    artist: input.artist,
    sourceUrl: input.sourceUrl,
    audioStoredPath: input.audioStoredPath,
    lyrics: {
      lines: input.lines,
      sourceLanguage: input.sourceLanguage ?? 'ja',
      translationLanguage: input.translationLanguage ?? 'en',
      alignmentMode: input.alignmentMode ?? 'manual',
    },
    createdAt: new Date(),
    isTrialSong: input.isTrialSong ?? false,
  }
}

export function linesFromPlainText(text: string): TimedLine[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((original): TimedLine => ({ startTime: 0, endTime: 0, original, translation: '' }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/songBuilder.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sources/songBuilder.ts tests/sources/songBuilder.test.ts
git commit -m "feat: add songBuilder (buildSong, linesFromPlainText)"
```

---

### Task 2: subtitle-parser.ts (parseSubtitle)

**Files:**
- Create: `src/lyrics/subtitle-parser.ts`
- Test: `tests/lyrics/subtitle-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lyrics/subtitle-parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseSubtitle } from '../../src/lyrics/subtitle-parser'

describe('parseSubtitle', () => {
  it('parses SRT (comma ms, strips cue index)', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,500\nHello world\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line'
    const lines = parseSubtitle(srt, 'lyrics.srt')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ startTime: 1, endTime: 3.5, original: 'Hello world', translation: '' })
    expect(lines[1].startTime).toBe(4)
  })

  it('parses VTT (dot ms, WEBVTT header, inline tags)', () => {
    const vtt = 'WEBVTT\n\n00:00:02.000 --> 00:00:05.000\n<v Singer>Konnichiwa</v>'
    const lines = parseSubtitle(vtt, 'cap.vtt')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ startTime: 2, endTime: 5, original: 'Konnichiwa' })
  })

  it('collapses multi-line cues into one line', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nline a\nline b'
    expect(parseSubtitle(srt, 'x.srt')[0].original).toBe('line a line b')
  })

  it('delegates .lrc to parseLRC', () => {
    const lrc = '[00:01.00]Hello\n[00:03.00]World'
    const lines = parseSubtitle(lrc, 'song.lrc')
    expect(lines[0]).toMatchObject({ startTime: 1, original: 'Hello' })
  })

  it('falls back to plain text for unknown extensions', () => {
    const lines = parseSubtitle('raw line one\nraw line two', 'notes.txt')
    expect(lines).toEqual([
      { startTime: 0, endTime: 0, original: 'raw line one', translation: '' },
      { startTime: 0, endTime: 0, original: 'raw line two', translation: '' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/subtitle-parser.test.ts`
Expected: FAIL — cannot find module `../../src/lyrics/subtitle-parser`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lyrics/subtitle-parser.ts
import type { TimedLine } from '../core/types'
import { parseLRC } from './lrc-parser'
import { linesFromPlainText } from '../sources/songBuilder'

const CUE_TIME = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return +h * 3600 + +m * 60 + +s + +ms / 1000
}

// Handles both SRT (comma milliseconds) and WebVTT (dot milliseconds).
function parseCueBased(text: string): TimedLine[] {
  const lines: TimedLine[] = []
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/)
  for (const block of blocks) {
    const rows = block.split('\n').map((r) => r.trim()).filter(Boolean)
    const timingIdx = rows.findIndex((r) => CUE_TIME.test(r))
    if (timingIdx === -1) continue // header/blank/index-only block
    const m = rows[timingIdx].match(CUE_TIME)!
    const startTime = toSeconds(m[1], m[2], m[3], m[4])
    const endTime = toSeconds(m[5], m[6], m[7], m[8])
    const original = rows.slice(timingIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim()
    if (original) lines.push({ startTime, endTime, original, translation: '' })
  }
  return lines
}

export function parseSubtitle(text: string, filename: string): TimedLine[] {
  const ext = filename.toLowerCase().split('.').pop()
  if (ext === 'lrc') return parseLRC(text)
  if (ext === 'srt' || ext === 'vtt') return parseCueBased(text)
  return linesFromPlainText(text)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lyrics/subtitle-parser.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/subtitle-parser.ts tests/lyrics/subtitle-parser.test.ts
git commit -m "feat: add subtitle parser (srt/vtt/lrc/plain)"
```

---

### Task 3: audioIngest.ts (ingestAudioFile)

**Files:**
- Create: `src/sources/audioIngest.ts`
- Test: `tests/sources/audioIngest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/sources/audioIngest.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const saveAudio = vi.fn()
vi.mock('../../src/core/opfs/audio', () => ({
  saveAudio: (id: string, buf: ArrayBuffer) => saveAudio(id, buf),
  audioStoragePath: (id: string) => `songs/${id}.mp3`,
}))

import { ingestAudioFile } from '../../src/sources/audioIngest'

describe('ingestAudioFile', () => {
  beforeEach(() => saveAudio.mockReset())

  it('saves the file bytes and returns a matching path', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' })
    const { songId, audioStoredPath } = await ingestAudioFile(file)
    expect(songId).toBeTruthy()
    expect(audioStoredPath).toBe(`songs/${songId}.mp3`)
    expect(saveAudio).toHaveBeenCalledTimes(1)
    expect(saveAudio.mock.calls[0][0]).toBe(songId)
    expect(saveAudio.mock.calls[0][1].byteLength).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/audioIngest.test.ts`
Expected: FAIL — cannot find module `../../src/sources/audioIngest`.

- [ ] **Step 3: Write the implementation**

```ts
// src/sources/audioIngest.ts
import { v4 as uuidv4 } from 'uuid'
import { saveAudio, audioStoragePath } from '../core/opfs/audio'

export async function ingestAudioFile(file: File): Promise<{ songId: string; audioStoredPath: string }> {
  const songId = uuidv4()
  const buffer = await file.arrayBuffer()
  await saveAudio(songId, buffer)
  return { songId, audioStoredPath: audioStoragePath(songId) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/audioIngest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/audioIngest.ts tests/sources/audioIngest.test.ts
git commit -m "feat: add ingestAudioFile (OPFS audio storage)"
```

---

### Task 4: alignmentPolicy.ts (pure decision helpers)

**Files:**
- Create: `src/player/alignmentPolicy.ts`
- Test: `tests/player/alignmentPolicy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/player/alignmentPolicy.test.ts
import { describe, it, expect } from 'vitest'
import { linesAreTimed, chooseAutoAlignment, manualAlignMode } from '../../src/player/alignmentPolicy'
import type { TimedLine } from '../../src/core/types'

const untimed: TimedLine[] = [{ startTime: 0, endTime: 0, original: 'a', translation: '' }]
const timed: TimedLine[] = [{ startTime: 0, endTime: 3, original: 'a', translation: '' }]

describe('linesAreTimed', () => {
  it('true when any line has a positive endTime', () => {
    expect(linesAreTimed(timed)).toBe(true)
    expect(linesAreTimed(untimed)).toBe(false)
    expect(linesAreTimed([])).toBe(false)
  })
})

describe('chooseAutoAlignment', () => {
  it('null without stored audio', () => {
    expect(chooseAutoAlignment(false, untimed, 'full')).toBeNull()
  })
  it('null when already timed', () => {
    expect(chooseAutoAlignment(true, timed, 'full')).toBeNull()
  })
  it('null when no lines', () => {
    expect(chooseAutoAlignment(true, [], 'full')).toBeNull()
  })
  it('auto for capable device + untimed', () => {
    expect(chooseAutoAlignment(true, untimed, 'full')).toBe('auto')
    expect(chooseAutoAlignment(true, untimed, 'lite')).toBe('auto')
  })
  it('tap for manual tier + untimed', () => {
    expect(chooseAutoAlignment(true, untimed, 'manual')).toBe('tap')
  })
})

describe('manualAlignMode', () => {
  it('maps tier to align mode', () => {
    expect(manualAlignMode('full')).toBe('auto')
    expect(manualAlignMode('manual')).toBe('tap')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player/alignmentPolicy.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```ts
// src/player/alignmentPolicy.ts
import type { TimedLine, DeviceTier } from '../core/types'

export type AlignMode = 'auto' | 'tap'

export function linesAreTimed(lines: TimedLine[]): boolean {
  return lines.some((l) => l.endTime > 0)
}

export function manualAlignMode(tier: DeviceTier): AlignMode {
  return tier === 'manual' ? 'tap' : 'auto'
}

// Decides whether the player must run alignment automatically on load.
export function chooseAutoAlignment(
  hasStoredAudio: boolean,
  lines: TimedLine[],
  tier: DeviceTier,
): AlignMode | null {
  if (!hasStoredAudio || lines.length === 0 || linesAreTimed(lines)) return null
  return manualAlignMode(tier)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/player/alignmentPolicy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/player/alignmentPolicy.ts tests/player/alignmentPolicy.test.ts
git commit -m "feat: add alignment policy helpers"
```

---

### Task 5: Refactor LinkParser to use buildSong

**Files:**
- Modify: `src/sources/LinkParser.tsx`

This is a pure refactor — the existing `tests/sources/*` and the app behavior must stay identical.

- [ ] **Step 1: Replace the inline Song assembly**

In `src/sources/LinkParser.tsx`, add the import near the other imports:

```ts
import { buildSong } from './songBuilder'
```

Replace this block:

```ts
      const song: Song = {
        id: uuidv4(),
        title: meta.title,
        artist: meta.artist,
        sourceUrl: url,
        lyrics: {
          lines,
          sourceLanguage: 'ja',
          translationLanguage: 'en',
          alignmentMode: 'manual',
        },
        createdAt: new Date(),
        isTrialSong: false,
      }
```

with:

```ts
      const song: Song = buildSong({
        title: meta.title,
        artist: meta.artist,
        sourceUrl: url,
        lines,
      })
```

The `uuidv4` import and the `Song` type import may now be unused. Remove `import { v4 as uuidv4 } from 'uuid'` if no longer referenced; keep `import type { Song } ...` (still used by `pendingSong`/`updatedSong`).

- [ ] **Step 2: Verify behavior unchanged**

Run: `npx vitest run tests/sources && npx tsc -b && npm run lint`
Expected: existing source tests pass, no TS errors, lint clean (no unused-var errors).

- [ ] **Step 3: Commit**

```bash
git add src/sources/LinkParser.tsx
git commit -m "refactor: LinkParser uses buildSong"
```

---

### Task 6: AutoAlignFlow default export (enable lazy import)

**Files:**
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx`

- [ ] **Step 1: Add a default export**

At the very end of `src/ai-pipeline/AutoAlignFlow.tsx`, after the `formatTime`/closing of the named `export function AutoAlignFlow`, add:

```ts
export default AutoAlignFlow
```

- [ ] **Step 2: Verify**

Run: `npx tsc -b`
Expected: no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/ai-pipeline/AutoAlignFlow.tsx
git commit -m "chore: add default export to AutoAlignFlow for lazy loading"
```

---

### Task 7: UploadAudioFlow component

**Files:**
- Create: `src/sources/UploadAudioFlow.tsx`
- Test: `tests/sources/UploadAudioFlow.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/sources/UploadAudioFlow.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UploadAudioFlow } from '../../src/sources/UploadAudioFlow'

vi.mock('../../src/sources/audioIngest', () => ({
  ingestAudioFile: vi.fn(async () => ({ songId: 'id1', audioStoredPath: 'songs/id1.mp3' })),
}))

describe('UploadAudioFlow', () => {
  it('renders file, title, artist inputs and the three lyric source options', () => {
    render(<UploadAudioFlow onSongReady={() => {}} />)
    expect(screen.getByPlaceholderText(/title/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/artist/i)).toBeInTheDocument()
    expect(screen.getByText(/find lyrics/i)).toBeInTheDocument()
    expect(screen.getByText(/paste lyrics/i)).toBeInTheDocument()
    expect(screen.getByText(/subtitle file/i)).toBeInTheDocument()
  })

  it('disables submit until a file and title are provided', () => {
    render(<UploadAudioFlow onSongReady={() => {}} />)
    expect(screen.getByRole('button', { name: /create song/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/UploadAudioFlow.test.tsx`
Expected: FAIL — cannot find module `../../src/sources/UploadAudioFlow`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/sources/UploadAudioFlow.tsx
import { useState } from 'react'
import { db } from '../core/db/schema'
import { ingestAudioFile } from './audioIngest'
import { buildSong, linesFromPlainText } from './songBuilder'
import { fetchLRCFromLRCLIB } from './lrclib'
import { parseLRC } from '../lyrics/lrc-parser'
import { parseSubtitle } from '../lyrics/subtitle-parser'
import type { TimedLine } from '../core/types'

type LyricSource = 'lrclib' | 'paste' | 'subtitle'

interface Props {
  onSongReady: (songId: string) => void
}

export function UploadAudioFlow({ onSongReady }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [source, setSource] = useState<LyricSource>('lrclib')
  const [pasted, setPasted] = useState('')
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  // True once an LRCLIB lookup returns nothing: forces paste/subtitle input.
  const [lrclibMissed, setLrclibMissed] = useState(false)

  async function resolveLines(): Promise<TimedLine[] | null> {
    if (source === 'paste') return linesFromPlainText(pasted)
    if (source === 'subtitle') {
      if (!subtitleFile) { setError('Choose a subtitle file or switch lyric source.'); return null }
      const text = await subtitleFile.text()
      return parseSubtitle(text, subtitleFile.name)
    }
    // lrclib
    const lrc = await fetchLRCFromLRCLIB(title, artist)
    if (lrc) return parseLRC(lrc)
    return null // signals miss
  }

  const handleSubmit = async () => {
    if (!file || !title.trim()) return
    setError('')
    setStatus('Saving audio…')
    try {
      const lines = await resolveLines()
      if (lines === null) {
        // LRCLIB miss (or unresolved) — require paste/subtitle before continuing.
        setStatus('')
        if (source === 'lrclib') {
          setLrclibMissed(true)
          setSource('paste')
          setError('No lyrics found. Paste the lyrics or attach a subtitle file so auto-align can match the audio.')
        }
        return
      }
      setStatus('Storing…')
      const { songId, audioStoredPath } = await ingestAudioFile(file)
      const song = buildSong({ id: songId, title: title.trim(), artist: artist.trim(), audioStoredPath, lines })
      await db.songs.put(song)
      setStatus('')
      onSongReady(song.id)
    } catch (e: unknown) {
      setStatus('')
      setError(e instanceof Error ? e.message : 'Upload failed')
    }
  }

  const tabClass = (s: LyricSource) =>
    `px-3 py-1.5 rounded-lg text-xs ${source === s ? 'bg-cinnabar-accent text-white' : 'bg-cinnabar-900 text-white/50'}`

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center p-6 gap-5">
      <h1 className="text-2xl font-bold text-cinnabar-accent tracking-widest">Upload audio</h1>

      <div className="w-full max-w-md space-y-3">
        <label className="block w-full px-4 py-3 bg-cinnabar-900 text-white/70 rounded-xl border border-cinnabar-800 cursor-pointer text-sm">
          {file ? file.name : 'Choose an audio file…'}
          <input type="file" accept="audio/*" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>

        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
          className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30" />
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist"
          className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30" />

        <div className="flex gap-2">
          <button className={tabClass('lrclib')} onClick={() => setSource('lrclib')} disabled={lrclibMissed}>Find lyrics (LRCLIB)</button>
          <button className={tabClass('paste')} onClick={() => setSource('paste')}>Paste lyrics</button>
          <button className={tabClass('subtitle')} onClick={() => setSource('subtitle')}>Subtitle file</button>
        </div>

        {source === 'paste' && (
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste lyrics, one line per row…"
            rows={6} className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30" />
        )}
        {source === 'subtitle' && (
          <label className="block w-full px-4 py-3 bg-cinnabar-900 text-white/70 rounded-xl border border-cinnabar-800 cursor-pointer text-sm">
            {subtitleFile ? subtitleFile.name : 'Choose a .lrc / .srt / .vtt file…'}
            <input type="file" accept=".lrc,.srt,.vtt,text/plain" className="hidden"
              onChange={(e) => setSubtitleFile(e.target.files?.[0] ?? null)} />
          </label>
        )}

        <button onClick={handleSubmit} disabled={!file || !title.trim() || !!status}
          className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40">
          {status || 'Create song'}
        </button>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/UploadAudioFlow.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sources/UploadAudioFlow.tsx tests/sources/UploadAudioFlow.test.tsx
git commit -m "feat: add UploadAudioFlow (audio + lyrics ingest)"
```

---

### Task 8: HomeScreen toggle + App wiring

**Files:**
- Create: `src/sources/HomeScreen.tsx`
- Test: `tests/sources/HomeScreen.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/sources/HomeScreen.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HomeScreen } from '../../src/sources/HomeScreen'

describe('HomeScreen', () => {
  it('shows the YouTube link flow by default and switches to upload', () => {
    render(<HomeScreen onSongReady={() => {}} />)
    expect(screen.getByPlaceholderText(/youtube link/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /upload audio/i }))
    expect(screen.getByPlaceholderText(/title/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/HomeScreen.test.tsx`
Expected: FAIL — cannot find module `../../src/sources/HomeScreen`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/sources/HomeScreen.tsx
import { useState } from 'react'
import { LinkParser } from './LinkParser'
import { UploadAudioFlow } from './UploadAudioFlow'

type Mode = 'youtube' | 'upload'

interface Props {
  onSongReady: (songId: string) => void
}

export function HomeScreen({ onSongReady }: Props) {
  const [mode, setMode] = useState<Mode>('youtube')

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col">
      <div className="flex justify-center gap-2 pt-6">
        <button
          onClick={() => setMode('youtube')}
          className={`px-4 py-1.5 rounded-full text-xs ${mode === 'youtube' ? 'bg-cinnabar-accent text-white' : 'bg-cinnabar-900 text-white/50'}`}>
          YouTube link
        </button>
        <button
          onClick={() => setMode('upload')}
          className={`px-4 py-1.5 rounded-full text-xs ${mode === 'upload' ? 'bg-cinnabar-accent text-white' : 'bg-cinnabar-900 text-white/50'}`}>
          Upload audio
        </button>
      </div>
      <div className="flex-1">
        {mode === 'youtube' ? <LinkParser onSongReady={onSongReady} /> : <UploadAudioFlow onSongReady={onSongReady} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/HomeScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire HomeScreen into App.tsx**

In `src/App.tsx`, replace the import:

```ts
import { LinkParser } from './sources/LinkParser'
```

with:

```ts
import { HomeScreen } from './sources/HomeScreen'
```

Replace the home-view return block:

```tsx
  return (
    <LinkParser
      onSongReady={(id) => {
        setSongId(id)
        setView('player')
      }}
```

with:

```tsx
  return (
    <HomeScreen
      onSongReady={(id) => {
        setSongId(id)
        setView('player')
      }}
```

(Keep the rest of that JSX — the closing `/>` and any wrapper — unchanged.)

- [ ] **Step 6: Verify**

Run: `npx tsc -b && npm run lint && npx vitest run tests/sources/HomeScreen.test.tsx`
Expected: no TS errors, lint clean, test passes.

- [ ] **Step 7: Commit**

```bash
git add src/sources/HomeScreen.tsx tests/sources/HomeScreen.test.tsx src/App.tsx
git commit -m "feat: home screen toggles YouTube link / audio upload"
```

---

### Task 9: PlayerView alignment orchestration

**Files:**
- Modify: `src/player/PlayerView.tsx`

Wires the lazy `AutoAlignFlow` and `TapSyncEditor` into the player and guarantees alignment for untimed stored-audio songs. No new test (integration-heavy; logic is covered by `alignmentPolicy` tests). Verified by typecheck + lint + production build.

- [ ] **Step 1: Add imports**

At the top of `src/player/PlayerView.tsx`, change the React import and add the new ones:

```ts
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
```

Add alongside the other imports:

```ts
import { TapSyncEditor } from './TapSyncEditor'
import { getDeviceTier } from '../ai-pipeline/capability'
import { chooseAutoAlignment, manualAlignMode, type AlignMode } from './alignmentPolicy'

const AutoAlignFlow = lazy(() => import('../ai-pipeline/AutoAlignFlow'))
```

- [ ] **Step 2: Add alignment state**

Immediately after the existing `const [showUpgrade, setShowUpgrade] = useState(false)` line, add:

```ts
  const [alignMode, setAlignMode] = useState<AlignMode | null>(null)
```

- [ ] **Step 3: Add the alignment handlers and auto-decide effect**

After the existing `seek` function (just before `const progress = position / duration`), add:

```ts
  const beginAlignment = (mode: AlignMode) => {
    if (mode === 'tap') { engine.play(); setPlaybackState('playing') }
    setAlignMode(mode)
  }

  // Guarantee alignment: when a stored-audio song loads with untimed lyrics,
  // route into auto-align (capable device) or tap-sync (no-WebGPU device).
  useEffect(() => {
    if (!song) return
    const choice = chooseAutoAlignment(!!song.audioStoredPath, song.lyrics.lines, getDeviceTier())
    if (choice) beginAlignment(choice)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song])

  const applyAlignedSong = (updated: Song) => {
    setSong(updated)
    setLines(updated.lyrics.lines)
    enrichLines(updated.lyrics.lines, updated.lyrics.sourceLanguage).then((enriched) => setLines(enriched))
    setAlignMode(null)
  }

  const handleTapComplete = async (lines: TimedLine[]) => {
    if (!song) return
    const updated: Song = { ...song, lyrics: { ...song.lyrics, lines } }
    await db.songs.put(updated)
    applyAlignedSong(updated)
  }
```

- [ ] **Step 4: Render the tap-sync editor as a full-screen step**

Just before the existing `return (` of the main render, add this early return:

```tsx
  if (song && alignMode === 'tap') {
    return (
      <TapSyncEditor
        plainLines={song.lyrics.lines.map((l) => l.original)}
        translations={song.lyrics.lines.map((l) => l.translation)}
        audioPosition={() => engine.position}
        onComplete={handleTapComplete}
      />
    )
  }
```

- [ ] **Step 5: Add the auto-align overlay and the re-align button**

Inside the main `return`, add the lazy auto-align overlay next to the existing `showUpgrade` modal block (just before the final `</div>` that closes the screen wrapper):

```tsx
      {song && alignMode === 'auto' && (
        <Suspense fallback={<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 text-white/70 text-sm">Loading AI…</div>}>
          <AutoAlignFlow
            song={song}
            onComplete={applyAlignedSong}
            onClose={() => setAlignMode(null)}
          />
        </Suspense>
      )}
```

Add a "Re-align" button for stored-audio songs. Inside the controls container (e.g. right after the A-B Loop block), add:

```tsx
        {song?.audioStoredPath && (
          <div className="flex justify-center">
            <button
              onClick={() => beginAlignment(manualAlignMode(getDeviceTier()))}
              className="text-white/30 hover:text-white/60 text-xs">
              ✨ Re-align lyrics
            </button>
          </div>
        )}
```

- [ ] **Step 6: Verify imports/types resolve**

Confirm `TimedLine` and `Song` are imported in `PlayerView.tsx` (both already are via `import type { Song, TimedLine, Language } from '../core/types'`). Then:

Run: `npx tsc -b && npm run lint`
Expected: no TS errors, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/player/PlayerView.tsx
git commit -m "feat: wire auto-align + tap-sync alignment guarantee into player"
```

---

### Task 10: Full verification + production build

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `npm run lint && npx tsc -b && npx vitest run`
Expected: lint clean, no TS errors, all tests pass (55 existing + new helper/component tests).

- [ ] **Step 2: Production build**

Run: `rm -rf dist && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Confirm the AI pipeline now bundles as lazy chunks**

Run: `ls dist/assets/*.js`
Expected: **multiple** JS chunks now exist (not just one `index-*.js`) — a worker chunk for whisper/demucs and/or a transformers chunk. Confirm the transformers code is **not** in the entry chunk:

Run: `grep -l "automatic-speech-recognition" dist/assets/index-*.js && echo "FOUND IN ENTRY (bad)" || echo "not in entry (good)"`
Expected: prints "not in entry (good)" — the ASR pipeline string lives in a lazy/worker chunk, not the entry chunk.

If no worker chunks emit (still a single chunk), the `new Worker(new URL(...))` is not being traversed — investigate before considering the task done (this is the gate called out in the spec for Vite 8 + Rolldown).

- [ ] **Step 4: Manual smoke test (optional but recommended)**

Run: `npm run preview` and in the browser: Home → "Upload audio" → pick a short audio file → paste two lines → "Create song". On a WebGPU device, the player should enter auto-align; on a non-WebGPU device, it should enter tap-sync. After completion, lyrics should highlight in time with playback.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test: verify audio-upload + auto-align build and bundling" --allow-empty
```

---

## Self-review notes

- **Spec coverage:** upload UI (Task 7), three lyric sources + LRCLIB-miss fallback (Task 7), subtitle parsing (Task 2), audio ingest (Task 3), home toggle (Task 8), alignment guarantee + tap-sync fallback + lazy AI (Tasks 4, 9), shared `buildSong` refactor (Tasks 1, 5), default export for lazy load (Task 6), verification incl. bundle check (Task 10). All spec sections map to a task.
- **Type consistency:** `AlignMode` defined in `alignmentPolicy.ts` (Task 4) and consumed in `PlayerView` (Task 9); `BuildSongInput`/`buildSong`/`linesFromPlainText` (Task 1) consumed by `subtitle-parser` (Task 2) and `UploadAudioFlow` (Task 7); `ingestAudioFile` return shape `{ songId, audioStoredPath }` consistent across Tasks 3, 7. `parseSubtitle(text, filename)` signature consistent Tasks 2, 7.
- **No placeholders:** every code/test step contains full code and exact commands.
