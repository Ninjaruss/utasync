# Local Re-Align Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-row and bulk re-alignment actions for `approximate`/`needs_review` lines using the already-stored Whisper transcript, with no re-transcription needed.

**Architecture:** A pure `realignLocalSlice` function in `phraseAlignment.ts` extracts a 3-line window, runs the existing `validateAndRetryLineTimings` retry logic on it, and merges results back. `PlayerView` calls this and persists via `db.songs.put`, passing new props to `EditMode` which renders a tappable chip on weak rows and a toolbar bulk-action button.

**Tech Stack:** TypeScript, React, Vitest, IndexedDB via Dexie (`db.songs`), existing pipeline: `validateAndRetryLineTimings`, `transcriptWordsToAlignInput`, `sanitizeTranscript`

---

## File Map

| File | Change |
|------|--------|
| `src/lyrics/phraseAlignment.ts` | Add `realignLocalSlice` + `realignAllWeakLines` exports |
| `src/lyrics/EditMode.tsx` | Add `onLocalRealign`, `onRealignAllWeak`, `localRealigning`, `weakLineCount` props; chip button + toolbar bulk action |
| `src/player/PlayerView.tsx` | Wire new EditMode props; `handleLocalRealign` + `handleRealignAllWeak` async handlers |
| `tests/lyrics/phraseAlignment.test.ts` | New describe block for `realignLocalSlice` and `realignAllWeakLines` |
| `tests/lyrics/EditMode.test.tsx` | Tests for chip button rendering + callback wiring |

---

## Task 1: `realignLocalSlice` + `realignAllWeakLines` in `phraseAlignment.ts`

**Files:**
- Modify: `src/lyrics/phraseAlignment.ts`
- Test: `tests/lyrics/phraseAlignment.test.ts`

### Background

`validateAndRetryLineTimings(lines, words, sourceLanguage, anchorSources?)` already does windowed LCS retry. It computes boundaries from the array: `prevEnd = lines[i-1].endTime` and `nextStart = lines[i+1].startTime`. If we pass a 3-line slice `[i-1, i, i+1]`, those boundaries are already correct for the middle element — the only imprecision is the outer elements lose one external neighbor, but ±6–8s search windows make this negligible.

`transcriptWordsToAlignInput` (already exported from `phraseAlignment.ts`) converts `LyricsData['transcriptWords']` (i.e. `TimedTranscriptWord[]`) to `TranscriptWord[]` for the aligner.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lyrics/phraseAlignment.test.ts` after the existing imports/describes:

```ts
import {
  realignLocalSlice,
  realignAllWeakLines,
  validateAndRetryLineTimings,
  // existing imports already in this file
} from '../../src/lyrics/phraseAlignment'
import type { LineAlignmentQuality } from '../../src/core/types'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

