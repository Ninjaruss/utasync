# Edit-mode Second Language, Dedup, Tap-safe Timing, A/B by Line, Upload Autofill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add second-language editing to an existing song, hide duplicate romaji/translation lines, stop accidental timing overwrites, allow setting A/B loop points from a lyric line, and preload artist from filename on upload.

**Architecture:** Small pure helpers in `bilingual.ts` and `audioMetadata.ts` (unit-tested first), a new `SecondLanguagePanel` component owning the find→paste→align state machine, surgical edits to `EditMode`/`LyricDisplay`/`PlayerView`, and an `armingAB` flag in the zustand `PlayerStore`.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, zustand, Tailwind. Tests run with `npx vitest run`. Spec: `docs/superpowers/specs/2026-06-16-edit-mode-second-language-and-ab-design.md`.

**Conventions:**
- Tests live under `tests/` mirroring `src/`, import from `../../src/...`.
- Run a single test file: `npx vitest run tests/path/file.test.ts`.
- `TimedLine` shape: `{ original: string; startTime: number; endTime: number; translation: string; reading?: string; furigana?: string; tokens?: ...; grammarAnnotations?: ... }`.
- `Language = 'ja' | 'en'`; `detectLanguage` returns `'ja' | 'other'`.

---

## Task 1: `isSameText` helper (dedup foundation)

**Files:**
- Modify: `src/lyrics/bilingual.ts`
- Test: `tests/lyrics/bilingual.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/lyrics/bilingual.test.ts`:

```typescript
import { detectLanguage, attachSecondLanguage, isSameText } from '../../src/lyrics/bilingual'

describe('isSameText', () => {
  it('matches identical text', () => {
    expect(isSameText('Hello world', 'Hello world')).toBe(true)
  })
  it('ignores case and surrounding/inner whitespace', () => {
    expect(isSameText('  Hello   World ', 'hello world')).toBe(true)
  })
  it('treats distinct text as different', () => {
    expect(isSameText('Your eyes', '君の瞳')).toBe(false)
  })
  it('returns false when either side is empty or undefined', () => {
    expect(isSameText('', 'x')).toBe(false)
    expect(isSameText('x', undefined)).toBe(false)
    expect(isSameText(undefined, undefined)).toBe(false)
  })
})
```

