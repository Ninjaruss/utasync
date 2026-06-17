# Edit-Mode UI Cleanup & Word-Pair Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declutter Edit mode, gate destructive actions behind confirmation, streamline A/B loop and speed in Play mode, fix the YouTube Auto-align dead end, reduce second-language pairing false-mismatches via header-stripping and stanza-block scoping, consolidate second-language management into `SecondLanguagePanel`, and add on-device word-pair color coding (with a dedicated particle color) between original and translated lyrics.

**Architecture:** Two specs combined into one plan, implemented bottom-up: shared pure helpers first (`bilingual.ts`, `wordAligner.ts`, `wordColors.ts`), then the components/screens that consume them (`EditMode`, `LinkParser`, `UploadAudioFlow`, `SecondLanguagePanel`, `PlayerView`, `LyricDisplay`). Word-pair alignment reuses the existing but unused `Token.alignmentIndices` field (no new schema) rather than the unused song-level `LyricsData.alignment`/`WordAlignment` types, since the working `LyricsStore` only threads flat `TimedLine[]`, not the wrapping `LyricsData` — per-token storage fits the existing data flow with zero new plumbing.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, Zustand, `@xenova/transformers` (already a dependency, used the same way as the existing Whisper/Demucs workers) for the on-device embedding model.

---

## Source specs

- `docs/superpowers/specs/2026-06-17-edit-ui-cleanup-and-alignment-design.md`
- `docs/superpowers/specs/2026-06-17-word-pair-alignment-design.md`

## Implementation note on second-language block alignment

The spec's stanza-block design is implemented **conservatively**: flat (whole-list) index pairing is tried first, exactly as today. Block decomposition only engages when flat counts mismatch AND both primary and secondary independently detect 2+ blocks of matching count — otherwise it falls back to today's single-whole-song-mismatch behavior. This keeps 100% of existing passing-count behavior (including the existing "blank lines are noise, not stanza breaks" test) unchanged, and only adds value for genuine multi-stanza count mismatches.

---

### Task 1: `bilingual.ts` — header stripping + block-scoped second-language pairing

**Files:**
- Modify: `src/lyrics/bilingual.ts`
- Test: `tests/lyrics/bilingual.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the `attachSecondLanguage` describe block and add two new describe blocks in `tests/lyrics/bilingual.test.ts` (keep `detectLanguage`, `isSameText`, `hasVisibleTranslation`, `pairsToTimedLines` blocks unchanged):

```typescript
import { describe, it, expect } from 'vitest'
import {
  detectLanguage, attachSecondLanguage, isSameText, pairsToTimedLines,
  hasVisibleTranslation, stripNonLyricLines, extractSecondLanguageBlocks,
} from '../../src/lyrics/bilingual'
import type { TimedLine } from '../../src/core/types'

const line = (original: string, startTime = 0, endTime = 0, translation = ''): TimedLine =>
  ({ original, startTime, endTime, translation })

describe('stripNonLyricLines', () => {
  it('removes bracketed and parenthesized headers', () => {
    expect(stripNonLyricLines(['[Chorus]', 'Real line', '(x2)', 'Another line']))
      .toEqual(['Real line', 'Another line'])
  })
  it('removes bare section labels', () => {
    expect(stripNonLyricLines(['Verse 1', 'A line', 'Chorus', 'Bridge:', 'Last line']))
      .toEqual(['A line', 'Last line'])
  })
  it('leaves real lyrics alone', () => {
    expect(stripNonLyricLines(['Your eyes', 'In the night'])).toEqual(['Your eyes', 'In the night'])
  })
})

describe('extractSecondLanguageBlocks', () => {
  it('groups plain text into blank-line-delimited blocks, stripping headers per block', () => {
    const text = '[Verse 1]\nYour eyes\nIn the night\n\n[Chorus]\nShine on\nForever'
    expect(extractSecondLanguageBlocks(text)).toEqual([
      ['Your eyes', 'In the night'],
      ['Shine on', 'Forever'],
    ])
  })
  it('collapses multiple consecutive blank lines into one separator', () => {
    const text = 'A\nB\n\n\n\nC\nD'
    expect(extractSecondLanguageBlocks(text)).toEqual([['A', 'B'], ['C', 'D']])
  })
  it('treats an LRC block as a single block', () => {
    const lrc = '[00:01.00]Your eyes\n[00:03.00]In the night'
    expect(extractSecondLanguageBlocks(lrc)).toEqual([['Your eyes', 'In the night']])
  })
})