describe('realignLocalSlice', () => {
  const mkLine = (original: string, startTime: number, endTime: number) => ({
    original, translation: '', startTime, endTime,
  })

  it('only mutates the target ± 1 rows, leaving the rest untouched', () => {
    const lines = [
      mkLine('line0', 0, 2),
      mkLine('line1', 3, 5),
      mkLine('line2', 6, 8),   // target index 2
      mkLine('line3', 9, 11),
      mkLine('line4', 12, 14),
    ]
    const words: TranscriptWord[] = [
      { word: 'line2', startTime: 6.1, endTime: 7.9 },
      { word: 'line3', startTime: 9.1, endTime: 10.9 },
    ]
    const quality: LineAlignmentQuality[] = ['good', 'good', 'needs_review', 'approximate', 'good']
    const result = realignLocalSlice(lines, 2, words, 'ja', quality)
    // rows 0 and 4 are outside the slice — must be identical objects
    expect(result.lines[0]).toBe(lines[0])
    expect(result.lines[4]).toBe(lines[4])
    // the slice rows are new objects (immutable update)
    expect(result.lines[1]).not.toBe(lines[1])
    expect(result.lines[2]).not.toBe(lines[2])
    expect(result.lines[3]).not.toBe(lines[3])
  })

  it('clamps correctly at the start of the array (target index 0)', () => {
    const lines = [
      mkLine('line0', 0, 2),
      mkLine('line1', 3, 5),
      mkLine('line2', 6, 8),
    ]
    const words: TranscriptWord[] = [{ word: 'line0', startTime: 0.1, endTime: 1.9 }]
    const quality: LineAlignmentQuality[] = ['needs_review', 'good', 'good']
    const result = realignLocalSlice(lines, 0, words, 'ja', quality)
    // slice is [0, 1] — row 2 untouched
    expect(result.lines[2]).toBe(lines[2])
    expect(result.lines.length).toBe(lines.length)
    expect(result.lineAlignmentQuality.length).toBe(lines.length)
  })

  it('clamps correctly at the end of the array (target = last index)', () => {
    const lines = [
      mkLine('line0', 0, 2),
      mkLine('line1', 3, 5),
      mkLine('line2', 6, 8),
    ]
    const words: TranscriptWord[] = [{ word: 'line2', startTime: 6.1, endTime: 7.9 }]
    const quality: LineAlignmentQuality[] = ['good', 'good', 'needs_review']
    const result = realignLocalSlice(lines, 2, words, 'ja', quality)
    expect(result.lines[0]).toBe(lines[0])
    expect(result.lines.length).toBe(lines.length)
  })

  it('returns full-length lineAlignmentQuality and anchorSources arrays', () => {
    const lines = [
      mkLine('a', 0, 2),
      mkLine('b', 3, 5),
      mkLine('c', 6, 8),
    ]
    const words: TranscriptWord[] = [{ word: 'b', startTime: 3.1, endTime: 4.9 }]
    const quality: LineAlignmentQuality[] = ['good', 'needs_review', 'good']
    const result = realignLocalSlice(lines, 1, words, 'ja', quality)
    expect(result.lines.length).toBe(3)
    expect(result.lineAlignmentQuality.length).toBe(3)
    expect(result.anchorSources.length).toBe(3)
  })
})