(Update the existing top `import` line in the file to include `isSameText` rather than adding a duplicate import — keep one import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/bilingual.test.ts`
Expected: FAIL — `isSameText is not a function` / not exported.

- [ ] **Step 3: Implement `isSameText`**

Add to `src/lyrics/bilingual.ts`:

```typescript
/**
 * Case- and whitespace-insensitive equality used to suppress redundant display
 * lines (e.g. romaji or a "translation" that just repeats the original). Empty
 * or undefined operands are never considered equal.
 */
export function isSameText(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  return norm(a) === norm(b)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lyrics/bilingual.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/bilingual.ts tests/lyrics/bilingual.test.ts
git commit -m "feat(lyrics): add isSameText helper for redundant-line dedup"
```

---

## Task 2: Hide duplicate romaji/translation in LyricDisplay

**Files:**
- Modify: `src/lyrics/LyricDisplay.tsx`
- Test: `tests/lyrics/LyricDisplay.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/LyricDisplay.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import type { TimedLine } from '../../src/core/types'

const setStore = (lines: TimedLine[], patch: Partial<ReturnType<typeof useLyricsStore.getState>> = {}) => {
  useLyricsStore.setState({ lines, activeLine: 0, ...patch })
}

describe('LyricDisplay dedup', () => {
  beforeEach(() => {
    useLyricsStore.setState({ furiganaMode: 'romaji', showTranslation: true, lyricsLayout: 'stacked' })
  })

  it('hides romaji that merely repeats the original', () => {
    setStore([{ original: 'Hello', startTime: 0, endTime: 1, translation: '', reading: 'hello' }])
    render(<LyricDisplay onLineClick={() => {}} />)
    // "Hello" appears once (the original); the identical romaji is suppressed.
    expect(screen.getAllByText('Hello')).toHaveLength(1)
  })

  it('keeps romaji that differs from the original', () => {
    setStore([{ original: '君の瞳', startTime: 0, endTime: 1, translation: '', reading: 'kimi no hitomi' }])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getByText('kimi no hitomi')).toBeTruthy()
  })

  it('hides a translation that repeats the original', () => {
    setStore([{ original: 'Hello', startTime: 0, endTime: 1, translation: 'hello' }])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getAllByText(/hello/i)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/LyricDisplay.test.tsx`
Expected: FAIL — `onLineClick` prop not accepted yet (TS/runtime) and/or duplicate text rendered. (This task also changes the prop name; if the type error blocks the run, that's the expected failure — proceed to Step 3.)

- [ ] **Step 3: Implement dedup + prop rename**

In `src/lyrics/LyricDisplay.tsx`:

a) Update imports and `Props`:

```typescript
import { useEffect, useRef } from 'react'
import { useLyricsStore } from './LyricsStore'
import type { TimedLine, FuriganaMode } from '../core/types'
import { WordAlignment } from '../language/WordAlignment'
import { isSameText } from './bilingual'

interface Props {
  onLineClick: (line: TimedLine) => void
}
```

b) In `PrimaryText`, gate the romaji block on non-redundancy. Replace the romaji `<div>` condition:

```typescript
      {furiganaMode === 'romaji' && line.reading && !isSameText(line.reading, line.original) && (
        <div className={isActive ? 'text-sm text-cinnabar-accent/80 mt-1' : 'text-xs text-white/30 mt-0.5'}>
          {line.reading}
        </div>
      )}
```

c) In `Line`, fold the dedup into `hasTranslation`:

```typescript
  const hasTranslation = !!line.translation && !isSameText(line.translation, line.original)
```

d) Change the click handler and the `onSeek` references. Update the `Line` component signature and body:

```typescript
function Line({ line, isActive, onLineClick, lineRef }: {
  line: TimedLine
  isActive: boolean
  onLineClick: (line: TimedLine) => void
  lineRef?: React.Ref<HTMLDivElement>
}) {
```

and its wrapper `<div>`:

```typescript
      onClick={() => onLineClick(line)}
```

e) Update `LyricDisplay` to accept and forward `onLineClick`:

```typescript
export function LyricDisplay({ onLineClick }: Props) {
```

and in the `.map`:

```typescript
          <Line
            key={i}
            line={line}
            isActive={isActive}
            onLineClick={onLineClick}
            lineRef={isActive ? activeRef : undefined}
          />
```

- [ ] **Step 4: Update the PlayerView call site so the app still compiles**

In `src/player/PlayerView.tsx`, the play-mode render currently is:

```typescript
        <LyricDisplay onSeek={seek} />
```

Replace with:

```typescript
        <LyricDisplay onLineClick={(line) => seek(line.startTime)} />
```

(Task 8 will replace this lambda with A/B-aware routing.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/LyricDisplay.test.tsx`
Expected: PASS (3 tests).

Run: `npx vitest run tests/player/PlayerView.edit-toggle.test.tsx`
Expected: PASS (no regression from the prop change).

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/LyricDisplay.tsx src/player/PlayerView.tsx tests/lyrics/LyricDisplay.test.tsx
git commit -m "feat(lyrics): hide redundant romaji/translation; LyricDisplay onLineClick prop"
```

---

## Task 3: `parseFilename` helper

**Files:**
- Modify: `src/sources/audioMetadata.ts`
- Test: `tests/sources/audioMetadata.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/sources/audioMetadata.test.ts`:

```typescript
import { deriveTitle, extractAudioMetadata, parseFilename } from '../../src/sources/audioMetadata'

describe('parseFilename', () => {
  it('splits "Artist - Title.ext"', () => {
    expect(parseFilename('Radwimps - Sparkle.mp3')).toEqual({ artist: 'Radwimps', title: 'Sparkle' })
  })
  it('handles en-dash and em-dash separators', () => {
    expect(parseFilename('A – B.flac')).toEqual({ artist: 'A', title: 'B' })
    expect(parseFilename('A — B.flac')).toEqual({ artist: 'A', title: 'B' })
  })
  it('splits on the first separator only, keeping later dashes in the title', () => {
    expect(parseFilename('Artist - Title - Remix.wav')).toEqual({ artist: 'Artist', title: 'Title - Remix' })
  })
  it('returns title-only when there is no separator', () => {
    expect(parseFilename('Just A Title.mp3')).toEqual({ title: 'Just A Title' })
  })
})
```

(Update the existing top `import` line in the file to include `parseFilename`, keeping one import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/audioMetadata.test.ts`
Expected: FAIL — `parseFilename is not a function`.

- [ ] **Step 3: Implement `parseFilename`**

Add to `src/sources/audioMetadata.ts`:

```typescript
/**
 * Best-effort parse of an "Artist - Title" filename (also en/em-dash). Used as a
 * fallback when embedded tags lack an artist. Splits on the first separator so
 * dashes inside the title are preserved. No separator → title-only.
 */
export function parseFilename(filename: string): { title?: string; artist?: string } {
  const base = deriveTitle(filename)
  const m = base.match(/^(.*?)\s+[-–—]\s+(.*)$/)
  if (!m) return base ? { title: base } : {}
  const artist = m[1].trim()
  const title = m[2].trim()
  if (!artist || !title) return { title: base }
  return { artist, title }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/audioMetadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/audioMetadata.ts tests/sources/audioMetadata.test.ts
git commit -m "feat(sources): parseFilename for Artist - Title fallback"
```

---

## Task 4: Use `parseFilename` in upload autofill

**Files:**
- Modify: `src/sources/UploadAudioFlow.tsx:33-41` (handleFileChange)
- Test: `tests/sources/UploadAudioFlow.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

First open `tests/sources/UploadAudioFlow.test.tsx` to match its existing render/mock setup (it already mocks `music-metadata` and renders the component). Append a test that picks a tagless `Artist - Title.mp3` file and asserts both inputs fill. Use the file's existing helpers/mocks; the assertion shape:

```typescript
it('preloads artist and title from an "Artist - Title" filename when tags are absent', async () => {
  // Arrange: music-metadata returns no common tags (reuse this file's mock).
  // Act: fire a change on the audio file input with
  //   new File(['x'], 'Yorushika - Itte.mp3', { type: 'audio/mpeg' })
  // Assert:
  expect((screen.getByPlaceholderText('Title') as HTMLInputElement).value).toBe('Itte')
  expect((screen.getByPlaceholderText('Artist') as HTMLInputElement).value).toBe('Yorushika')
})
```

Wire the Arrange/Act using the same pattern already present in this test file for selecting an audio file and resolving the async metadata read (await a microtask / `findByDisplayValue`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/UploadAudioFlow.test.tsx`
Expected: FAIL — artist input is empty (no filename fallback yet).

- [ ] **Step 3: Implement the fallback**

In `src/sources/UploadAudioFlow.tsx`, update the import and `handleFileChange`:

```typescript
import { extractAudioMetadata, deriveTitle, parseFilename } from './audioMetadata'
```

```typescript
  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (!f) return
    const meta = await extractAudioMetadata(f)
    const fromName = parseFilename(f.name)
    // Only fill fields the user hasn't typed into. Priority: tags > filename.
    setTitle((cur) => cur || meta.title || fromName.title || deriveTitle(f.name))
    setArtist((cur) => cur || meta.artist || fromName.artist || '')
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/UploadAudioFlow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/UploadAudioFlow.tsx tests/sources/UploadAudioFlow.test.tsx
git commit -m "feat(upload): preload artist/title from filename when tags absent"
```

---

## Task 5: Tap-safe EditMode row (stop accidental timing overwrite)

**Files:**
- Modify: `src/lyrics/EditMode.tsx:51-67` (collapsed row)
- Test: `tests/lyrics/EditMode.test.tsx` (modify existing test + add one)

- [ ] **Step 1: Update the existing test to the new behavior**

The current test "stamps the playhead onto a line when its row is tapped" asserts the buggy behavior. Replace that `it(...)` block in `tests/lyrics/EditMode.test.tsx` with two tests:

```typescript
  it('stamps the playhead when the timestamp pill is tapped', () => {
    const onChangeLines = vi.fn()
    render(<EditMode lines={lines} playhead={() => 9} hasAudio onChangeLines={onChangeLines} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /set start to current time for line 2/i }))
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[1].startTime).toBe(9)
  })

  it('opens the editor (does NOT stamp) when the lyric text is tapped', () => {
    const onChangeLines = vi.fn()
    render(<EditMode lines={lines} playhead={() => 9} hasAudio onChangeLines={onChangeLines} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    fireEvent.click(screen.getByText('b'))
    // Tapping the text opens the inline editor; it must not stamp timing.
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Original text')).toBeTruthy()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/EditMode.test.tsx`
Expected: FAIL — no button named "Set start to current time…"; tapping text currently stamps.

- [ ] **Step 3: Restructure the collapsed row**

In `src/lyrics/EditMode.tsx`, replace the collapsed-row `return (...)` (the non-expanded branch, currently lines 51-67) with:

```typescript
          return (
            <div key={i} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-2">
              <button
                onClick={() => onChangeLines(stampStart(lines, i, playhead()))}
                aria-label={`Set start to current time for line ${i + 1}`}
                className="flex items-center gap-1 shrink-0 rounded-lg border border-white/15 bg-white/5 px-1.5 py-1"
              >
                <span className="text-[10px] text-white/40">⏱</span>
                <span className="text-[11px] tabular-nums text-cinnabar-accent w-9 text-center">{fmt(line.startTime, timed)}</span>
              </button>
              <button
                onClick={() => setExpanded(i)}
                className="flex-1 flex items-center gap-3 text-left"
                aria-label={`Edit line ${i + 1}`}
              >
                <span className="flex-1 text-sm text-white font-jp">
                  {line.original || <span className="text-white/30">empty</span>}
                  {!timed && <span className="ml-2 text-[10px] text-cinnabar-accent">untimed</span>}
                  {line.translation && <span className="block text-[11px] italic text-white/45">{line.translation}</span>}
                </span>
              </button>
              <button onClick={() => setExpanded(i)} aria-label={`Open editor for line ${i + 1}`} className="text-white/40 px-1 shrink-0">✎</button>
            </div>
          )
```

(The lyric text and the `✎` both open the editor; the `⏱`+time pill is the only stamp control.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/EditMode.test.tsx`
Expected: PASS (all tests, including the unchanged "untimed" and "auto-align" ones).

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/EditMode.tsx tests/lyrics/EditMode.test.tsx
git commit -m "fix(edit): tapping a lyric opens the editor; only the time pill stamps"
```

---

## Task 6: `pairsToTimedLines` shared helper + refactor LinkParser

**Files:**
- Modify: `src/lyrics/bilingual.ts`
- Modify: `src/sources/LinkParser.tsx:133-148` (handleAlignmentConfirm)
- Test: `tests/lyrics/bilingual.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/lyrics/bilingual.test.ts`:

```typescript
describe('pairsToTimedLines', () => {
  it('overlays original/translation by index, preserving existing timing', () => {
    const existing: TimedLine[] = [
      { original: '君の瞳', startTime: 1, endTime: 3, translation: '' },
      { original: '夜の中', startTime: 3, endTime: 5, translation: '' },
    ]
    const pairs = [
      { original: '君の瞳', translation: 'Your eyes' },
      { original: '夜の中', translation: 'In the night' },
    ]
    const result = pairsToTimedLines(existing, pairs)
    expect(result).toEqual([
      { original: '君の瞳', startTime: 1, endTime: 3, translation: 'Your eyes' },
      { original: '夜の中', startTime: 3, endTime: 5, translation: 'In the night' },
    ])
  })

  it('falls back to existing text when a pair is missing', () => {
    const existing: TimedLine[] = [{ original: 'a', startTime: 0, endTime: 1, translation: 'x' }]
    expect(pairsToTimedLines(existing, [])).toEqual([
      { original: 'a', startTime: 0, endTime: 1, translation: 'x' },
    ])
  })
})
```

(Add `pairsToTimedLines` to the single top import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/bilingual.test.ts`
Expected: FAIL — `pairsToTimedLines is not a function`.

- [ ] **Step 3: Implement `pairsToTimedLines`**

Add to `src/lyrics/bilingual.ts`:

```typescript
/**
 * Overlay confirmed { original, translation } pairs (from AlignmentEditor) onto
 * existing timed lines by index, preserving each line's timing and falling back
 * to existing text where a pair is absent.
 */
export function pairsToTimedLines(
  existing: TimedLine[],
  pairs: Array<{ original: string; translation: string }>,
): TimedLine[] {
  return existing.map((line, i) => ({
    ...line,
    original: pairs[i]?.original ?? line.original,
    translation: pairs[i]?.translation ?? line.translation,
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lyrics/bilingual.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor LinkParser to use the helper**

In `src/sources/LinkParser.tsx`, add to the existing `bilingual` import (it already imports `attachSecondLanguage`, `extractSecondLanguageLines`): include `pairsToTimedLines`. Then replace the body of `handleAlignmentConfirm` map:

```typescript
  const handleAlignmentConfirm = async (pairs: Array<{ original: string; translation: string }>) => {
    if (!pendingSong) return
    const updatedLines = pairsToTimedLines(pendingSong.lyrics.lines, pairs)
    const updatedSong: Song = {
      ...pendingSong,
      lyrics: { ...pendingSong.lyrics, lines: updatedLines },
    }
    await db.songs.put(updatedSong)
    setAlignmentEditorData(null)
    setPendingSong(null)
    onSongReady(updatedSong.id)
  }
```

- [ ] **Step 6: Run the LinkParser test (if present) and bilingual test**

Run: `npx vitest run tests/lyrics/bilingual.test.ts`
Expected: PASS.

Run: `npx vitest run tests/sources` 
Expected: PASS (LinkParser behavior unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/lyrics/bilingual.ts src/sources/LinkParser.tsx tests/lyrics/bilingual.test.ts
git commit -m "refactor(lyrics): extract pairsToTimedLines; reuse in LinkParser"
```

---

## Task 7: `SecondLanguagePanel` component

**Files:**
- Create: `src/lyrics/SecondLanguagePanel.tsx`
- Test: `tests/lyrics/SecondLanguagePanel.test.tsx` (create)

**Behavior:** On mount, call `findSecondLanguageLyrics`. Render phases: `searching`, `confirm` (count match), `align` (count mismatch, hosts AlignmentEditor in a modal), `paste` (no result or "use different"). `onApply` commits the final `TimedLine[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/lyrics/SecondLanguagePanel.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SecondLanguagePanel } from '../../src/lyrics/SecondLanguagePanel'
import type { TimedLine } from '../../src/core/types'

const findMock = vi.fn()
vi.mock('../../src/sources/lrclib', () => ({
  findSecondLanguageLyrics: (...a: unknown[]) => findMock(...a),
}))

const primary: TimedLine[] = [
  { original: '君の瞳', startTime: 1, endTime: 3, translation: '' },
  { original: '夜の中', startTime: 3, endTime: 5, translation: '' },
]

beforeEach(() => findMock.mockReset())

describe('SecondLanguagePanel', () => {
  it('auto-finds and shows a confirm banner when counts match', async () => {
    findMock.mockResolvedValue({ lrc: 'Your eyes\nIn the night', synced: false })
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText(/found translation/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /looks good/i })).toBeTruthy()
  })

  it('applies the matched translation on "Looks good"', async () => {
    findMock.mockResolvedValue({ lrc: 'Your eyes\nIn the night', synced: false })
    const onApply = vi.fn()
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={onApply} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /looks good/i }))
    const applied = onApply.mock.calls[0][0] as TimedLine[]
    expect(applied[0].translation).toBe('Your eyes')
    expect(applied[1].translation).toBe('In the night')
    expect(applied[0].startTime).toBe(1) // timing preserved
  })

  it('falls back to a paste box when nothing is found', async () => {
    findMock.mockResolvedValue(null)
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByPlaceholderText(/paste/i)).toBeTruthy()
  })

  it('shows the alignment editor when pasted line count differs', async () => {
    findMock.mockResolvedValue(null)
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    const box = await screen.findByPlaceholderText(/paste/i)
    fireEvent.change(box, { target: { value: 'only one line' } })
    fireEvent.click(screen.getByRole('button', { name: /attach/i }))
    expect(await screen.findByText(/align lines/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/SecondLanguagePanel.test.tsx`
Expected: FAIL — module `SecondLanguagePanel` does not exist.

- [ ] **Step 3: Implement the component**

Create `src/lyrics/SecondLanguagePanel.tsx`:

```typescript
import { useEffect, useState } from 'react'
import type { TimedLine, Language } from '../core/types'
import { attachSecondLanguage, extractSecondLanguageLines, pairsToTimedLines } from './bilingual'
import { findSecondLanguageLyrics } from '../sources/lrclib'
import { AlignmentEditor } from './AlignmentEditor'

interface Props {
  lines: TimedLine[]
  title: string
  artist: string
  sourceLanguage: Language
  onApply: (lines: TimedLine[]) => void
  onClose: () => void
}

type Phase =
  | { kind: 'searching' }
  | { kind: 'confirm'; paired: TimedLine[]; secondary: string }
  | { kind: 'align'; secondary: string }
  | { kind: 'paste' }

export function SecondLanguagePanel({ lines, title, artist, sourceLanguage, onApply, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'searching' })
  const [pasted, setPasted] = useState('')

  // Route a secondary block to confirm (counts match) or align (counts differ).
  const route = (secondary: string) => {
    const { lines: paired, needsAlignment } = attachSecondLanguage(lines, secondary)
    setPhase(needsAlignment ? { kind: 'align', secondary } : { kind: 'confirm', paired, secondary })
  }

  useEffect(() => {
    let cancelled = false
    // findSecondLanguageLyrics expects 'ja' | 'other'; Song stores 'ja' | 'en'.
    const primaryLang = sourceLanguage === 'ja' ? 'ja' : 'other'
    findSecondLanguageLyrics(title, artist, primaryLang).then((found) => {
      if (cancelled) return
      if (found) route(found.lrc)
      else setPhase({ kind: 'paste' })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase.kind === 'align') {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-cinnabar-950">
        <AlignmentEditor
          originalLines={lines.map((l) => l.original)}
          translationLines={extractSecondLanguageLines(phase.secondary)}
          onConfirm={(pairs) => { onApply(pairsToTimedLines(lines, pairs)); onClose() }}
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-cinnabar-950 border border-cinnabar-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold">Second language</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/40 px-2">✕</button>
        </div>

        {phase.kind === 'searching' && (
          <p className="text-white/50 text-sm py-6 text-center">Searching LRCLIB…</p>
        )}

        {phase.kind === 'confirm' && (
          <div className="space-y-3">
            <p className="text-white/70 text-sm">Found translation from LRCLIB — does it look right?</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { onApply(phase.paired); onClose() }}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-accent text-white text-sm">Looks good</button>
              <button onClick={() => setPhase({ kind: 'align', secondary: phase.secondary })}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-900 text-white/70 text-sm">Fix pairings</button>
              <button onClick={() => setPhase({ kind: 'paste' })}
                className="px-3 py-1.5 rounded-lg bg-cinnabar-900 text-white/70 text-sm">Use different / paste</button>
            </div>
          </div>
        )}

        {phase.kind === 'paste' && (
          <div className="space-y-3">
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Paste second-language lyrics or an LRC block, one line per row…"
              rows={6}
              className="w-full px-3 py-2 bg-cinnabar-900 text-white text-sm rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30 font-jp"
            />
            <button
              onClick={() => pasted.trim() && route(pasted)}
              disabled={!pasted.trim()}
              className="w-full py-2 rounded-xl bg-cinnabar-accent text-white text-sm font-medium disabled:opacity-40"
            >
              Attach
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/SecondLanguagePanel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/SecondLanguagePanel.tsx tests/lyrics/SecondLanguagePanel.test.tsx
git commit -m "feat(lyrics): SecondLanguagePanel (auto-find, confirm, paste, align)"
```

---

## Task 8: Wire SecondLanguagePanel into EditMode + PlayerView

**Files:**
- Modify: `src/lyrics/EditMode.tsx` (props + footer button + panel)
- Modify: `src/player/PlayerView.tsx:276-284` (pass new props)
- Test: `tests/lyrics/EditMode.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/lyrics/EditMode.test.tsx`. Note all existing tests must now pass the new required props; add them to each render OR (simpler) add a helper. Add this test and ensure it passes the new props:

```typescript
import { vi as _vi } from 'vitest'

// Keep the LRCLIB lookup from firing in this unit test.
vi.mock('../../src/sources/lrclib', () => ({
  findSecondLanguageLyrics: () => new Promise(() => {}), // never resolves
}))

it('opens the second-language panel from the footer button', async () => {
  render(
    <EditMode
      lines={lines}
      playhead={() => 0}
      hasAudio
      onChangeLines={vi.fn()}
      onTapThrough={vi.fn()}
      onAutoAlign={vi.fn()}
      title="t"
      artist="a"
      sourceLanguage="ja"
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /2nd language/i }))
  expect(await screen.findByText(/searching lrclib/i)).toBeTruthy()
})
```

Also update every existing `render(<EditMode ... />)` call in this file to include `title="t" artist="a" sourceLanguage="ja"` (the new required props), so the file type-checks.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/EditMode.test.tsx`
Expected: FAIL — `EditMode` does not accept `title`/`artist`/`sourceLanguage`; no "2nd language" button.

- [ ] **Step 3: Update EditMode**

In `src/lyrics/EditMode.tsx`:

a) Imports + `useState`:

```typescript
import { useState } from 'react'
import type { TimedLine, Language } from '../core/types'
import { LineEditor } from './LineEditor'
import { stampStart, setText, addLine, deleteLine } from './lineOps'
import { SecondLanguagePanel } from './SecondLanguagePanel'
```

b) Props:

```typescript
interface Props {
  lines: TimedLine[]
  playhead: () => number
  /** Active provider exposes a waveform (YouTube/upload) → Auto-align allowed. */
  hasAudio: boolean
  title: string
  artist: string
  sourceLanguage: Language
  onChangeLines: (lines: TimedLine[]) => void
  onTapThrough: () => void
  onAutoAlign: () => void
}
```

c) Destructure + panel state at the top of the component:

```typescript
export function EditMode({ lines, playhead, hasAudio, title, artist, sourceLanguage, onChangeLines, onTapThrough, onAutoAlign }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [showSecondLang, setShowSecondLang] = useState(false)
  const hasSecondLang = lines.some((l) => l.translation)
```

d) Add a button to the footer controls row. In the `<div className="flex gap-2 p-3 border-t ...">`, add as the last child (after "Add line"):

```typescript
        <button
          onClick={() => setShowSecondLang(true)}
          className="flex-1 text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85"
        >
          {hasSecondLang ? '↻ Replace 2nd language' : '＋ 2nd language'}
        </button>
```

e) Render the panel. Just before the component's final closing `</div>` (the outermost wrapper), add:

```typescript
      {showSecondLang && (
        <SecondLanguagePanel
          lines={lines}
          title={title}
          artist={artist}
          sourceLanguage={sourceLanguage}
          onApply={(next) => onChangeLines(next)}
          onClose={() => setShowSecondLang(false)}
        />
      )}
```

- [ ] **Step 4: Pass props from PlayerView**

In `src/player/PlayerView.tsx`, update the `<EditMode .../>` render:

```typescript
        <EditMode
          lines={lines}
          playhead={() => (isYouTube ? position : engine.position)}
          hasAudio={hasAudio}
          title={song?.title ?? ''}
          artist={song?.artist ?? ''}
          sourceLanguage={song?.lyrics.sourceLanguage ?? 'ja'}
          onChangeLines={handleEditLines}
          onTapThrough={() => beginAlignment('tap')}
          onAutoAlign={() => beginAlignment('auto')}
        />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/EditMode.test.tsx`
Expected: PASS (all, including the new panel test).

Run: `npx vitest run tests/player/PlayerView.edit-toggle.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/EditMode.tsx src/player/PlayerView.tsx tests/lyrics/EditMode.test.tsx
git commit -m "feat(edit): add/replace second language while editing a song"
```

---

## Task 9: A/B arming state in PlayerStore

**Files:**
- Modify: `src/player/PlayerStore.ts`
- Test: `tests/player/PlayerStore.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/player/PlayerStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { usePlayerStore } from '../../src/player/PlayerStore'

describe('PlayerStore A/B arming', () => {
  beforeEach(() => usePlayerStore.setState({ armingAB: null, abLoop: { a: null, b: null, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 } }))

  it('arms an endpoint', () => {
    usePlayerStore.getState().armAB('a')
    expect(usePlayerStore.getState().armingAB).toBe('a')
  })

  it('clears arming when an endpoint is set', () => {
    usePlayerStore.getState().armAB('b')
    usePlayerStore.getState().setABLoop({ b: 12 })
    expect(usePlayerStore.getState().abLoop.b).toBe(12)
    expect(usePlayerStore.getState().armingAB).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player/PlayerStore.test.ts`
Expected: FAIL — `armAB is not a function`.

- [ ] **Step 3: Implement arming state**

In `src/player/PlayerStore.ts`:

a) Add to the `PlayerState` interface:

```typescript
  armingAB: 'a' | 'b' | null
  armAB: (which: 'a' | 'b' | null) => void
```

b) Initial value (add to the object returned by the store factory):

```typescript
      armingAB: null,
```

c) `armAB` action and clear-on-set. Replace `setABLoop` and add `armAB`:

```typescript
      setABLoop: (loop) => set((s) => ({ abLoop: { ...s.abLoop, ...loop }, armingAB: null })),
      armAB: (armingAB) => set({ armingAB }),
```

d) Exclude `armingAB` from persistence (a stuck armed state shouldn't survive reload). Update the `persist` options:

```typescript
    {
      name: 'utasync-player',
      partialize: (s) => ({
        currentSongId: s.currentSongId,
        position: s.position,
        speed: s.speed,
        abLoop: s.abLoop,
      }),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/player/PlayerStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/player/PlayerStore.ts tests/player/PlayerStore.test.ts
git commit -m "feat(player): armingAB state for setting A/B from a lyric line"
```

---

## Task 10: A/B long-press + line routing in PlayerView

**Files:**
- Modify: `src/player/PlayerView.tsx` (A/B buttons, LyricDisplay click routing, store wiring)
- Test: manual + existing PlayerView test stays green (logic is UI-timing heavy; covered by store test in Task 9 + manual verification).

- [ ] **Step 1: Wire `armingAB` into the store destructure**

In `src/player/PlayerView.tsx`, add `armingAB, armAB` to the `usePlayerStore()` destructure (line ~62):

```typescript
  const { playbackState, position, speed, abLoop, armingAB, currentSongId, setPlaybackState, setPosition, setSpeed, setABLoop, armAB, setCurrentSong } = usePlayerStore()
```

- [ ] **Step 2: Route lyric-line clicks through A/B**

Replace the play-mode `LyricDisplay` render (set in Task 2 to `onLineClick={(line) => seek(line.startTime)}`):

```typescript
        <LyricDisplay onLineClick={(line) => {
          if (armingAB) setABLoop({ [armingAB]: line.startTime })
          else seek(line.startTime)
        }} />
```

- [ ] **Step 3: Add a long-press hook for the A/B buttons**

Add this small helper near the top of `src/player/PlayerView.tsx` (module scope, after imports):

```typescript
/**
 * Distinguishes a tap from a long-press on a single element. A press held past
 * `ms` (default 500) without dragging fires `onLongPress`; a quick release fires
 * `onTap`. Movement beyond a few px cancels (so it never fights list scrolling).
 */
function useLongPress(onTap: () => void, onLongPress: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)
  const start = (e: React.PointerEvent) => {
    fired.current = false
    const x0 = e.clientX, y0 = e.clientY
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 8 || Math.abs(ev.clientY - y0) > 8) cancel()
    }
    window.addEventListener('pointermove', move)
    const cancel = () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null }
      window.removeEventListener('pointermove', move)
    }
    ;(start as unknown as { cancel?: () => void }).cancel = cancel
    timer.current = setTimeout(() => { fired.current = true; cancel(); onLongPress() }, ms)
  }
  const end = () => {
    const cancel = (start as unknown as { cancel?: () => void }).cancel
    cancel?.()
    if (!fired.current) onTap()
  }
  return { onPointerDown: start, onPointerUp: end, onPointerLeave: () => {
    const cancel = (start as unknown as { cancel?: () => void }).cancel
    cancel?.()
  } }
}
```

Note: `useRef` is already imported in PlayerView. If a simpler approach is preferred during implementation, an inline `onPointerDown`/`onPointerUp` timer in the component body is acceptable — the requirement is: tap = set-from-position, long-press = arm.

- [ ] **Step 4: Apply long-press to the A and B buttons**

In the component body, before the `return`, create the handlers:

```typescript
  const aPress = useLongPress(() => setABLoop({ a: position }), () => armAB('a'))
  const bPress = useLongPress(() => setABLoop({ b: position }), () => armAB('b'))
```

Replace the A and B buttons in the A-B Loop controls block:

```typescript
            <button {...aPress}
              className={`px-3 py-1 rounded-full border ${armingAB === 'a' ? 'border-cinnabar-accent text-cinnabar-accent animate-pulse' : abLoop.a !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
              A {abLoop.a !== null ? formatTime(abLoop.a) : '—'}
            </button>
            <button {...bPress}
              className={`px-3 py-1 rounded-full border ${armingAB === 'b' ? 'border-cinnabar-accent text-cinnabar-accent animate-pulse' : abLoop.b !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
              B {abLoop.b !== null ? formatTime(abLoop.b) : '—'}
            </button>
```

- [ ] **Step 5: Add the "tap a line" hint**

Directly under the A-B controls `<div className="flex gap-3 justify-center text-xs">...</div>`, add:

```typescript
            {armingAB && (
              <p className="w-full text-center text-[11px] text-cinnabar-accent/80 animate-pulse">
                Tap a lyric line to set {armingAB.toUpperCase()}
              </p>
            )}
```

(Place it as a sibling inside the `isProUser` branch, after the controls row, wrapping both in a fragment or column container as needed so layout stays valid.)

- [ ] **Step 6: Verify compile + existing tests**

Run: `npx vitest run tests/player`
Expected: PASS (PlayerStore + edit-toggle).

Run: `npx vitest run` (full suite)
Expected: PASS.

Run: `npm run build`
Expected: `tsc -b` + vite build succeed (no type errors).

- [ ] **Step 7: Commit**

```bash
git add src/player/PlayerView.tsx
git commit -m "feat(player): long-press A/B to arm, tap a lyric line to set the endpoint"
```

---

## Task 11: Full verification

- [ ] **Step 1: Run the complete test suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev`, then verify:
- Edit a song → tap a lyric's text opens the editor; the time pill stamps. No accidental overwrite.
- Edit footer → "＋ 2nd language" → searching → confirm banner OR paste fallback → applied translation appears.
- An English song no longer shows romaji/translation duplicates of the English line.
- Upload a tagless `Artist - Title.mp3` → both Title and Artist preload.
- Pro user: long-press A (pulses) → tap a lyric line → A snaps to that line's time; same for B.

- [ ] **Step 4: Final commit (if any tweaks)**

```bash
git add -A
git commit -m "test: full-suite verification for edit-mode 2nd language + A/B by line"
```

---

## Self-Review Notes

- **Spec coverage:** item 1 → Tasks 6,7,8; item 2 → Task 5; item 3 → Tasks 1,2; item 4 → Tasks 9,10; item 5 → Tasks 3,4. All covered.
- **Type consistency:** `onLineClick(line: TimedLine)` introduced in Task 2 and consumed in Task 10; `armingAB`/`armAB` defined in Task 9 and used in Task 10; `pairsToTimedLines` defined in Task 6, used in Tasks 6 (LinkParser) and 7 (SecondLanguagePanel); `SecondLanguagePanel` props match between Tasks 7 and 8.
- **Ordering:** helpers (1,3,6) precede their consumers (2,4,7); LyricDisplay prop rename (Task 2) updates the PlayerView call site immediately to keep the build green before A/B routing (Task 10).