describe('attachSecondLanguage', () => {
  const primary: TimedLine[] = [line('君の瞳', 1, 3), line('夜の中', 3, 5)]

  it('pairs plain second-language text by index', () => {
    const result = attachSecondLanguage(primary, 'Your eyes\nIn the night')
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
    expect(result.lines[0].original).toBe('君の瞳')
    expect(result.lines[0].startTime).toBe(1)
    expect(result.mismatchedBlocks).toEqual([])
  })

  it('pairs a synced second-language LRC by timestamp', () => {
    const lrc = '[00:01.00]Your eyes\n[00:03.00]In the night'
    const result = attachSecondLanguage(primary, lrc)
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
    expect(result.mismatchedBlocks).toEqual([])
  })

  it('flags a single whole-song mismatch when line counts differ and no block structure is detected', () => {
    const result = attachSecondLanguage(primary, 'Only one line')
    expect(result.mismatchedBlocks).toEqual([0])
    expect(result.lines.length).toBe(primary.length)
  })

  it('ignores blank lines in the pasted block when counts already match', () => {
    const result = attachSecondLanguage(primary, 'Your eyes\n\n\nIn the night\n')
    expect(result.mismatchedBlocks).toEqual([])
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
  })

  it('strips header lines before counting, turning a false mismatch into a clean match', () => {
    const result = attachSecondLanguage(primary, '[Verse]\nYour eyes\nIn the night')
    expect(result.mismatchedBlocks).toEqual([])
    expect(result.lines.map((l) => l.translation)).toEqual(['Your eyes', 'In the night'])
  })

  it('scopes a mismatch to one stanza block when both sides have matching multi-block structure', () => {
    // Primary: two stanzas with a >4s gap between them (stanza boundary).
    const multiStanzaPrimary: TimedLine[] = [
      line('一行目', 0, 2), line('二行目', 2, 4),
      line('三行目', 10, 12), line('四行目', 12, 14),
    ]
    // Secondary: stanza 1 matches (2 lines), stanza 2 is merged into one line.
    const secondary = 'Line one\nLine two\n\nLines three and four merged'
    const result = attachSecondLanguage(multiStanzaPrimary, secondary)
    expect(result.mismatchedBlocks).toEqual([1])
    expect(result.lines[0].translation).toBe('Line one')
    expect(result.lines[1].translation).toBe('Line two')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/bilingual.test.ts`
Expected: FAIL — `stripNonLyricLines`, `extractSecondLanguageBlocks` not exported; `mismatchedBlocks` undefined on `AttachResult`.

- [ ] **Step 3: Implement in `src/lyrics/bilingual.ts`**

Replace the `AttachResult` interface and `attachSecondLanguage` function (keep everything else in the file — `isSameText`, `hasVisibleTranslation`, `detectLanguage`, `extractSecondLanguageLines`, `pairsToTimedLines` — unchanged):

```typescript
const GAP_THRESHOLD_S = 4

// Common non-lyric annotation lines that show up in pasted/LRCLIB text but
// aren't actually sung — stripping them before counting avoids false
// line-count mismatches.
const HEADER_RE = /^(\[.*\]|\(.*\))$|^(verse\s*\d*|chorus|bridge|intro|outro|hook)[:.]?$/i

export function stripNonLyricLines(lines: string[]): string[] {
  return lines.filter((l) => !HEADER_RE.test(l.trim()))
}

/** Split raw second-language text into blank-line-delimited stanza blocks, header-stripped. */
export function extractSecondLanguageBlocks(secondary: string): string[][] {
  if (LRC_TIMESTAMP_RE.test(secondary)) {
    return [stripNonLyricLines(extractSecondLanguageLines(secondary))]
  }
  const blocks: string[][] = []
  let current: string[] = []
  for (const raw of secondary.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) {
      if (current.length) { blocks.push(stripNonLyricLines(current)); current = [] }
      continue
    }
    current.push(trimmed)
  }
  if (current.length) blocks.push(stripNonLyricLines(current))
  return blocks.filter((b) => b.length > 0)
}

/** Split already-timed primary lines into stanza blocks using gaps between line starts as a proxy for blank-line stanza breaks (which don't survive into TimedLine[]). Untimed primary stays a single block. */
function splitPrimaryIntoBlocks(primary: TimedLine[]): TimedLine[][] {
  if (!primary.some((l) => l.endTime > 0)) return [primary]
  const blocks: TimedLine[][] = []
  let current: TimedLine[] = []
  for (let i = 0; i < primary.length; i++) {
    current.push(primary[i])
    const next = primary[i + 1]
    if (next && next.startTime - primary[i].startTime > GAP_THRESHOLD_S) {
      blocks.push(current)
      current = []
    }
  }
  if (current.length) blocks.push(current)
  return blocks
}

export interface AttachResult {
  lines: TimedLine[]
  /** Indices into the detected stanza blocks whose line counts didn't match — these need manual review. Empty when everything paired cleanly. */
  mismatchedBlocks: number[]
}

/**
 * Attach a second-language block onto the primary timed lines' `translation`
 * field, preserving primary timing/text. Tries a flat whole-song index pairing
 * first (today's behavior, unaffected by header-stripping when counts already
 * matched). Only when flat counts mismatch does it attempt to localize the
 * mismatch to specific stanza blocks — and only when both sides independently
 * show 2+ blocks of equal count, so a single stray blank line never fragments
 * an otherwise-clean pairing.
 */
export function attachSecondLanguage(primary: TimedLine[], secondary: string): AttachResult {
  const flatSecondary = stripNonLyricLines(extractSecondLanguageLines(secondary))

  if (flatSecondary.length === primary.length) {
    const lines = primary.map((line, i) => ({ ...line, translation: flatSecondary[i] ?? '' }))
    return { lines, mismatchedBlocks: [] }
  }

  const primaryBlocks = splitPrimaryIntoBlocks(primary)
  const secondaryBlocks = extractSecondLanguageBlocks(secondary)

  if (primaryBlocks.length !== secondaryBlocks.length || primaryBlocks.length <= 1) {
    const lines = primary.map((line, i) => ({ ...line, translation: flatSecondary[i] ?? '' }))
    return { lines, mismatchedBlocks: [0] }
  }

  const mismatchedBlocks: number[] = []
  const lines: TimedLine[] = []
  for (let b = 0; b < primaryBlocks.length; b++) {
    const pBlock = primaryBlocks[b]
    const sBlock = secondaryBlocks[b] ?? []
    if (sBlock.length !== pBlock.length) mismatchedBlocks.push(b)
    for (let i = 0; i < pBlock.length; i++) {
      lines.push({ ...pBlock[i], translation: sBlock[i] ?? '' })
    }
  }
  return { lines, mismatchedBlocks }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/bilingual.test.ts`
Expected: PASS (all describe blocks)

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/bilingual.ts tests/lyrics/bilingual.test.ts
git commit -m "feat: header-strip and block-scope second-language pairing in attachSecondLanguage"
```

---

### Task 2: `SecondLanguagePanel.tsx` — consume block-scoped `AttachResult`

**Files:**
- Modify: `src/lyrics/SecondLanguagePanel.tsx:27-30`
- Test: `tests/lyrics/SecondLanguagePanel.test.tsx`

- [ ] **Step 1: Update the failing assertion(s)**

Open `tests/lyrics/SecondLanguagePanel.test.tsx` and find the test asserting the mismatch→align routing (it currently mocks `attachSecondLanguage` or relies on real line-count mismatch to produce `needsAlignment: true`). Since `attachSecondLanguage`'s return shape changed (`needsAlignment` boolean → `mismatchedBlocks: number[]`), no test code changes are needed if the existing test triggers the route via a real mismatched paste (the component reads `result.mismatchedBlocks.length > 0`, which is internal) — but if any test directly asserts on `attachSecondLanguage`'s return shape via a mock, update it. Run the suite first to see current status:

Run: `npx vitest run tests/lyrics/SecondLanguagePanel.test.tsx`
Expected: FAIL — `route` in the component still reads `.needsAlignment` which is now `undefined` (always falsy), so the align-on-mismatch test fails because it never routes to `align`.

- [ ] **Step 2: Fix the component**

In `src/lyrics/SecondLanguagePanel.tsx`, replace:

```typescript
  const route = (secondary: string) => {
    const { lines: paired, needsAlignment } = attachSecondLanguage(lines, secondary)
    setPhase(needsAlignment ? { kind: 'align', secondary } : { kind: 'confirm', paired, secondary })
  }
```

with:

```typescript
  const route = (secondary: string) => {
    const { lines: paired, mismatchedBlocks } = attachSecondLanguage(lines, secondary)
    setPhase(mismatchedBlocks.length > 0 ? { kind: 'align', secondary } : { kind: 'confirm', paired, secondary })
  }
```

No other changes needed — the `align` phase already passes `lines.map((l) => l.original)` and `extractSecondLanguageLines(phase.secondary)` into `AlignmentEditor`, which is unaffected by this change.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/SecondLanguagePanel.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lyrics/SecondLanguagePanel.tsx tests/lyrics/SecondLanguagePanel.test.tsx
git commit -m "fix: SecondLanguagePanel routes on mismatchedBlocks instead of removed needsAlignment"
```

---

### Task 3: `LinkParser.tsx` — remove second-language pause state, add optional audio attach, silent clean-match auto-attach

**Files:**
- Modify: `src/sources/LinkParser.tsx` (full rewrite of component body)
- Test: `tests/sources/LinkParser.test.tsx` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/sources/LinkParser.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LinkParser } from '../../src/sources/LinkParser'
import { db } from '../../src/core/db/schema'

vi.mock('../../src/sources/youtube', () => ({
  fetchYouTubeMeta: vi.fn(async () => ({ title: 'Test Song', artist: 'Test Artist' })),
  extractVideoId: vi.fn(() => 'abc123'),
}))

vi.mock('../../src/sources/lrclib', () => ({
  findLyrics: vi.fn(async () => ({ lrc: 'Line one\nLine two', synced: false })),
  findSecondLanguageLyrics: vi.fn(async () => null),
}))

beforeEach(async () => {
  await db.songs.clear()
})

describe('LinkParser', () => {
  it('creates a song immediately with no second-language prompt when none is found', async () => {
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    fireEvent.click(screen.getByText('Get Lyrics'))
    await waitFor(() => expect(onSongReady).toHaveBeenCalled())
    expect(screen.queryByText(/paste a second/i)).not.toBeInTheDocument()
  })

  it('auto-attaches a translation silently when found and counts match', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    vi.mocked(lrclib.findSecondLanguageLyrics).mockResolvedValueOnce({ lrc: 'Translated one\nTranslated two' })
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    fireEvent.click(screen.getByText('Get Lyrics'))
    await waitFor(() => expect(onSongReady).toHaveBeenCalled())
    const songId = onSongReady.mock.calls[0][0]
    const song = await db.songs.get(songId)
    expect(song?.lyrics.lines.map((l) => l.translation)).toEqual(['Translated one', 'Translated two'])
  })

  it('skips a mismatched translation silently, opening with primary lines only', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    vi.mocked(lrclib.findSecondLanguageLyrics).mockResolvedValueOnce({ lrc: 'Only one translated line' })
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    fireEvent.click(screen.getByText('Get Lyrics'))
    await waitFor(() => expect(onSongReady).toHaveBeenCalled())
    const songId = onSongReady.mock.calls[0][0]
    const song = await db.songs.get(songId)
    expect(song?.lyrics.lines.map((l) => l.translation)).toEqual(['', ''])
  })

  it('attaches uploaded audio to the built song when provided', async () => {
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    const file = new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' })
    const fileInput = screen.getByLabelText(/attach audio/i).querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByText('Get Lyrics'))
    await waitFor(() => expect(onSongReady).toHaveBeenCalled())
    const songId = onSongReady.mock.calls[0][0]
    const song = await db.songs.get(songId)
    expect(song?.audioStoredPath).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sources/LinkParser.test.tsx`
Expected: FAIL — current component still has the second-language textarea/pending flow and no audio-attach input.

- [ ] **Step 3: Rewrite `src/sources/LinkParser.tsx`**

```typescript
import { useState, type ChangeEvent } from 'react'
import { fetchYouTubeMeta } from './youtube'
import { findLyrics, findSecondLanguageLyrics } from './lrclib'
import { parseLRC } from '../lyrics/lrc-parser'
import { db } from '../core/db/schema'
import { buildSong, linesFromPlainText, type BuildSongInput } from './songBuilder'
import { detectLanguage, attachSecondLanguage } from '../lyrics/bilingual'
import { ingestAudioFile } from './audioIngest'
import type { TimedLine, Language } from '../core/types'

interface Props {
  onSongReady: (songId: string) => void
}

export function LinkParser({ onSongReady }: Props) {
  const [url, setUrl] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const handleParse = async () => {
    setError('')
    setStatus('Fetching song info…')
    try {
      const meta = await fetchYouTubeMeta(url)
      setStatus('Searching for lyrics…')

      let lines: TimedLine[] = []
      try {
        const found = await findLyrics(meta.title, meta.artist)
        if (found) lines = found.synced ? parseLRC(found.lrc) : linesFromPlainText(found.lrc)
      } catch {
        // Lyrics not found — continue with empty lines
      }

      const primaryText = lines.map((l) => l.original).join('\n')
      const primaryLang = lines.length ? detectLanguage(primaryText) : 'other'
      const sourceLanguage: Language = primaryLang === 'ja' ? 'ja' : 'en'
      const translationLanguage: Language = sourceLanguage === 'ja' ? 'en' : 'ja'

      // Best-effort, non-blocking second language: attach only on a clean
      // match; any mismatch or miss is skipped silently — the user adds one
      // later via SecondLanguagePanel in Edit mode.
      let finalLines = lines
      if (lines.length) {
        setStatus('Looking for a translation…')
        try {
          const second = await findSecondLanguageLyrics(meta.title, meta.artist, primaryLang)
          if (second) {
            const result = attachSecondLanguage(lines, second.lrc)
            if (result.mismatchedBlocks.length === 0) finalLines = result.lines
          }
        } catch {
          // Translation lookup failed — continue with primary only
        }
      }

      let audioStoredPath: string | undefined
      if (audioFile) {
        setStatus('Storing audio…')
        const ingested = await ingestAudioFile(audioFile)
        audioStoredPath = ingested.audioStoredPath
      }

      setStatus('Saving…')
      const input: BuildSongInput = {
        title: meta.title, artist: meta.artist, sourceUrl: url, audioStoredPath,
        lines: finalLines, sourceLanguage, translationLanguage,
      }
      const song = buildSong(input)
      await db.songs.put(song)
      setStatus('')
      onSongReady(song.id)
    } catch (e: unknown) {
      setStatus('')
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  return (
    <div className="min-h-screen bg-cinnabar-950 flex flex-col items-center justify-center p-6 gap-6">
      <h1 className="text-3xl font-bold text-cinnabar-accent tracking-widest">歌sync</h1>
      <p className="text-white/50 text-sm text-center">Learn languages through music</p>

      <div className="w-full max-w-md space-y-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube link…"
          className="w-full px-4 py-3 bg-cinnabar-900 text-white rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30"
        />

        <label
          aria-label="Attach audio for instant auto-sync (optional)"
          className="block w-full px-4 py-3 bg-cinnabar-900 text-white/60 rounded-xl border border-cinnabar-800 cursor-pointer text-xs"
        >
          {audioFile ? audioFile.name : '+ Attach audio for instant auto-sync (optional)'}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAudioFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <button
          onClick={handleParse}
          disabled={!url || !!status}
          className="w-full py-3 bg-cinnabar-accent text-white rounded-xl font-medium disabled:opacity-40"
        >
          {status || 'Get Lyrics'}
        </button>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>

      <p className="text-white/20 text-xs text-center">2 free full song trials included</p>
    </div>
  )
}
```

This removes: the second-language textarea/toggle, `pending`/`note`/`showSecondLang` state, `attachOrEdit`/`handleContinue`, `alignmentEditorData`, and the `AlignmentEditor` import/usage entirely (per spec §10 — no `AlignmentEditor` routing happens during creation anymore).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sources/LinkParser.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite to check for regressions from the removed flow**

Run: `npx vitest run`
Expected: PASS — no other file imports `LinkParser`'s removed internals.

- [ ] **Step 6: Commit**

```bash
git add src/sources/LinkParser.tsx tests/sources/LinkParser.test.tsx
git commit -m "feat: LinkParser auto-attaches translation silently, adds optional audio attach, drops pause-for-translation flow"
```

---

### Task 4: `UploadAudioFlow.tsx` — remove manual second-language textarea, silent clean-match auto-attach

**Files:**
- Modify: `src/sources/UploadAudioFlow.tsx:6,26,79-89,143-145`
- Test: `tests/sources/UploadAudioFlow.test.tsx`

- [ ] **Step 1: Check existing tests for the removed textarea**

Run: `npx vitest run tests/sources/UploadAudioFlow.test.tsx`
Note any test that interacts with the `secondLang` textarea (placeholder `/second-language lyrics/i`) — these will need updating in Step 2 since the field is being removed.

- [ ] **Step 2: Update/add tests in `tests/sources/UploadAudioFlow.test.tsx`**

Remove any test that types into the second-language textarea (the field no longer exists). Add these two in its place:

```typescript
it('auto-attaches a translation silently when found and counts match', async () => {
  const lrclib = await import('../../src/sources/lrclib')
  vi.mocked(lrclib.findSecondLanguageLyrics).mockResolvedValueOnce({ lrc: 'Translated one\nTranslated two' })
  // ... existing setup to fill title/artist, choose lyric source, pick a file, click submit ...
  // (mirror whatever existing "creates a song" test in this file already does up to handleSubmit)
  const songId = onSongReady.mock.calls[0][0]
  const song = await db.songs.get(songId)
  expect(song?.lyrics.lines.some((l) => l.translation)).toBe(true)
})

it('skips a mismatched translation silently, no manual paste UI present', async () => {
  expect(screen.queryByPlaceholderText(/second-language lyrics/i)).not.toBeInTheDocument()
})
```

(Adapt the first test's setup block to match this file's existing render/fill/submit pattern exactly — read the file's current passing tests for the precise sequence of `fireEvent`/`waitFor` calls used to drive a successful submission, since that scaffolding doesn't change.)

- [ ] **Step 3: Update `src/sources/UploadAudioFlow.tsx`**

Remove the `secondLang` state declaration and its textarea JSX:

```typescript
  const [secondLang, setSecondLang] = useState('')
```
→ delete this line.

```jsx
        <textarea value={secondLang} onChange={(e) => setSecondLang(e.target.value)}
          placeholder="Second-language lyrics (optional) — paste a translation, one line per row…"
          rows={4} className="w-full px-4 py-3 bg-cinnabar-900 text-white text-sm rounded-xl outline-none border border-cinnabar-800 focus:border-cinnabar-accent placeholder:text-white/30 font-jp" />
```
→ delete this block.

Replace the second-language attach logic in `handleSubmit`:

```typescript
      let secondText = secondLang.trim()
      if (!secondText) {
        const second = await findSecondLanguageLyrics(title.trim(), artist.trim(), primaryLang)
        if (second) secondText = second.lrc
      }
      const finalLines = secondText ? attachSecondLanguage(lines, secondText).lines : lines
```

with:

```typescript
      // Best-effort, non-blocking second language: attach only on a clean
      // match; a miss or mismatch is skipped silently — added later via
      // SecondLanguagePanel in Edit mode.
      let finalLines = lines
      const second = await findSecondLanguageLyrics(title.trim(), artist.trim(), primaryLang)
      if (second) {
        const result = attachSecondLanguage(lines, second.lrc)
        if (result.mismatchedBlocks.length === 0) finalLines = result.lines
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sources/UploadAudioFlow.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sources/UploadAudioFlow.tsx tests/sources/UploadAudioFlow.test.tsx
git commit -m "feat: UploadAudioFlow auto-attaches translation silently, drops manual paste textarea"
```

---

### Task 5: `TimestampPopover` — new component replacing instant tap-to-stamp

**Files:**
- Create: `src/lyrics/TimestampPopover.tsx`
- Test: `tests/lyrics/TimestampPopover.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/TimestampPopover.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimestampPopover } from '../../src/lyrics/TimestampPopover'

describe('TimestampPopover', () => {
  it('shows a scrub slider seeded with the current time', () => {
    render(<TimestampPopover time={42} playhead={() => 0} onCommit={vi.fn()} onClose={vi.fn()} />)
    const slider = screen.getByLabelText('Scrub timestamp') as HTMLInputElement
    expect(Number(slider.value)).toBe(42)
  })

  it('dragging the slider updates the displayed time without committing', () => {
    const onCommit = vi.fn()
    render(<TimestampPopover time={42} playhead={() => 0} onCommit={onCommit} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Scrub timestamp'), { target: { value: '50' } })
    expect(screen.getByText('0:50')).toBeTruthy()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('"Use current" sets the draft to the live playhead value', () => {
    render(<TimestampPopover time={10} playhead={() => 77} onCommit={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText(/use current/i))
    expect(screen.getByText('1:17')).toBeTruthy()
  })

  it('Done commits the draft value and closes', () => {
    const onCommit = vi.fn()
    const onClose = vi.fn()
    render(<TimestampPopover time={10} playhead={() => 77} onCommit={onCommit} onClose={onClose} />)
    fireEvent.click(screen.getByText(/use current/i))
    fireEvent.click(screen.getByText('Done'))
    expect(onCommit).toHaveBeenCalledWith(77)
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/TimestampPopover.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/lyrics/TimestampPopover.tsx`**

```typescript
import { useState } from 'react'

interface Props {
  time: number
  playhead: () => number
  onCommit: (time: number) => void
  onClose: () => void
}

function fmt(t: number): string {
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

/**
 * Replaces instant tap-to-stamp: opening this popover never overwrites the
 * timestamp by itself. Dragging the slider or tapping "Use current" only
 * updates a local draft; nothing is committed until Done.
 */
export function TimestampPopover({ time, playhead, onCommit, onClose }: Props) {
  const [draft, setDraft] = useState(time)
  const min = Math.max(0, time - 15)
  const max = time + 15

  return (
    <div
      className="absolute z-20 mt-1 left-0 right-0 rounded-xl border border-cinnabar-accent/60 bg-cinnabar-900 p-3 space-y-2 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        aria-label="Scrub timestamp"
        className="w-full accent-cinnabar-accent"
      />
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/70 tabular-nums">{fmt(draft)}</span>
        <button
          onClick={() => setDraft(playhead())}
          className="px-2 py-1 rounded-lg bg-cinnabar-950 text-cinnabar-accent"
        >
          Use current ▶ {fmt(playhead())}
        </button>
      </div>
      <button
        onClick={() => { onCommit(draft); onClose() }}
        className="w-full py-1.5 rounded-lg bg-cinnabar-accent text-white text-xs font-medium"
      >
        Done
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lyrics/TimestampPopover.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/TimestampPopover.tsx tests/lyrics/TimestampPopover.test.tsx
git commit -m "feat: add TimestampPopover, replacing instant tap-to-stamp timing"
```

---

### Task 6: `EditMode.tsx` — inline edit-in-place, popover timing, regrouped footer, confirmations

This replaces the expand-into-`LineEditor` row model with always-visible rows that turn into inline inputs on tap, removes the `onTapThrough` prop (Tap-through button is gone), changes the `hasAudio` hint copy, and adds the Auto-align confirm dialog and two-tap delete. `LineEditor.tsx` itself is deleted in Task 7 (this task only stops using it).

**Files:**
- Modify: `src/lyrics/EditMode.tsx` (full rewrite)
- Test: `tests/lyrics/EditMode.test.tsx` (full rewrite)

- [ ] **Step 1: Replace `tests/lyrics/EditMode.test.tsx`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditMode } from '../../src/lyrics/EditMode'
import type { TimedLine } from '../../src/core/types'

vi.mock('../../src/sources/lrclib', () => ({
  findSecondLanguageLyrics: () => new Promise(() => {}),
}))

const lines: TimedLine[] = [
  { startTime: 0, endTime: 2, original: 'a', translation: '' },
  { startTime: 0, endTime: 0, original: 'b', translation: '' }, // untimed
]

function renderEditMode(overrides: Partial<Parameters<typeof EditMode>[0]> = {}) {
  const onChangeLines = vi.fn()
  const onAutoAlign = vi.fn()
  render(
    <EditMode
      lines={lines}
      playhead={() => 9}
      hasAudio
      onChangeLines={onChangeLines}
      onAutoAlign={onAutoAlign}
      title="t"
      artist="a"
      sourceLanguage="ja"
      {...overrides}
    />,
  )
  return { onChangeLines, onAutoAlign }
}

describe('EditMode', () => {
  it('tapping the timestamp pill opens a popover instead of stamping', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Scrub timestamp')).toBeTruthy()
  })

  it('committing the popover stamps the chosen time', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    fireEvent.click(screen.getByText(/use current/i))
    fireEvent.click(screen.getByText('Done'))
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[1].startTime).toBe(9)
  })

  it('opens inline editing (does NOT stamp) when the lyric text is tapped', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Original text')).toBeTruthy()
  })

  it('commits text on blur, not on every keystroke', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    expect(onChangeLines).not.toHaveBeenCalled()
    fireEvent.blur(input)
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[1].original).toBe('bb')
  })

  it('shows add/delete icons only while editing', () => {
    renderEditMode()
    expect(screen.queryByLabelText('Delete line 2')).toBeNull()
    fireEvent.click(screen.getByText('b'))
    expect(screen.getByLabelText('Delete line 2')).toBeTruthy()
    expect(screen.getByLabelText('Add line after 2')).toBeTruthy()
  })

  it('requires two taps to delete a line', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    fireEvent.click(screen.getByLabelText('Delete line 2'))
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Confirm delete line 2')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Confirm delete line 2'))
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next.length).toBe(1)
  })

  it('shows Auto-align only when audio is available, with a confirm dialog before triggering it', () => {
    const { onAutoAlign, rerender: _r } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /auto-align/i }))
    expect(onAutoAlign).not.toHaveBeenCalled()
    expect(screen.getByText(/replaces timing for all 2 lines/i)).toBeTruthy()
    fireEvent.click(screen.getByText('Continue'))
    expect(onAutoAlign).toHaveBeenCalled()
  })

  it('shows a locally-stored-audio hint instead of Auto-align when hasAudio is false', () => {
    renderEditMode({ hasAudio: false })
    expect(screen.queryByRole('button', { name: /auto-align/i })).toBeNull()
    expect(screen.getByText(/needs locally stored audio/i)).toBeTruthy()
  })

  it('marks untimed lines', () => {
    renderEditMode()
    expect(screen.getByText(/untimed/i)).toBeTruthy()
  })

  it('opens the second-language panel from the footer button', async () => {
    renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /2nd language/i }))
    expect(await screen.findByText(/searching lrclib/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/EditMode.test.tsx`
Expected: FAIL — current component still uses `LineEditor`, instant stamping, `onTapThrough` prop, old hint text, no confirm dialogs.

- [ ] **Step 3: Replace `src/lyrics/EditMode.tsx`**

```typescript
import { useEffect, useRef, useState } from 'react'
import type { TimedLine, Language } from '../core/types'
import { stampStart, setText, addLine, deleteLine } from './lineOps'
import { SecondLanguagePanel } from './SecondLanguagePanel'
import { TimestampPopover } from './TimestampPopover'

interface Props {
  lines: TimedLine[]
  playhead: () => number
  /** Whether this song has locally stored audio for Auto-align to decode (not just an active playback source — YouTube alone doesn't count). */
  hasAudio: boolean
  title: string
  artist: string
  sourceLanguage: Language
  onChangeLines: (lines: TimedLine[]) => void
  onAutoAlign: () => void
}

const DELETE_CONFIRM_MS = 3000

function isTimed(line: TimedLine, first: boolean): boolean {
  return line.startTime > 0 || (first && line.startTime === 0 && line.endTime > 0)
}

function fmt(t: number, timed: boolean): string {
  if (!timed) return '—'
  const m = Math.floor(t / 60)
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`
}

interface RowProps {
  line: TimedLine
  index: number
  timed: boolean
  editing: boolean
  deleteArmed: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  onCommitText: (patch: { original?: string; translation?: string }) => void
  onAdd: () => void
  onArmDelete: () => void
  onConfirmDelete: () => void
  onOpenPopover: () => void
  popoverOpen: boolean
  playhead: () => number
  onCommitTime: (t: number) => void
  onClosePopover: () => void
}

/** One lyric row. Holds local draft text so typing doesn't push a change on every keystroke — committed only on blur, same discipline as the LineEditor panel this replaces. */
function Row({
  line, index, timed, editing, deleteArmed, onStartEdit, onStopEdit, onCommitText, onAdd,
  onArmDelete, onConfirmDelete, onOpenPopover, popoverOpen, playhead, onCommitTime, onClosePopover,
}: RowProps) {
  const [original, setOriginal] = useState(line.original)
  const [translation, setTranslation] = useState(line.translation)

  useEffect(() => {
    if (editing) { setOriginal(line.original); setTranslation(line.translation) }
  }, [editing, line.original, line.translation])

  return (
    <div className="relative rounded-xl border border-white/10 bg-white/5 px-2 py-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenPopover}
          aria-label={`Edit timestamp for line ${index + 1}`}
          className="flex items-center gap-1 shrink-0 rounded-lg border border-white/15 bg-white/5 px-1.5 py-1"
        >
          <span className="text-[10px] text-white/40">⏱</span>
          <span className="text-[11px] tabular-nums text-cinnabar-accent w-9 text-center">{fmt(line.startTime, timed)}</span>
        </button>

        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
              onBlur={() => original !== line.original && onCommitText({ original })}
              aria-label="Original text"
              className="w-full bg-cinnabar-950 text-white text-sm px-2 py-1 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent font-jp"
            />
          ) : (
            <button onClick={onStartEdit} className="w-full flex items-center gap-3 text-left" aria-label={`Edit line ${index + 1}`}>
              <span className="flex-1 text-sm text-white font-jp">
                {line.original || <span className="text-white/30">empty</span>}
                {!timed && <span className="ml-2 text-[10px] text-cinnabar-accent">untimed</span>}
              </span>
            </button>
          )}
        </div>

        {editing && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onAdd} aria-label={`Add line after ${index + 1}`} className="text-white/50 px-1">⊕</button>
            {deleteArmed ? (
              <button onClick={onConfirmDelete} aria-label={`Confirm delete line ${index + 1}`} className="text-red-400 px-1 font-semibold whitespace-nowrap">Confirm?</button>
            ) : (
              <button onClick={onArmDelete} aria-label={`Delete line ${index + 1}`} className="text-white/50 px-1">🗑</button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <input
          value={translation}
          onChange={(e) => setTranslation(e.target.value)}
          onBlur={() => { translation !== line.translation && onCommitText({ translation }); onStopEdit() }}
          placeholder="Translation"
          aria-label="Translation text"
          className="mt-1.5 w-full bg-cinnabar-950 text-white/80 text-sm px-2 py-1 rounded-lg outline-none border border-cinnabar-800 focus:border-cinnabar-accent"
        />
      ) : (
        line.translation && <span className="block text-[11px] italic text-white/45 ml-[3.25rem]">{line.translation}</span>
      )}

      {popoverOpen && (
        <TimestampPopover time={line.startTime} playhead={playhead} onCommit={onCommitTime} onClose={onClosePopover} />
      )}
    </div>
  )
}

export function EditMode({ lines, playhead, hasAudio, title, artist, sourceLanguage, onChangeLines, onAutoAlign }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [openPopover, setOpenPopover] = useState<number | null>(null)
  const [deleteArmed, setDeleteArmed] = useState<number | null>(null)
  const [confirmAutoAlign, setConfirmAutoAlign] = useState(false)
  const [showSecondLang, setShowSecondLang] = useState(false)
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasSecondLang = lines.some((l) => l.translation)

  useEffect(() => () => { if (deleteTimer.current) clearTimeout(deleteTimer.current) }, [])

  const armDelete = (i: number) => {
    setDeleteArmed(i)
    if (deleteTimer.current) clearTimeout(deleteTimer.current)
    deleteTimer.current = setTimeout(() => setDeleteArmed(null), DELETE_CONFIRM_MS)
  }

  const confirmDelete = (i: number) => {
    if (deleteTimer.current) clearTimeout(deleteTimer.current)
    setDeleteArmed(null)
    setEditingIndex(null)
    onChangeLines(deleteLine(lines, i))
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {lines.map((line, i) => (
          <Row
            key={i}
            line={line}
            index={i}
            timed={isTimed(line, i === 0)}
            editing={editingIndex === i}
            deleteArmed={deleteArmed === i}
            onStartEdit={() => setEditingIndex(i)}
            onStopEdit={() => setEditingIndex(null)}
            onCommitText={(patch) => onChangeLines(setText(lines, i, patch))}
            onAdd={() => onChangeLines(addLine(lines, i))}
            onArmDelete={() => armDelete(i)}
            onConfirmDelete={() => confirmDelete(i)}
            onOpenPopover={() => setOpenPopover(openPopover === i ? null : i)}
            popoverOpen={openPopover === i}
            playhead={playhead}
            onCommitTime={(t) => onChangeLines(stampStart(lines, i, t))}
            onClosePopover={() => setOpenPopover(null)}
          />
        ))}
      </div>

      <div className="border-t border-white/10 shrink-0 p-3 space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-white/30 mb-1">Timing</p>
          {hasAudio ? (
            <button onClick={() => setConfirmAutoAlign(true)} className="w-full text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">
              ✨ Auto-align
            </button>
          ) : (
            <p className="text-[10px] text-white/35 text-center px-1">
              Auto-align needs locally stored audio — attach an audio file to this song
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-white/30 mb-1">Content</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onChangeLines(addLine(lines, lines.length - 1))} className="text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">＋ Add line</button>
            <button onClick={() => setShowSecondLang(true)} className="text-xs rounded-lg border border-white/15 bg-white/6 py-2 text-white/85">
              {hasSecondLang ? '↻ Replace 2nd language' : '＋ 2nd language'}
            </button>
          </div>
        </div>
      </div>

      {confirmAutoAlign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirmAutoAlign(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-cinnabar-900 border border-cinnabar-800 p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-white text-sm">This replaces timing for all {lines.length} lines. Continue?</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmAutoAlign(false)} className="flex-1 py-2 rounded-lg bg-cinnabar-950 text-white/70 text-sm">Cancel</button>
              <button onClick={() => { setConfirmAutoAlign(false); onAutoAlign() }} className="flex-1 py-2 rounded-lg bg-cinnabar-accent text-white text-sm font-medium">Continue</button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/EditMode.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/EditMode.tsx tests/lyrics/EditMode.test.tsx
git commit -m "feat: EditMode inline edit-in-place, popover timing, regrouped footer, confirmations"
```

---

### Task 7: Delete `LineEditor.tsx` and the now-unused `nudgeStart`

`EditMode.tsx` no longer imports `LineEditor` (Task 6) or calls `nudgeStart` (the popover replaced the ±0.1 buttons). Confirmed via `grep -rn "nudgeStart\|LineEditor" tests src` that the only remaining references are the dead source file and its own test file, plus the `nudgeStart` export and its test block.

**Files:**
- Delete: `src/lyrics/LineEditor.tsx`
- Delete: `tests/lyrics/LineEditor.test.tsx`
- Modify: `src/lyrics/lineOps.ts:12-14` (remove `nudgeStart`)
- Modify: `tests/lyrics/lineOps.test.ts` (remove the `nudgeStart` describe block and its import)

- [ ] **Step 1: Confirm no other references**

Run: `grep -rn "nudgeStart\|LineEditor" src tests`
Expected: only `src/lyrics/lineOps.ts`, `src/lyrics/LineEditor.tsx`, `tests/lyrics/lineOps.test.ts`, `tests/lyrics/LineEditor.test.tsx` — no references from `EditMode.tsx` or anywhere else (confirms Task 6 fully removed the usages).

- [ ] **Step 2: Delete the dead files**

```bash
git rm src/lyrics/LineEditor.tsx tests/lyrics/LineEditor.test.tsx
```

- [ ] **Step 3: Remove `nudgeStart` from `src/lyrics/lineOps.ts`**

Delete:

```typescript
export function nudgeStart(lines: TimedLine[], i: number, delta: number): TimedLine[] {
  return replaceAt(lines, i, { ...lines[i], startTime: Math.max(0, lines[i].startTime + delta) })
}
```

- [ ] **Step 4: Remove its test block from `tests/lyrics/lineOps.test.ts`**

Remove `nudgeStart` from the import line, and delete the entire `describe('nudgeStart', ...)` block.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS — no file still imports `LineEditor` or `nudgeStart`.

- [ ] **Step 6: Commit**

```bash
git add src/lyrics/lineOps.ts tests/lyrics/lineOps.test.ts
git commit -m "chore: remove LineEditor and nudgeStart, superseded by inline editing and TimestampPopover"
```

---

### Task 8: `PlayerView.tsx` — mode-scoped chrome (hide display toggles, compact transport in Edit mode)

**Files:**
- Modify: `src/player/PlayerView.tsx` (display options row, transport block, `<EditMode>` call)
- Test: `tests/player/PlayerView.edit-toggle.test.tsx`

- [ ] **Step 1: Update the existing test (it references the now-removed Tap-through button)**

Replace the test body in `tests/player/PlayerView.edit-toggle.test.tsx`:

```typescript
describe('SongScreen Play/Edit toggle', () => {
  it('switches from Play mode to Edit mode and shows editable rows', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /edit timestamp for line 1/i })).toBeTruthy())
  })

  it('hides display toggles and the full transport in Edit mode', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expect(screen.queryByText(/translation/i)).toBeTruthy() // visible in Play mode
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /edit timestamp for line 1/i })).toBeTruthy())
    expect(screen.queryByText(/^文 Translation$/)).toBeNull()
    expect(screen.queryByText(/speed/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^a /i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player/PlayerView.edit-toggle.test.tsx`
Expected: FAIL — `EditMode` still has `onTapThrough` removed in Task 6 but `PlayerView` still passes it (TS/test error), and the display row/transport still render in Edit mode.

- [ ] **Step 3: Update `src/player/PlayerView.tsx`**

Remove the `onTapThrough` prop from the `<EditMode>` call (its prop no longer exists per Task 6):

```typescript
        <EditMode
          lines={lines}
          playhead={() => (isYouTube ? position : engine.position)}
          hasAudio={hasAudio}
          title={song?.title ?? ''}
          artist={song?.artist ?? ''}
          sourceLanguage={song?.lyrics.sourceLanguage ?? 'ja'}
          onChangeLines={handleEditLines}
          onAutoAlign={() => beginAlignment('auto')}
        />
```

Wrap the display options row so it's hidden in Edit mode — change:

```typescript
      {/* Display options */}
      {(isJapanese || hasTranslation) && (
```

to:

```typescript
      {/* Display options — Play-mode only, irrelevant while editing text/timing */}
      {mode === 'play' && (isJapanese || hasTranslation) && (
```

Replace the entire playback-controls block (seek bar through the Re-align button, i.e. everything inside the `<div className="px-4 pt-2 space-y-3 shrink-0" ...>` wrapper) so Edit mode only renders a compact play/pause + seek bar, while Play mode keeps everything as-is:

```typescript
      {/* Playback controls */}
      <div className="px-4 pt-2 space-y-3 shrink-0" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 24px), 24px)' }}>
        {/* Seek bar — always visible; Edit mode needs it to position the playhead for stamping */}
        <div
          className="h-1 bg-cinnabar-900 rounded cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            seek(((e.clientX - rect.left) / rect.width) * duration)
          }}
        >
          <div
            className="h-full bg-cinnabar-accent rounded transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {mode === 'edit' ? (
          // Compact transport — just enough to time lines while editing. Speed,
          // A/B loop, and Re-align are Play-mode-only concerns.
          <div className="flex items-center justify-center">
            <button
              onClick={togglePlay}
              className="w-12 h-12 rounded-full bg-cinnabar-accent text-white text-xl flex items-center justify-center shadow-lg touch-manipulation"
            >
              {playbackState === 'playing' ? '⏸' : '▶'}
            </button>
          </div>
        ) : (
          <>
            {/* Time */}
            <div className="flex justify-between text-xs text-white/30">
              <span>{formatTime(position)}</span>
              <span>{formatTime(duration)}</span>
            </div>

            {/* Speed slider (Pro-gated) */}
            <div className="flex items-center gap-3">
              <span className="text-white/30 text-xs w-12">Speed</span>
              {isProUser ? (
                <>
                  <input
                    type="range"
                    min={50}
                    max={200}
                    step={5}
                    value={speed * 100}
                    onChange={(e) => setSpeed(Number(e.target.value) / 100)}
                    className="flex-1 accent-cinnabar-accent"
                  />
                  <span className="text-white/50 text-xs w-10 text-right">{Math.round(speed * 100)}%</span>
                </>
              ) : (
                <button
                  onClick={() => setShowUpgrade(true)}
                  className="text-white/30 hover:text-white/60 text-sm"
                >
                  🔒 Speed control
                </button>
              )}
            </div>

            {/* Transport controls (audio-only YouTube needs these too) */}
            <div className="flex items-center justify-center gap-6">
              <button onClick={() => seek(Math.max(0, position - 5))}
                className="text-white/50 hover:text-white text-xl touch-manipulation">⏮</button>
              <button
                onClick={togglePlay}
                className="w-14 h-14 rounded-full bg-cinnabar-accent text-white text-2xl flex items-center justify-center shadow-lg touch-manipulation"
                style={{ boxShadow: '0 0 20px rgba(248,113,113,0.4)' }}
              >
                {playbackState === 'playing' ? '⏸' : '▶'}
              </button>
              <button onClick={() => seek(Math.min(duration, position + 5))}
                className="text-white/50 hover:text-white text-xl touch-manipulation">⏭</button>
            </div>

            {/* A-B Loop controls (Pro-gated) */}
            {isProUser ? (
              <div className="space-y-1">
                <div className="flex gap-3 justify-center text-xs">
                  <button {...aPress}
                    className={`px-3 py-1 rounded-full border touch-manipulation ${armingAB === 'a' ? 'border-cinnabar-accent text-cinnabar-accent animate-pulse' : abLoop.a !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
                    A {abLoop.a !== null ? formatTime(abLoop.a) : '—'}
                  </button>
                  <button {...bPress}
                    className={`px-3 py-1 rounded-full border touch-manipulation ${armingAB === 'b' ? 'border-cinnabar-accent text-cinnabar-accent animate-pulse' : abLoop.b !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
                    B {abLoop.b !== null ? formatTime(abLoop.b) : '—'}
                  </button>
                  <button onClick={() => setABLoop({ a: null, b: null })}
                    className="px-3 py-1 rounded-full border border-white/20 text-white/30">
                    Clear
                  </button>
                </div>
                {armingAB && (
                  <p className="text-center text-[11px] text-cinnabar-accent/80 animate-pulse">
                    Tap a lyric line to set {armingAB.toUpperCase()}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex justify-center">
                <button
                  onClick={() => setShowUpgrade(true)}
                  className="text-white/30 hover:text-white/60 text-xs"
                >
                  🔒 A-B Loop
                </button>
              </div>
            )}

            {song?.audioStoredPath && (
              <div className="flex justify-center">
                <button
                  onClick={() => beginAlignment(manualAlignMode(getDeviceTier()))}
                  className="text-white/30 hover:text-white/60 text-xs">
                  ✨ Re-align lyrics
                </button>
              </div>
            )}
          </>
        )}
      </div>
```

(The `aPress`/`bPress` spread and `armingAB` logic are reworked in Task 9 — this step only relocates the existing A/B JSX inside the new `mode === 'play'` branch without changing its behavior yet.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/player/PlayerView.edit-toggle.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/player/PlayerView.tsx tests/player/PlayerView.edit-toggle.test.tsx
git commit -m "feat: hide display toggles and collapse to compact transport in Edit mode"
```

---

### Task 9: `PlayerView.tsx` — A/B tap-to-arm, outside-click cancels arming

`PlayerStore`'s `armingAB`/`armAB`/`setABLoop` (which already clears `armingAB` on a successful set) need no changes — only the trigger gesture changes, from long-press to a plain tap.

**Files:**
- Modify: `src/player/PlayerView.tsx` (remove `useLongPress`, rewire A/B buttons, add outside-click cancel)
- Test: `tests/player/PlayerView.ab-loop.test.tsx` (new — check if an existing A/B test file already exists first; if so, extend it instead)

- [ ] **Step 1: Check for an existing A/B test file**

Run: `find tests/player -iname "*ab*"`
If one exists, read it and adapt Step 1 below to extend it rather than creating a new file. If none exists, create `tests/player/PlayerView.ab-loop.test.tsx` as below.

- [ ] **Step 2: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'
import { usePlayerStore } from '../../src/player/PlayerStore'

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {}
    onTimeUpdate() {} onEnd() {}
  },
}))
vi.mock('../../src/payment/trial', () => ({ canUsePro: () => true }))

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: 'hi' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(), isTrialSong: false,
  } as never)
  usePlayerStore.setState({ armingAB: null, abLoop: { a: null, b: null, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 } })
})

describe('PlayerView A/B loop', () => {
  it('tapping A arms it instead of setting the current position', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^a /i }))
    expect(usePlayerStore.getState().armingAB).toBe('a')
    expect(usePlayerStore.getState().abLoop.a).toBeNull()
  })

  it('tapping the armed button again cancels arming', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^a /i }))
    expect(usePlayerStore.getState().armingAB).toBe('a')
    fireEvent.click(screen.getByRole('button', { name: /^a /i }))
    expect(usePlayerStore.getState().armingAB).toBeNull()
  })

  it('tapping a lyric line while armed sets that endpoint', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^a /i }))
    fireEvent.click(screen.getByText('hello'))
    expect(usePlayerStore.getState().abLoop.a).toBe(1)
    expect(usePlayerStore.getState().armingAB).toBeNull()
  })

  it('clicking outside the lyric list cancels arming', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^a /i }))
    expect(usePlayerStore.getState().armingAB).toBe('a')
    fireEvent.click(screen.getByText('Settings'))
    expect(usePlayerStore.getState().armingAB).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/player/PlayerView.ab-loop.test.tsx`
Expected: FAIL — tapping A still sets `abLoop.a` to the current position (long-press behavior), since arming currently requires a long-press, not a tap.

- [ ] **Step 4: Update `src/player/PlayerView.tsx`**

Delete the entire `useLongPress` function (the block starting with its doc comment above `function useLongPress(...)` through its closing `}`).

Replace:

```typescript
  const aPress = useLongPress(() => setABLoop({ a: position }), () => armAB('a'))
  const bPress = useLongPress(() => setABLoop({ b: position }), () => armAB('b'))
```

with:

```typescript
  const toggleArm = (which: 'a' | 'b') => armAB(armingAB === which ? null : which)
```

Replace the A/B buttons (from Task 8's relocated block):

```typescript
                  <button {...aPress}
                    className={`px-3 py-1 rounded-full border touch-manipulation ${armingAB === 'a' ? 'border-cinnabar-accent text-cinnabar-accent animate-pulse' : abLoop.a !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
                    A {abLoop.a !== null ? formatTime(abLoop.a) : '—'}
                  </button>
                  <button {...bPress}
                    className={`px-3 py-1 rounded-full border touch-manipulation ${armingAB === 'b' ? 'border-cinnabar-accent text-cinnabar-accent animate-pulse' : abLoop.b !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
                    B {abLoop.b !== null ? formatTime(abLoop.b) : '—'}
                  </button>
```

with:

```typescript
                  <button onClick={() => toggleArm('a')}
                    className={`px-3 py-1 rounded-full border touch-manipulation ${armingAB === 'a' ? 'border-cinnabar-accent text-cinnabar-accent animate-pulse' : abLoop.a !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
                    A {abLoop.a !== null ? formatTime(abLoop.a) : '—'}
                  </button>
                  <button onClick={() => toggleArm('b')}
                    className={`px-3 py-1 rounded-full border touch-manipulation ${armingAB === 'b' ? 'border-cinnabar-accent text-cinnabar-accent animate-pulse' : abLoop.b !== null ? 'border-cinnabar-accent text-cinnabar-accent' : 'border-white/20 text-white/30'}`}>
                    B {abLoop.b !== null ? formatTime(abLoop.b) : '—'}
                  </button>
```

Add the outside-click cancel to the screen's outer container. Change:

```typescript
    <div className="h-[100dvh] overflow-hidden bg-cinnabar-950 flex flex-col">
```

to:

```typescript
    <div
      className="h-[100dvh] overflow-hidden bg-cinnabar-950 flex flex-col"
      onClick={() => { if (armingAB) armAB(null) }}
    >
```

(A line-click already clears `armingAB` synchronously via `setABLoop` before this bubbled handler runs, so the extra call here is a harmless no-op for that case — it only matters for clicks that aren't a line selection.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/player/PlayerView.ab-loop.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — confirms `useLongPress` had no other callers.

- [ ] **Step 7: Commit**

```bash
git add src/player/PlayerView.tsx tests/player/PlayerView.ab-loop.test.tsx
git commit -m "feat: A/B loop arms on tap instead of long-press, cancels on re-tap or outside click"
```

---

### Task 10: `PlayerView.tsx` — collapsible speed chip

**Files:**
- Modify: `src/player/PlayerView.tsx` (speed slider block, add `speedExpanded` state)
- Test: `tests/player/PlayerView.speed.test.tsx` (new)

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {}
    onTimeUpdate() {} onEnd() {}
  },
}))
vi.mock('../../src/payment/trial', () => ({ canUsePro: () => true }))

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: 'hi' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(), isTrialSong: false,
  } as never)
})

describe('PlayerView speed control', () => {
  it('shows a collapsed Speed chip by default, no slider visible', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    expect(screen.getByText(/speed: 100%/i)).toBeTruthy()
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('tapping the chip expands the slider, tapping again collapses it', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByText(/speed: 100%/i))
    expect(screen.getByRole('slider')).toBeTruthy()
    fireEvent.click(screen.getByText(/speed: 100%/i))
    expect(screen.queryByRole('slider')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/player/PlayerView.speed.test.tsx`
Expected: FAIL — the slider currently always renders, with a static "Speed" label, not a "Speed: 100%" toggle chip.

- [ ] **Step 3: Update `src/player/PlayerView.tsx`**

Add state near the other `useState` declarations:

```typescript
  const [speedExpanded, setSpeedExpanded] = useState(false)
```

Replace the Speed slider block:

```typescript
            {/* Speed slider (Pro-gated) */}
            <div className="flex items-center gap-3">
              <span className="text-white/30 text-xs w-12">Speed</span>
              {isProUser ? (
                <>
                  <input
                    type="range"
                    min={50}
                    max={200}
                    step={5}
                    value={speed * 100}
                    onChange={(e) => setSpeed(Number(e.target.value) / 100)}
                    className="flex-1 accent-cinnabar-accent"
                  />
                  <span className="text-white/50 text-xs w-10 text-right">{Math.round(speed * 100)}%</span>
                </>
              ) : (
                <button
                  onClick={() => setShowUpgrade(true)}
                  className="text-white/30 hover:text-white/60 text-sm"
                >
                  🔒 Speed control
                </button>
              )}
            </div>
```

with:

```typescript
            {/* Speed (Pro-gated), collapsed behind a chip by default */}
            {isProUser ? (
              <div>
                <button
                  onClick={() => setSpeedExpanded((v) => !v)}
                  className="text-white/40 hover:text-white/70 text-xs"
                >
                  Speed: {Math.round(speed * 100)}%
                </button>
                {speedExpanded && (
                  <div className="flex items-center gap-3 mt-2">
                    <input
                      type="range"
                      min={50}
                      max={200}
                      step={5}
                      value={speed * 100}
                      onChange={(e) => setSpeed(Number(e.target.value) / 100)}
                      className="flex-1 accent-cinnabar-accent"
                    />
                    <span className="text-white/50 text-xs w-10 text-right">{Math.round(speed * 100)}%</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center">
                <button
                  onClick={() => setShowUpgrade(true)}
                  className="text-white/30 hover:text-white/60 text-sm"
                >
                  🔒 Speed control
                </button>
              </div>
            )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/player/PlayerView.speed.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/player/PlayerView.tsx tests/player/PlayerView.speed.test.tsx
git commit -m "feat: collapse speed slider behind a tap-to-expand chip"
```

---

### Task 11: `PlayerView.tsx` — `hasAudio` reflects locally stored audio, not just an active source

Today `hasAudio` is `sources.some((s) => s.hasAudio)`, which is `true` for YouTube-only songs even though `AutoAlignFlow` can only decode `song.audioStoredPath` (see `src/ai-pipeline/AutoAlignFlow.tsx:31-42`) — this is the root cause of "Auto-align silently fails for YouTube" from the spec.

**Files:**
- Modify: `src/player/PlayerView.tsx:172` (the `hasAudio` computation)
- Test: `tests/player/PlayerView.has-audio.test.tsx` (new)

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

async function seedSong(overrides: Record<string, unknown>) {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: { lines: [{ startTime: 1, endTime: 3, original: 'hello', translation: '' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(), isTrialSong: false,
    ...overrides,
  } as never)
}

describe('PlayerView hasAudio gating', () => {
  it('does not offer Auto-align for a YouTube-only song with no stored audio', async () => {
    await seedSong({})
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByText(/edit timestamp/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /auto-align/i })).toBeNull()
    expect(screen.getByText(/needs locally stored audio/i)).toBeTruthy()
  })

  it('offers Auto-align once audioStoredPath is present', async () => {
    await seedSong({ audioStoredPath: '/audio/song1' })
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /auto-align/i })).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/player/PlayerView.has-audio.test.tsx`
Expected: FAIL — the first test fails because today's `hasAudio` is `true` for any source with `hasAudio: true`, including the YouTube-only seed, so Auto-align incorrectly shows.

- [ ] **Step 3: Update `src/player/PlayerView.tsx`**

Replace:

```typescript
  const hasAudio = sources.some((s) => s.hasAudio)
```

with:

```typescript
  // AutoAlignFlow can only decode locally stored audio (song.audioStoredPath),
  // not a YouTube stream — gate on that specifically, not "any active source".
  const hasAudio = !!song?.audioStoredPath
```

(`sources` may become unused if nothing else in the file reads it — check with `grep -n "sources" src/player/PlayerView.tsx` after this change; it's also used for `isYouTube`/rendering elsewhere in the existing file, so it should remain referenced. If the grep shows it's now only used to compute the now-removed `hasAudio` line, keep the `deriveSources(song)` call only if another usage remains; otherwise remove the now-dead `sources` variable too.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/player/PlayerView.has-audio.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS — check in particular that no other test relied on `hasAudio` being true for a YouTube-only fixture without `audioStoredPath` (search `grep -rln "provider: 'youtube'" tests` and re-run any matches individually if the full suite reveals a regression).

- [ ] **Step 6: Commit**

```bash
git add src/player/PlayerView.tsx tests/player/PlayerView.has-audio.test.tsx
git commit -m "fix: gate Auto-align on locally stored audio, not just an active playback source"
```

---

### Task 12: `wordAligner.ts` — pure greedy word-alignment logic

Storage uses the existing, previously-unused `Token.alignmentIndices?: number[]` field directly (see `src/core/types/index.ts:28`) rather than the song-level `LyricsData.alignment`/`WordAlignment` types, since `LyricsStore` only threads flat `TimedLine[]` — per-token storage needs no new plumbing. Particles are excluded from matching via kuromoji's existing `pos` tag (`Token.pos`, already populated by `tokenizeJapanese`).

**Files:**
- Create: `src/ai-pipeline/wordAligner.ts`
- Test: `tests/ai-pipeline/wordAligner.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/ai-pipeline/wordAligner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isParticleToken, cosineSimilarity, greedyMatch, alignLineTokens } from '../../src/ai-pipeline/wordAligner'
import type { Token } from '../../src/core/types'

const tok = (surface: string, pos = '名詞'): Token => ({ surface, pos, startIndex: 0, endIndex: surface.length })

describe('isParticleToken', () => {
  it('identifies kuromoji particle tag', () => {
    expect(isParticleToken(tok('が', '助詞'))).toBe(true)
    expect(isParticleToken(tok('が', '助詞,格助詞,一般,*'))).toBe(true)
  })
  it('treats non-particle tags as false', () => {
    expect(isParticleToken(tok('君', '名詞'))).toBe(false)
    expect(isParticleToken(tok('long'))).toBe(false)
  })
})

describe('cosineSimilarity', () => {
  it('returns 1 for identical normalized vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
  })
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })
})

describe('greedyMatch', () => {
  it('pairs each source vector with its closest unused target vector', () => {
    const source = [[1, 0], [0, 1]]
    const target = [[0, 1], [1, 0]] // intentionally reversed order
    const matches = greedyMatch(source, target, 0.5)
    expect(matches).toEqual([
      { sourceIndex: 0, targetIndex: 1, score: 1 },
      { sourceIndex: 1, targetIndex: 0, score: 1 },
    ])
  })
  it('drops pairs below the similarity threshold', () => {
    const source = [[1, 0]]
    const target = [[0, 1]] // orthogonal, similarity 0
    expect(greedyMatch(source, target, 0.5)).toEqual([])
  })
  it('never reuses a source or target index', () => {
    const source = [[1, 0], [0.9, 0.1]]
    const target = [[1, 0]]
    const matches = greedyMatch(source, target, 0.5)
    expect(matches.length).toBe(1)
  })
})

describe('alignLineTokens', () => {
  it('attaches alignmentIndices to matched, non-particle tokens', async () => {
    const tokens: Token[] = [tok('君'), tok('が', '助詞'), tok('好き')]
    const targetWords = ['I', 'like', 'you']
    // Fake embedder: identical surface => identical vector, so 君~you and 好き~like
    // are forced to be the closest match via hand-picked vectors.
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        if (t === '君') return [1, 0, 0]
        if (t === '好き') return [0, 1, 0]
        if (t === 'you') return [1, 0, 0]
        if (t === 'like') return [0, 1, 0]
        return [0, 0, 1] // 'I' — unrelated to any source token
      })
    const result = await alignLineTokens(tokens, targetWords, embed)
    expect(result[0].alignmentIndices).toEqual([0]) // 君 -> you
    expect(result[2].alignmentIndices).toEqual([1]) // 好き -> like
    expect(result[1].alignmentIndices).toBeUndefined() // particle, never matched
  })

  it('leaves tokens unmatched when there is nothing to align against', async () => {
    const tokens: Token[] = [tok('君')]
    const result = await alignLineTokens(tokens, [], async () => [])
    expect(result[0].alignmentIndices).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ai-pipeline/wordAligner.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/ai-pipeline/wordAligner.ts`**

```typescript
import type { Token } from '../core/types'

/** kuromoji tags particles as "助詞" (optionally with sub-category after a comma). */
export function isParticleToken(token: Token): boolean {
  return token.pos?.startsWith('助詞') ?? false
}

/** Embedding vectors from the embedder are pre-normalized, so dot product IS cosine similarity. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

export interface MatchPair { sourceIndex: number; targetIndex: number; score: number }

export const MATCH_THRESHOLD = 0.55

/** Greedy best-match: highest-similarity pairs win first, each index used at most once. */
export function greedyMatch(
  sourceVecs: number[][],
  targetVecs: number[][],
  threshold = MATCH_THRESHOLD,
): MatchPair[] {
  const candidates: MatchPair[] = []
  for (let i = 0; i < sourceVecs.length; i++) {
    for (let j = 0; j < targetVecs.length; j++) {
      const score = cosineSimilarity(sourceVecs[i], targetVecs[j])
      if (score >= threshold) candidates.push({ sourceIndex: i, targetIndex: j, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const usedSource = new Set<number>()
  const usedTarget = new Set<number>()
  const result: MatchPair[] = []
  for (const c of candidates) {
    if (usedSource.has(c.sourceIndex) || usedTarget.has(c.targetIndex)) continue
    usedSource.add(c.sourceIndex)
    usedTarget.add(c.targetIndex)
    result.push(c)
  }
  return result.sort((a, b) => a.sourceIndex - b.sourceIndex)
}

/**
 * Aligns one line's source tokens to translation words, writing matched
 * indices onto each token's `alignmentIndices`. Particles are excluded from
 * matching entirely (no English counterpart) and never receive an index.
 * `embed` is injected so this stays unit-testable without a real model.
 */
export async function alignLineTokens(
  sourceTokens: Token[],
  targetWords: string[],
  embed: (texts: string[]) => Promise<number[][]>,
): Promise<Token[]> {
  const alignableIndices = sourceTokens
    .map((_, i) => i)
    .filter((i) => !isParticleToken(sourceTokens[i]) && sourceTokens[i].surface.trim().length > 0)

  if (alignableIndices.length === 0 || targetWords.length === 0) return sourceTokens

  const sourceTexts = alignableIndices.map((i) => sourceTokens[i].surface)
  const vecs = await embed([...sourceTexts, ...targetWords])
  const sourceVecs = vecs.slice(0, sourceTexts.length)
  const targetVecs = vecs.slice(sourceTexts.length)

  const matches = greedyMatch(sourceVecs, targetVecs)
  const updated = sourceTokens.map((t) => ({ ...t }))
  for (const m of matches) {
    const tokenIndex = alignableIndices[m.sourceIndex]
    updated[tokenIndex] = { ...updated[tokenIndex], alignmentIndices: [m.targetIndex] }
  }
  return updated
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai-pipeline/wordAligner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/wordAligner.ts tests/ai-pipeline/wordAligner.test.ts
git commit -m "feat: add wordAligner — greedy embedding-based word alignment with particle exclusion"
```

---

### Task 13: `wordColors.ts` — color assignment for matched pairs and particles

**Files:**
- Create: `src/language/wordColors.ts`
- Test: `tests/language/wordColors.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { splitTranslationWords, colorForToken, colorForTranslationWord, PARTICLE_COLOR, PAIR_COLORS } from '../../src/language/wordColors'
import type { Token } from '../../src/core/types'

const tok = (surface: string, pos: string, alignmentIndices?: number[]): Token =>
  ({ surface, pos, startIndex: 0, endIndex: surface.length, alignmentIndices })

describe('splitTranslationWords', () => {
  it('splits on whitespace and drops empty entries', () => {
    expect(splitTranslationWords('  I  like   you ')).toEqual(['I', 'like', 'you'])
  })
})

describe('colorForToken', () => {
  it('gives particles the fixed particle color regardless of match state', () => {
    const tokens = [tok('君', '名詞', [0]), tok('が', '助詞')]
    expect(colorForToken(tokens, 1)).toBe(PARTICLE_COLOR)
  })
  it('gives matched non-particle tokens a palette color', () => {
    const tokens = [tok('君', '名詞', [0])]
    expect(colorForToken(tokens, 0)).toBe(PAIR_COLORS[0])
  })
  it('gives unmatched non-particle tokens no color', () => {
    const tokens = [tok('君', '名詞')]
    expect(colorForToken(tokens, 0)).toBeNull()
  })
  it('cycles palette colors by order of matched tokens within the line', () => {
    const tokens = [tok('a', '名詞', [0]), tok('b', '助詞'), tok('c', '名詞', [1])]
    expect(colorForToken(tokens, 0)).toBe(PAIR_COLORS[0])
    expect(colorForToken(tokens, 2)).toBe(PAIR_COLORS[1 % PAIR_COLORS.length])
  })
})

describe('colorForTranslationWord', () => {
  it('matches the color of the token whose alignmentIndices points to it', () => {
    const tokens = [tok('君', '名詞', [0]), tok('好き', '名詞', [2])]
    expect(colorForTranslationWord(tokens, 0)).toBe(colorForToken(tokens, 0))
    expect(colorForTranslationWord(tokens, 2)).toBe(colorForToken(tokens, 1))
  })
  it('returns null for an unmatched translation word index', () => {
    const tokens = [tok('君', '名詞', [0])]
    expect(colorForTranslationWord(tokens, 5)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/language/wordColors.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/language/wordColors.ts`**

```typescript
import type { Token } from '../core/types'

export function splitTranslationWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/** Muted, fixed color for grammatical particles — distinct from the cycling match palette so it reads as "this is a particle," not "this is paired with something." */
export const PARTICLE_COLOR = '#9ca3af'

/** Cycling palette for matched word pairs, distinguishable on a dark background. */
export const PAIR_COLORS = ['#f97316', '#22d3ee', '#a3e635', '#e879f9', '#facc15', '#60a5fa']

function isParticle(token: Token): boolean {
  return token.pos?.startsWith('助詞') ?? false
}

/** Color for a source token at `index`: the fixed particle color, a cycling palette color if matched, or null if unmatched. */
export function colorForToken(tokens: Token[], index: number): string | null {
  const token = tokens[index]
  if (isParticle(token)) return PARTICLE_COLOR
  if (!token.alignmentIndices || token.alignmentIndices.length === 0) return null
  const matchOrder = tokens.slice(0, index + 1).filter((t) => !isParticle(t) && t.alignmentIndices?.length).length - 1
  return PAIR_COLORS[matchOrder % PAIR_COLORS.length]
}

/** Color for a translation word at `wordIndex`, found via whichever token's alignmentIndices points to it. */
export function colorForTranslationWord(tokens: Token[], wordIndex: number): string | null {
  const i = tokens.findIndex((t) => t.alignmentIndices?.includes(wordIndex))
  return i === -1 ? null : colorForToken(tokens, i)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/language/wordColors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/language/wordColors.ts tests/language/wordColors.test.ts
git commit -m "feat: add wordColors — particle and matched-pair color assignment"
```

---

### Task 14: `textEmbed.worker.ts` + `textEmbedder.ts` — on-device embedding model

Mirrors the existing `whisper.worker.ts` pattern exactly (`@xenova/transformers` `pipeline`, loaded once in a Worker). Like `whisper.worker.ts`/`demucs.worker.ts`, this isn't unit tested directly — there are no existing tests for those worker files either, since they require a real Worker + model download that doesn't run in Vitest/jsdom. Verified instead by Task 15's integration and a manual check in Task 17.

**Files:**
- Create: `src/ai-pipeline/textEmbed.worker.ts`
- Create: `src/ai-pipeline/textEmbedder.ts`

- [ ] **Step 1: Implement `src/ai-pipeline/textEmbed.worker.ts`**

```typescript
/// <reference lib="webworker" />
import { pipeline, env } from '@xenova/transformers'

env.allowLocalModels = false
env.useBrowserCache = true

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data

  if (type === 'load') {
    self.postMessage({ type: 'progress', payload: { status: 'loading', progress: 0 } })
    extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
      progress_callback: (p: { status?: string; progress?: number }) =>
        self.postMessage({ type: 'progress', payload: p }),
    })
    self.postMessage({ type: 'loaded' })
    return
  }

  if (type === 'embed') {
    if (!extractor) { self.postMessage({ type: 'error', payload: 'Model not loaded' }); return }
    try {
      const { texts } = payload as { texts: string[] }
      const output = await extractor(texts, { pooling: 'mean', normalize: true })
      const dim = output.dims[1]
      const vecs: number[][] = []
      for (let i = 0; i < texts.length; i++) {
        vecs.push(Array.from(output.data.slice(i * dim, (i + 1) * dim)) as number[])
      }
      self.postMessage({ type: 'result', payload: vecs })
    } catch (err) {
      self.postMessage({ type: 'error', payload: err instanceof Error ? err.message : 'Embedding failed' })
    }
  }
}
```

- [ ] **Step 2: Implement `src/ai-pipeline/textEmbedder.ts`**

```typescript
let worker: Worker | null = null
let loaded: Promise<void> | null = null

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('./textEmbed.worker.ts', import.meta.url), { type: 'module' })
  return worker
}

function ensureLoaded(): Promise<void> {
  if (!loaded) {
    loaded = new Promise((resolve, reject) => {
      const w = getWorker()
      const onMessage = (e: MessageEvent) => {
        if (e.data.type === 'loaded') { w.removeEventListener('message', onMessage); resolve() }
        else if (e.data.type === 'error') { w.removeEventListener('message', onMessage); reject(new Error(e.data.payload)) }
      }
      w.addEventListener('message', onMessage)
      w.postMessage({ type: 'load' })
    })
  }
  return loaded
}

/** Embeds a batch of texts on-device via a worker-hosted multilingual model. One vector per input text, in the same order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  await ensureLoaded()
  return new Promise((resolve, reject) => {
    const w = getWorker()
    const onMessage = (e: MessageEvent) => {
      if (e.data.type === 'result') { w.removeEventListener('message', onMessage); resolve(e.data.payload) }
      else if (e.data.type === 'error') { w.removeEventListener('message', onMessage); reject(new Error(e.data.payload)) }
    }
    w.addEventListener('message', onMessage)
    w.postMessage({ type: 'embed', payload: { texts } })
  })
}
```

- [ ] **Step 3: Verify the build picks up the new worker file**

Run: `npm run build`
Expected: succeeds, with `textEmbed.worker` emitted as a separate chunk (same as `whisper.worker`/`demucs.worker` already are) — confirm by checking the build output listing for a `textEmbed.worker-*.js` chunk.

- [ ] **Step 4: Commit**

```bash
git add src/ai-pipeline/textEmbed.worker.ts src/ai-pipeline/textEmbedder.ts
git commit -m "feat: add on-device multilingual text embedder for word alignment"
```

---

### Task 15: `PlayerView.tsx` — wire word alignment into the enrichment pipeline

`enrichLines` is called from three places in `PlayerView.tsx`: the song-load effect, `applyAlignedSong`, and `handleEditLines`. All three need the new alignment pass chained after it, gated to non-`manual` device tiers.

**Files:**
- Modify: `src/player/PlayerView.tsx`
- Test: `tests/player/PlayerView.word-alignment.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { PlayerView } from '../../src/player/PlayerView'

vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 10; position = 3
    async load() {} play() {} pause() {} seek() {} destroy() {}
    onTimeUpdate() {} onEnd() {}
  },
}))
vi.mock('../../src/ai-pipeline/capability', () => ({ getDeviceTier: () => 'full' }))
vi.mock('../../src/ai-pipeline/textEmbedder', () => ({
  // Deterministic fake: identical text -> identical vector, so '君' aligns to
  // whichever target word is given the same fake embedding below.
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map((t) => (t === '君' || t === 'you' ? [1, 0] : [0, 1]))),
}))

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'T', artist: 'A',
    sources: [{ provider: 'youtube', ref: 'abc', hasAudio: true }],
    lyrics: {
      lines: [{ startTime: 1, endTime: 3, original: '君', translation: 'you' }],
      sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual',
    },
    syncState: 'synced', createdAt: new Date(), isTrialSong: false,
  } as never)
})

describe('PlayerView word alignment', () => {
  it('computes alignmentIndices onto tokens after a song loads, on a full-tier device', async () => {
    render(<PlayerView songId="song1" onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('君')).toBeTruthy())
    const { useLyricsStore } = await import('../../src/lyrics/LyricsStore')
    await waitFor(() => {
      const line = useLyricsStore.getState().lines[0]
      expect(line.tokens?.[0]?.alignmentIndices).toEqual([0])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player/PlayerView.word-alignment.test.tsx`
Expected: FAIL — nothing calls `wordAligner`/`textEmbedder` yet, so `alignmentIndices` stays undefined.

- [ ] **Step 3: Add the alignment pass to `src/player/PlayerView.tsx`**

Add imports near the top (alongside the existing `enrichLines`-adjacent imports):

```typescript
import { getDeviceTier } from '../ai-pipeline/capability'
import { alignLineTokens } from '../ai-pipeline/wordAligner'
import { splitTranslationWords } from '../language/wordColors'
```

(`getDeviceTier` is already imported in this file for `manualAlignMode`/`chooseAutoAlignment` — don't duplicate the import, just add the other two.)

Add a new function near `enrichLines`:

```typescript
/**
 * Computes word-pair alignment for lines that have both tokens and a visible
 * translation, gated to non-manual device tiers (the embedding model can't
 * run on devices without WebGPU, same constraint as Auto-Align). Failures
 * (model load/run errors) degrade silently to no coloring rather than
 * blocking the rest of the song from displaying.
 */
async function enrichAlignment(lines: TimedLine[]): Promise<TimedLine[]> {
  if (getDeviceTier() === 'manual') return lines
  try {
    const { embedTexts } = await import('../ai-pipeline/textEmbedder')
    const updated: TimedLine[] = []
    for (const line of lines) {
      if (!line.tokens || !hasVisibleTranslation(line)) { updated.push(line); continue }
      const targetWords = splitTranslationWords(line.translation)
      const tokens = await alignLineTokens(line.tokens, targetWords, embedTexts)
      updated.push({ ...line, tokens })
    }
    return updated
  } catch {
    return lines
  }
}
```

Chain it after each of the three `enrichLines` call sites. In the song-load effect:

```typescript
      enrichLines(s.lyrics.lines, s.lyrics.sourceLanguage).then((enriched) => {
        if (!cancelled) setLines(enriched)
      })
```

becomes:

```typescript
      enrichLines(s.lyrics.lines, s.lyrics.sourceLanguage)
        .then(enrichAlignment)
        .then((enriched) => { if (!cancelled) setLines(enriched) })
```

In `applyAlignedSong`:

```typescript
    enrichLines(updated.lyrics.lines, updated.lyrics.sourceLanguage).then((enriched) => setLines(enriched))
```

becomes:

```typescript
    enrichLines(updated.lyrics.lines, updated.lyrics.sourceLanguage)
      .then(enrichAlignment)
      .then((enriched) => setLines(enriched))
```

In `handleEditLines`:

```typescript
    enrichLines(lines, song.lyrics.sourceLanguage).then((enriched) => {
      if (enriched.length === lines.length) setLines(enriched)
    })
```

becomes:

```typescript
    enrichLines(lines, song.lyrics.sourceLanguage)
      .then(enrichAlignment)
      .then((enriched) => { if (enriched.length === lines.length) setLines(enriched) })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/player/PlayerView.word-alignment.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS — other `PlayerView` tests don't mock `textEmbedder`, so confirm `enrichAlignment`'s `try/catch` degrades silently when the real (unmocked) worker path is hit in a jsdom test environment (it should reject quickly since `Worker` isn't available in jsdom, hitting the `catch` and returning `lines` unchanged — verify no test hangs or times out because of this).

- [ ] **Step 6: Commit**

```bash
git add src/player/PlayerView.tsx tests/player/PlayerView.word-alignment.test.tsx
git commit -m "feat: compute word-pair alignment during line enrichment, gated to full/lite device tiers"
```

---

### Task 16: `LyricDisplay.tsx` — render matched-pair and particle colors in Side-by-side mode

Coloring applies only when `lyricsLayout === 'sideBySide' && hasVisibleTranslation(line)` (per spec — tied to Side-by-side automatically, no separate toggle). Styling uses individual `borderBottomColor`/`borderBottomWidth`/`borderBottomStyle` properties rather than the `borderBottom` shorthand, so tests can assert on `style.borderBottomColor` directly without dealing with jsdom's shorthand-to-longhand normalization.

**Files:**
- Modify: `src/lyrics/LyricDisplay.tsx`
- Test: `tests/lyrics/LyricDisplay.test.tsx`

- [ ] **Step 1: Add failing tests to `tests/lyrics/LyricDisplay.test.tsx`**

Add this describe block (keep the existing dedup/sideBySide-fallback tests in the file unchanged):

```typescript
describe('word-pair coloring', () => {
  const coloredLine: TimedLine = {
    startTime: 0, endTime: 2, original: '君', translation: 'you',
    tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }],
  }
  const particleLine: TimedLine = {
    startTime: 0, endTime: 2, original: 'が', translation: 'placeholder',
    tokens: [{ surface: 'が', pos: '助詞', startIndex: 0, endIndex: 1 }],
  }

  beforeEach(() => {
    useLyricsStore.setState({ lyricsLayout: 'sideBySide' })
  })

  it('colors a matched token and its translation word the same in side-by-side mode', () => {
    useLyricsStore.setState({ lines: [coloredLine], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    const sourceSpan = screen.getByText('君')
    const targetSpan = screen.getByText('you')
    expect(sourceSpan.style.borderBottomColor).not.toBe('')
    expect(sourceSpan.style.borderBottomColor).toBe(targetSpan.style.borderBottomColor)
  })

  it('gives a particle the fixed particle color regardless of match state', () => {
    useLyricsStore.setState({ lines: [particleLine], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    const span = screen.getByText('が')
    expect(span.style.borderBottomColor).toBe('rgb(156, 163, 175)') // PARTICLE_COLOR #9ca3af
  })

  it('shows no coloring in stacked layout', () => {
    useLyricsStore.setState({ lyricsLayout: 'stacked', lines: [coloredLine], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    expect(screen.getByText('君').style.borderBottomColor).toBe('')
  })
})
```

Add `useLyricsStore` to the existing import line at the top of the file if it isn't already imported there (check first — some test files in this project import the store directly to seed state).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/LyricDisplay.test.tsx`
Expected: FAIL — no coloring is rendered yet.

- [ ] **Step 3: Update `src/lyrics/LyricDisplay.tsx`**

Add the import:

```typescript
import { colorForToken, colorForTranslationWord, splitTranslationWords } from '../language/wordColors'
```

Replace `PrimaryText` to accept a `colored` flag and render colored token spans in the plain-text branch:

```typescript
function PrimaryText({ line, isActive, furiganaMode, colored }: {
  line: TimedLine
  isActive: boolean
  furiganaMode: FuriganaMode
  colored: boolean
}) {
  const sizeClass = isActive ? 'text-2xl font-semibold text-white' : 'text-base font-normal text-white/45'

  if (furiganaMode === 'furigana' && line.furigana) {
    return (
      <div
        className={['font-jp furigana-text transition-all duration-300', sizeClass].join(' ')}
        style={isActive ? { textShadow: '0 0 20px rgba(248,113,113,0.5)' } : undefined}
        dangerouslySetInnerHTML={{ __html: line.furigana }}
      />
    )
  }

  return (
    <div
      className={['font-jp transition-all duration-300', sizeClass].join(' ')}
      style={isActive ? { textShadow: '0 0 20px rgba(248,113,113,0.5)' } : undefined}
    >
      {colored && line.tokens && line.tokens.length > 0 ? (
        line.tokens.map((token, i) => {
          const color = colorForToken(line.tokens!, i)
          return (
            <span
              key={i}
              style={color ? { borderBottomColor: color, borderBottomWidth: '2px', borderBottomStyle: 'solid' } : undefined}
            >
              {token.surface}
            </span>
          )
        })
      ) : (
        line.original
      )}
      {furiganaMode === 'romaji' && line.reading && !isSameText(line.reading, line.original) && (
        <div className={isActive ? 'text-sm text-cinnabar-accent/80 mt-1' : 'text-xs text-white/30 mt-0.5'}>
          {line.reading}
        </div>
      )}
    </div>
  )
}

function ColoredTranslation({ line }: { line: TimedLine }) {
  const words = splitTranslationWords(line.translation)
  if (!line.tokens) return <>{line.translation}</>
  return (
    <>
      {words.map((word, i) => {
        const color = colorForTranslationWord(line.tokens!, i)
        return (
          <span
            key={i}
            style={color ? { borderBottomColor: color, borderBottomWidth: '2px', borderBottomStyle: 'solid' } : undefined}
          >
            {word}{i < words.length - 1 ? ' ' : ''}
          </span>
        )
      })}
    </>
  )
}
```

Update `Line` to compute `colored` and pass it through, and use `ColoredTranslation` when colored:

```typescript
function Line({ line, isActive, onLineClick, lineRef }: {
  line: TimedLine
  isActive: boolean
  onLineClick: (line: TimedLine) => void
  lineRef?: React.Ref<HTMLDivElement>
}) {
  const { furiganaMode, showTranslation, lyricsLayout } = useLyricsStore()
  const hasTranslation = hasVisibleTranslation(line)
  // A line whose translation duplicates the original has no second column, so it falls back to the stacked layout even in side-by-side mode.
  const sideBySide = lyricsLayout === 'sideBySide' && hasTranslation
  // Word-pair colors only apply in side-by-side mode, where original and translation sit close enough for the pairing to read clearly.
  const colored = sideBySide

  const translationEl = hasTranslation && (showTranslation || isActive || sideBySide) ? (
    <div className={[
      'transition-all duration-300',
      isActive ? 'text-base italic text-white/70' : 'text-sm italic text-white/35',
      sideBySide ? 'text-left' : 'mt-1',
    ].join(' ')}>
      {colored ? <ColoredTranslation line={line} /> : line.translation}
    </div>
  ) : null

  return (
    <div
      ref={lineRef}
      onClick={() => onLineClick(line)}
      className={[
        'cursor-pointer select-none transition-all duration-300 px-4',
        isActive ? 'py-6' : 'py-2',
        sideBySide ? 'text-left' : 'text-center',
      ].join(' ')}
    >
      {sideBySide ? (
        <div className="grid grid-cols-2 gap-4 items-baseline max-w-3xl mx-auto">
          <PrimaryText line={line} isActive={isActive} furiganaMode={furiganaMode} colored={colored} />
          {translationEl}
        </div>
      ) : (
        <>
          <PrimaryText line={line} isActive={isActive} furiganaMode={furiganaMode} colored={colored} />
          {translationEl}
        </>
      )}

      {isActive && line.tokens && line.tokens.length > 0 && (
        <div className="mt-2">
          <WordAlignment tokens={line.tokens} grammarAnnotations={line.grammarAnnotations ?? []} />
        </div>
      )}
    </div>
  )
}
```

`LyricDisplay` itself is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/LyricDisplay.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/LyricDisplay.tsx tests/lyrics/LyricDisplay.test.tsx
git commit -m "feat: render matched word-pair and particle colors in Side-by-side mode"
```

---

### Task 17: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS, all files (existing + every file created/modified above).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean — pay particular attention to unused-import/unused-variable warnings from the removed `onTapThrough`, `nudgeStart`, `secondLang`, `LineEditor`, and `useLongPress`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds. Confirm `textEmbed.worker` appears as its own chunk in the build output (same pattern as `whisper.worker`/`demucs.worker`).

- [ ] **Step 4: Manual smoke check (dev server)**

Start the dev server and walk through, in order:
1. Paste a YouTube link with no audio attach → song opens immediately, no second-language prompt of any kind.
2. Open Edit mode on a song → confirm the display-toggle row and full transport (speed/A-B/re-align) are gone, only a compact play/pause + seek bar remain.
3. Tap a line's text → inline inputs appear with add/delete icons; type and blur → text updates without excessive store writes (check via React DevTools or console logging if needed, not just visually).
4. Tap a line's timestamp pill → popover opens, does not stamp until "Done".
5. Tap delete once (arms), tap again (deletes); confirm a single tap alone does nothing.
6. Tap Auto-align → confirm dialog appears before the flow launches.
7. Switch to Play mode → tap A, confirm it arms (pulses) without setting a position; tap a lyric line, confirm it sets A; tap A again while unarmed-but-set, confirm it re-arms (doesn't clear the set value); tap Settings while armed, confirm arming cancels.
8. Tap the Speed chip → slider expands; tap again → collapses.
9. On a song with a Japanese original + English translation, switch to Side-by-side → confirm matched words share visible underline colors across both columns, and any particle gets the same muted color regardless of column.

- [ ] **Step 5: Report**

Summarize pass/fail for each step. If anything fails, fix and re-run the specific failing step before considering the plan complete — do not mark this task done with a known failure.

---

## Plan self-review notes

- **Spec coverage:** Edit-cleanup spec §1–§10 map to Tasks 6–11 (mode-scoped chrome, inline editing/popover/footer/confirms, A/B tap-to-arm, speed chip, hasAudio fix) and Tasks 1–4 (header-stripping/block alignment, LinkParser/UploadAudioFlow/SecondLanguagePanel consolidation). Word-alignment spec §1–§3 (alignment computation, storage, display) map to Tasks 12–16, with particle coloring folded into Tasks 13 and 16.
- **Storage deviation from spec, noted explicitly:** the word-alignment spec named `LyricsData.alignment?: WordAlignment[]` as storage; this plan uses the existing `Token.alignmentIndices?: number[]` instead, since `LyricsStore` only threads flat `TimedLine[]` and the song-level array would need new plumbing the store doesn't have. Functionally equivalent for the spec's goal (persisted, recomputed-on-change alignment data); called out here so it isn't mistaken for an oversight.
- **Stanza-block alignment deviation, noted explicitly:** implemented conservatively (flat pairing tried first, block decomposition only on mismatch with 2+ detected blocks on both sides) rather than always block-first, to preserve the existing "blank lines are noise" test behavior exactly. See the "Implementation note" near the top of this plan.