describe('realignAllWeakLines', () => {
  const mkLine = (original: string, startTime: number, endTime: number) => ({
    original, translation: '', startTime, endTime,
  })

  it('processes every needs_review and approximate row', () => {
    const lines = [
      mkLine('good-line', 0, 2),
      mkLine('weak-one', 3, 5),
      mkLine('good-line2', 6, 8),
      mkLine('weak-two', 9, 11),
    ]
    const words: TranscriptWord[] = [
      { word: 'weak-one', startTime: 3.1, endTime: 4.9 },
      { word: 'weak-two', startTime: 9.1, endTime: 10.9 },
    ]
    const quality: LineAlignmentQuality[] = ['good', 'needs_review', 'good', 'approximate']
    const result = realignAllWeakLines(lines, words, quality, 'ja')
    // all four rows should be present
    expect(result.lines.length).toBe(4)
    expect(result.lineAlignmentQuality.length).toBe(4)
  })

  it('returns the original arrays unchanged when there are no weak rows', () => {
    const lines = [mkLine('a', 0, 2), mkLine('b', 3, 5)]
    const words: TranscriptWord[] = []
    const quality: LineAlignmentQuality[] = ['good', 'good']
    const result = realignAllWeakLines(lines, words, quality, 'ja')
    expect(result.lines).toBe(lines)
    expect(result.lineAlignmentQuality).toBe(quality)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/lyrics/phraseAlignment.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|Error|realignLocalSlice|realignAllWeakLines"
```

Expected: `Error: realignLocalSlice is not a function` (or similar import error).

- [ ] **Step 3: Implement `realignLocalSlice` and `realignAllWeakLines`**

Add the following to the **bottom** of `src/lyrics/phraseAlignment.ts` (after the existing exports, before the end of the file):

```ts
/**
 * Re-anchor the line at `targetIndex` plus its immediate neighbors (±1) using
 * the stored Whisper transcript. All other rows are returned as-is (same object
 * references). Useful for fixing individual `approximate`/`needs_review` rows
 * without a full re-transcription.
 */
export function realignLocalSlice(
  lines: TimedLine[],
  targetIndex: number,
  transcriptWords: TranscriptWord[],
  sourceLanguage: Language,
  qualityIn?: LineAlignmentQuality[],
  anchorSourcesIn?: LineAnchorSource[],
): {
  lines: TimedLine[]
  lineAlignmentQuality: LineAlignmentQuality[]
  anchorSources: LineAnchorSource[]
} {
  const lo = Math.max(0, targetIndex - 1)
  const hi = Math.min(lines.length - 1, targetIndex + 1)
  const slice = lines.slice(lo, hi + 1)
  const sliceAnchors = anchorSourcesIn?.slice(lo, hi + 1)

  const { lines: updated, lineAlignmentQuality: sliceQuality, anchorSources: sliceAnchors2 } =
    validateAndRetryLineTimings(slice, transcriptWords, sourceLanguage, sliceAnchors)

  const outLines = [...lines]
  const outQuality: LineAlignmentQuality[] = qualityIn ? [...qualityIn] : lines.map(() => 'needs_review' as LineAlignmentQuality)
  const outAnchors: LineAnchorSource[] = anchorSourcesIn ? [...anchorSourcesIn] : lines.map(() => 'interpolated' as LineAnchorSource)

  for (let k = 0; k < updated.length; k++) {
    const li = lo + k
    outLines[li] = updated[k]
    outQuality[li] = sliceQuality[k]
    outAnchors[li] = sliceAnchors2[k]
  }

  return { lines: outLines, lineAlignmentQuality: outQuality, anchorSources: outAnchors }
}

/**
 * Re-anchor all lines flagged `needs_review` or `approximate` by running
 * `realignLocalSlice` on each sequentially so each newly-anchored line's
 * updated timing becomes neighbor context for the next slice.
 * Returns the original arrays unchanged when there are no weak rows.
 */
export function realignAllWeakLines(
  lines: TimedLine[],
  transcriptWords: TranscriptWord[],
  qualityIn: LineAlignmentQuality[],
  sourceLanguage: Language,
  anchorSourcesIn?: LineAnchorSource[],
): {
  lines: TimedLine[]
  lineAlignmentQuality: LineAlignmentQuality[]
  anchorSources: LineAnchorSource[]
} {
  const weakIndices = lines
    .map((_, i) => i)
    .filter((i) => qualityIn[i] === 'needs_review' || qualityIn[i] === 'approximate')

  if (weakIndices.length === 0) {
    return {
      lines,
      lineAlignmentQuality: qualityIn,
      anchorSources: anchorSourcesIn ?? lines.map(() => 'interpolated' as LineAnchorSource),
    }
  }

  let acc = { lines, lineAlignmentQuality: qualityIn, anchorSources: anchorSourcesIn }
  for (const i of weakIndices) {
    acc = realignLocalSlice(
      acc.lines,
      i,
      transcriptWords,
      sourceLanguage,
      acc.lineAlignmentQuality,
      acc.anchorSources,
    )
  }
  return acc as { lines: TimedLine[]; lineAlignmentQuality: LineAlignmentQuality[]; anchorSources: LineAnchorSource[] }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/lyrics/phraseAlignment.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: All new tests `PASS`. Existing tests in this file must also still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/phraseAlignment.ts tests/lyrics/phraseAlignment.test.ts
git commit -m "feat(align): realignLocalSlice + realignAllWeakLines for targeted re-anchor"
```

---

## Task 2: EditMode new props + chip button + bulk toolbar button

**Files:**
- Modify: `src/lyrics/EditMode.tsx`
- Test: `tests/lyrics/EditMode.test.tsx`

### Background

The `Row` component in `EditMode.tsx` currently shows static text for weak quality:
```tsx
{showAlignmentQuality && alignmentQuality === 'needs_review' && (
  <span className="ml-2 text-[10px] text-amber-400/90">timing approximate</span>
)}
{showAlignmentQuality && alignmentQuality === 'approximate' && (
  <span className="ml-2 text-[10px] text-white/35">approx</span>
)}
```

These become tappable chips when `onLocalRealign` is provided.

The toolbar already shows `needsReviewCount` (count of `needs_review` lines) for the "N line may be misaligned" banner near line 322. The bulk button appears alongside that when `onRealignAllWeak` is provided.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lyrics/EditMode.test.tsx` after the existing imports and `renderEditMode` helper:

```ts
describe('EditMode — local re-align', () => {
  it('renders a tappable chip for needs_review rows when onLocalRealign is provided', () => {
    const onLocalRealign = vi.fn()
    renderEditMode({
      lineAlignmentQuality: ['good', 'needs_review'],
      showAlignmentQuality: true,
      onLocalRealign,
    })
    const chip = screen.getByRole('button', { name: /re-sync line 2/i })
    expect(chip).toBeTruthy()
  })

  it('calls onLocalRealign with the correct line index when the chip is clicked', () => {
    const onLocalRealign = vi.fn()
    renderEditMode({
      lineAlignmentQuality: ['good', 'needs_review'],
      showAlignmentQuality: true,
      onLocalRealign,
    })
    fireEvent.click(screen.getByRole('button', { name: /re-sync line 2/i }))
    expect(onLocalRealign).toHaveBeenCalledWith(1)
  })

  it('renders a tappable chip for approximate rows when onLocalRealign is provided', () => {
    const onLocalRealign = vi.fn()
    renderEditMode({
      lineAlignmentQuality: ['approximate', 'good'],
      showAlignmentQuality: true,
      onLocalRealign,
    })
    const chip = screen.getByRole('button', { name: /re-sync line 1/i })
    expect(chip).toBeTruthy()
  })

  it('shows a spinner instead of the icon when the row is in localRealigning', () => {
    const onLocalRealign = vi.fn()
    renderEditMode({
      lineAlignmentQuality: ['good', 'needs_review'],
      showAlignmentQuality: true,
      onLocalRealign,
      localRealigning: new Set([1]),
    })
    // spinner aria-label replaces the chip
    expect(screen.getByLabelText(/realigning line 2/i)).toBeTruthy()
  })

  it('falls back to static badge when onLocalRealign is not provided', () => {
    renderEditMode({
      lineAlignmentQuality: ['good', 'needs_review'],
      showAlignmentQuality: true,
    })
    expect(screen.getByText(/timing approximate/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /re-sync/i })).toBeNull()
  })

  it('shows Re-align N weak lines button in toolbar when onRealignAllWeak is provided', () => {
    const onRealignAllWeak = vi.fn()
    renderEditMode({
      lineAlignmentQuality: ['needs_review', 'needs_review'],
      showAlignmentQuality: true,
      onRealignAllWeak,
      weakLineCount: 2,
    })
    expect(screen.getByRole('button', { name: /re-align 2 weak lines/i })).toBeTruthy()
  })

  it('calls onRealignAllWeak when the bulk button is clicked', () => {
    const onRealignAllWeak = vi.fn()
    renderEditMode({
      lineAlignmentQuality: ['needs_review', 'approximate'],
      showAlignmentQuality: true,
      onRealignAllWeak,
      weakLineCount: 2,
    })
    fireEvent.click(screen.getByRole('button', { name: /re-align 2 weak lines/i }))
    expect(onRealignAllWeak).toHaveBeenCalledTimes(1)
  })

  it('hides the bulk button when weakLineCount is 0', () => {
    const onRealignAllWeak = vi.fn()
    renderEditMode({
      lineAlignmentQuality: ['good', 'good'],
      showAlignmentQuality: true,
      onRealignAllWeak,
      weakLineCount: 0,
    })
    expect(screen.queryByRole('button', { name: /re-align.*weak/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx vitest run tests/lyrics/EditMode.test.tsx --reporter=verbose 2>&1 | grep -E "FAIL|re-sync|Re-align|realigning"
```

Expected: All new tests fail (props not yet wired).

- [ ] **Step 3: Add new props to the EditMode `Props` interface**

In `src/lyrics/EditMode.tsx`, extend the `Props` interface (around line 44):

```ts
  /** Called when user taps the per-row re-align chip. Index is into `lines`. */
  onLocalRealign?: (lineIndex: number) => void
  /** Called when user taps the "Re-align N weak lines" toolbar button. */
  onRealignAllWeak?: () => void
  /** Set of line indices currently being re-aligned (shows spinner on those rows). */
  localRealigning?: Set<number>
  /** Count of needs_review + approximate lines — drives the bulk button label. */
  weakLineCount?: number
```

- [ ] **Step 4: Add new props to the `RowProps` interface and `Row` component**

In `src/lyrics/EditMode.tsx`, extend the `RowProps` interface (around line 85):

```ts
  onLocalRealign?: () => void   // pre-bound to this row's index by EditMode
  isRealigning?: boolean
```

In the `Row` component signature, add the two new params after `showAlignmentQuality`:

```ts
function Row({
  line, index, timed, editing, deleteArmed, playheadActive, onStartEdit, onStopEdit, onCommitText, onAdd,
  onArmDelete, onConfirmDelete, onOpenPopover, popoverOpen, playhead, seek, onScrubStart, onScrubEnd, onCommitTime, onClosePopover,
  alignmentQuality, showAlignmentQuality, onLocalRealign, isRealigning,
}: RowProps) {
```

- [ ] **Step 5: Replace the static quality badges with tappable chips in `Row`**

In `src/lyrics/EditMode.tsx`, replace the two existing static badge `<span>` elements (around lines 144–149) with:

```tsx
{showAlignmentQuality && alignmentQuality === 'needs_review' && (
  onLocalRealign ? (
    isRealigning ? (
      <span
        aria-label={`Realigning line ${index + 1}`}
        className="ml-2 text-[10px] text-amber-400/90 animate-pulse"
      >⟳</span>
    ) : (
      <button
        onClick={(e) => { e.stopPropagation(); onLocalRealign() }}
        aria-label={`Re-sync line ${index + 1}`}
        className="ml-2 text-[10px] text-amber-400/90 hover:text-amber-300 touch-manipulation"
      >⟳ re-sync</button>
    )
  ) : (
    <span className="ml-2 text-[10px] text-amber-400/90">timing approximate</span>
  )
)}
{showAlignmentQuality && alignmentQuality === 'approximate' && (
  onLocalRealign ? (
    isRealigning ? (
      <span
        aria-label={`Realigning line ${index + 1}`}
        className="ml-2 text-[10px] text-white/35 animate-pulse"
      >⟳</span>
    ) : (
      <button
        onClick={(e) => { e.stopPropagation(); onLocalRealign() }}
        aria-label={`Re-sync line ${index + 1}`}
        className="ml-2 text-[10px] text-white/35 hover:text-white/60 touch-manipulation"
      >⟳ approx</button>
    )
  ) : (
    <span className="ml-2 text-[10px] text-white/35">approx</span>
  )
)}
```

- [ ] **Step 6: Pass new props through from `EditMode` to `Row` in the `EditMode` function**

In `src/lyrics/EditMode.tsx`, update the `EditMode` function signature to destructure the new props:

```ts
export function EditMode({
  lines, playhead, playheadPosition, seek, onScrubStart, onScrubEnd, hasLocalAudio,
  title, artist, sourceLanguage, onChangeLines, onAutoAlign, showTapSync, onTapSync,
  onReplaceLyrics, onPausePlayback, lineAlignmentQuality, showAlignmentQuality = true,
  onLocalRealign, onRealignAllWeak, localRealigning, weakLineCount,
}: Props) {
```

In the `<Row ... />` render call (around line 418), add:

```tsx
onLocalRealign={onLocalRealign ? () => onLocalRealign(i) : undefined}
isRealigning={localRealigning?.has(i)}
```

- [ ] **Step 7: Add the bulk "Re-align N weak lines" button to the toolbar**

In `src/lyrics/EditMode.tsx`, find the toolbar section that renders the `needsReviewCount` warning (around line 322). Add the bulk button adjacent to the warning, inside the same block that checks `showAlignmentQuality && lineAlignmentQuality?.length`:

```tsx
{showAlignmentQuality && (weakLineCount ?? 0) > 0 && onRealignAllWeak && (
  <button
    onClick={onRealignAllWeak}
    className={toolbarActionBtn}
    aria-label={`Re-align ${weakLineCount} weak lines`}
  >
    Re-align {weakLineCount} weak lines
  </button>
)}
```

- [ ] **Step 8: Run tests to confirm they pass**

```bash
npx vitest run tests/lyrics/EditMode.test.tsx --reporter=verbose 2>&1 | tail -30
```

Expected: All new and existing tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lyrics/EditMode.tsx tests/lyrics/EditMode.test.tsx
git commit -m "feat(edit): per-row re-sync chip + bulk re-align toolbar button"
```

---

## Task 3: Wire handlers and state in `PlayerView.tsx`

**Files:**
- Modify: `src/player/PlayerView.tsx`

### Background

`PlayerView` already has the `song` object (with `song.lyrics.transcriptWords` and `song.lyrics.lineAlignmentQuality`), handles DB persistence via `db.songs.put`, and calls `applyAlignedSong` / `setSong` to push song updates downstream. The `handleEditLines` pattern (lines 730–758) shows the exact save + emit pattern to copy.

`transcriptWordsToAlignInput` is already imported from `phraseAlignment`. `realignLocalSlice` and `realignAllWeakLines` are new exports from the same file — add them to the existing import.

`yieldToMainThread` is already imported from `../core/idle`.

- [ ] **Step 1: Add imports for the new functions**

In `src/player/PlayerView.tsx`, extend the existing `phraseAlignment` import (around line 17) to include the two new exports:

```ts
import {
  refineAlignmentWithPhrases,
  sheetRowsForAlignment,
  applyRefinedAlignment,
  shouldRefineStoredAlignment,
  transcriptWordsToAlignInput,
  realignLocalSlice,
  realignAllWeakLines,
} from '../lyrics/phraseAlignment'
```

- [ ] **Step 2: Add `localRealigning` state and `weakLineCount` derived value**

In `src/player/PlayerView.tsx`, find where the component's local state is declared (near the top of the function body, where `useState` calls live). Add:

```ts
const [localRealigning, setLocalRealigning] = useState<Set<number>>(new Set())
```

Derive `weakLineCount` just before the `return` statement (or wherever `lineAlignmentQuality` is used) — it needs `song`:

```ts
const weakLineCount = song?.lyrics.lineAlignmentQuality?.filter(
  (q) => q === 'needs_review' || q === 'approximate',
).length ?? 0
```

- [ ] **Step 3: Add `handleLocalRealign` handler**

In `src/player/PlayerView.tsx`, add the following function alongside `handleEditLines` (around line 730):

```ts
const handleLocalRealign = async (lineIndex: number) => {
  if (!song?.lyrics.transcriptWords?.length) return
  setLocalRealigning((prev) => new Set([...prev, lineIndex]))
  try {
    const words = transcriptWordsToAlignInput(song.lyrics.transcriptWords)
    const { lines, lineAlignmentQuality, anchorSources } = realignLocalSlice(
      song.lyrics.lines,
      lineIndex,
      words,
      song.lyrics.sourceLanguage,
      song.lyrics.lineAlignmentQuality,
      song.lyrics.anchorSources as Parameters<typeof realignLocalSlice>[5],
    )
    const updated: Song = {
      ...song,
      lyrics: {
        ...song.lyrics,
        lines,
        lineAlignmentQuality,
        anchorSources: anchorSources as Song['lyrics']['anchorSources'],
      },
      syncState: computeSyncState({ ...song, lyrics: { ...song.lyrics, lines } }),
    }
    setSong(updated)
    setLines(lines)
    await db.songs.put(updated)
  } finally {
    setLocalRealigning((prev) => {
      const next = new Set(prev)
      next.delete(lineIndex)
      return next
    })
  }
}
```

- [ ] **Step 4: Add `handleRealignAllWeak` handler**

In `src/player/PlayerView.tsx`, add alongside `handleLocalRealign`:

```ts
const handleRealignAllWeak = async () => {
  if (!song?.lyrics.transcriptWords?.length) return
  if (!song.lyrics.lineAlignmentQuality?.length) return
  const words = transcriptWordsToAlignInput(song.lyrics.transcriptWords)
  await yieldToMainThread()
  const { lines, lineAlignmentQuality, anchorSources } = realignAllWeakLines(
    song.lyrics.lines,
    words,
    song.lyrics.lineAlignmentQuality,
    song.lyrics.sourceLanguage,
    song.lyrics.anchorSources as Parameters<typeof realignAllWeakLines>[4],
  )
  const updated: Song = {
    ...song,
    lyrics: {
      ...song.lyrics,
      lines,
      lineAlignmentQuality,
      anchorSources: anchorSources as Song['lyrics']['anchorSources'],
    },
    syncState: computeSyncState({ ...song, lyrics: { ...song.lyrics, lines } }),
  }
  setSong(updated)
  setLines(lines)
  await db.songs.put(updated)
}
```

- [ ] **Step 5: Pass new props to `<EditMode />`**

In `src/player/PlayerView.tsx`, update the `<EditMode />` JSX (around line 1181) to add the four new props:

```tsx
<EditMode
  lines={lines}
  playhead={() => (isYouTube ? position : engine.position)}
  playheadPosition={position}
  seek={seek}
  onScrubStart={onScrubStart}
  onScrubEnd={onScrubEnd}
  hasLocalAudio={hasStoredAudio}
  title={song?.title ?? ''}
  artist={song?.artist ?? ''}
  sourceLanguage={song?.lyrics.sourceLanguage ?? 'ja'}
  onChangeLines={handleEditLines}
  onAutoAlign={() => beginAlignment('auto')}
  showTapSync={canPlayback && lyricsUntimed}
  onTapSync={() => beginAlignment('tap')}
  onReplaceLyrics={() => setShowLyricsReimport(true)}
  onPausePlayback={pausePlayback}
  lineAlignmentQuality={song?.lyrics.lineAlignmentQuality}
  showAlignmentQuality={song?.lyrics.alignmentMode === 'auto'}
  onLocalRealign={song?.lyrics.transcriptWords?.length ? handleLocalRealign : undefined}
  onRealignAllWeak={song?.lyrics.transcriptWords?.length ? handleRealignAllWeak : undefined}
  localRealigning={localRealigning}
  weakLineCount={weakLineCount}
/>
```

- [ ] **Step 6: Check for TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | grep -E "error|phraseAlignment|PlayerView|EditMode" | head -20
```

Expected: No errors. If `anchorSources` cast causes issues, the type is `('lcs' | 'interpolated' | 'interjection')[] | undefined` — cast as `LyricsData['anchorSources']`.

- [ ] **Step 7: Run the full test suite to check for regressions**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: All tests pass. No regressions in `EditMode.test.tsx`, `phraseAlignment.test.ts`, or `PlayerView.*.test.tsx`.

- [ ] **Step 8: Commit**

```bash
git add src/player/PlayerView.tsx
git commit -m "feat(player): wire local re-align handlers + localRealigning state to EditMode"
```

---

## Task 4: Smoke-test the UI manually (if dev server available)

**Files:** None (verification only)

- [ ] **Step 1: Build and verify no compile errors**

```bash
npx tsc --noEmit 2>&1 | grep error | head -10
```

Expected: No output (zero errors).

- [ ] **Step 2: Run full test suite one final time**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: All pass.

- [ ] **Step 3: Final commit if any last fixes were needed**

```bash
git add -p
git commit -m "fix(local-realign): address any type/lint issues from smoke test"
```

Skip this step if no changes were needed.
