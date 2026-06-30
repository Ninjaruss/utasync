# Anchor-Based Section Re-alignment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `realignLocalSlice` / `realignAllWeakLines` functions with anchor-based section re-alignment that finds `good`-quality boundary lines, extracts transcript words for that time range, and runs a fresh `alignLyrics` pass on the weak section — producing accurate timing instead of re-running an algorithm that already failed.

**Architecture:** `realignSection` walks outward from the tapped line (up to 15 lines each direction) to find `good`-quality anchor lines, then runs `alignLyrics` + `validateAndRetryLineTimings` on the section between those anchors using only the transcript words bounded by anchor timestamps. `realignAllWeakSections` groups all weak lines into contiguous sections and re-aligns each section once. `PlayerView.tsx` calls these new functions; `EditMode.tsx` is unchanged (quality badges naturally reflect the outcome).

**Tech Stack:** TypeScript, Vitest, existing `alignLyrics` / `validateAndRetryLineTimings` / `recomputeLineQuality` from `phraseAlignment.ts`

---

## Background for implementers

### Why the old approach failed

`realignLocalSlice` called `validateAndRetryLineTimings` on a 3-line slice. That function's search window is centred on the **line's own (wrong) `startTime`**. For a `needs_review` line whose timing is off by 10+ seconds, the word window contains the wrong transcript words — so the result is identical timing. Re-running the same algorithm that already failed produces the same failure.

### Why the new approach works

`realignSection` finds anchor lines with **known-good** timing on each side of the target, extracts transcript words **bounded by the anchor timestamps** (not the weak line's timestamp), then calls `alignLyrics` — the original forward-cursor LCS alignment engine. `alignLyrics` is not bounded by existing timing; it finds the best match from scratch within the word set provided. Once timing is set by `alignLyrics`, `validateAndRetryLineTimings` refines it and assigns quality scores.

### Duplicate lyric safety

The word set is bounded by anchor timestamps, so earlier chorus repetitions (at an earlier timestamp) are excluded from the word pool. The forward cursor in `alignLyrics` ensures lines within the section are assigned to words in chronological order, preventing a later line from stealing words meant for an earlier line in the section.

The anchor search caps at **15 lines** in each direction (constant `MAX_ANCHOR_SEARCH_LINES = 15`). If a section runs longer than 30 lines, the boundaries become song start/end and duplicate-lyric risk increases — but this is the best we can do without full song context.

### Key functions to know

All in `src/lyrics/phraseAlignment.ts`:

```ts
// Already imported from '../ai-pipeline/aligner':
sanitizeTranscript(words: TranscriptWord[]): readonly TranscriptWord[]
alignLyrics(lineTexts: string[], words: TranscriptWord[], existingLines?: TimedLine[], sourceLanguage?: Language): AlignResult
// AlignResult = { lines: TimedLine[]; anchorSources: LineAnchorSource[]; mode: string; confidence: number }

// Already defined in phraseAlignment.ts:
validateAndRetryLineTimings(lines, words, sourceLanguage, anchorSourcesIn?): LineValidationResult
// LineValidationResult = { lines: TimedLine[]; lineAlignmentQuality: LineAlignmentQuality[]; anchorSources: LineAnchorSource[] }

recomputeLineQuality(lines, words, sourceLanguage, anchorSourcesIn?): Pick<LineValidationResult, 'anchorSources' | 'lineAlignmentQuality'>
```

`recomputeLineQuality` is a module-private function — it is used inside `phraseAlignment.ts`. The new functions live in the same file, so they can call it directly.

---

## Files

- **Modify:** `src/lyrics/phraseAlignment.ts` — replace `realignLocalSlice` + `realignAllWeakLines` with `realignSection` + `realignAllWeakSections`
- **Modify:** `src/player/PlayerView.tsx` — update imports + two handler calls
- **Modify:** `tests/lyrics/phraseAlignment.test.ts` — replace old tests with new ones

---

## Task 1: Replace core functions in `phraseAlignment.ts`

**Files:**
- Modify: `src/lyrics/phraseAlignment.ts:960-1035` (the two old exported functions at the bottom)
- Test: `tests/lyrics/phraseAlignment.test.ts`

### Step 1: Write the failing tests first

Open `tests/lyrics/phraseAlignment.test.ts`. Delete the two existing describe blocks `realignLocalSlice` and `realignAllWeakLines` and their tests. Add the following describe blocks in their place:

```ts
// ─── helpers ─────────────────────────────────────────────────────────────────

function makeLine(startTime: number, endTime: number, text = ''): TimedLine {
  return { startTime, endTime, original: text, translation: '' }
}

function makeWord(word: string, startTime: number, endTime: number): TranscriptWord {
  return { word, startTime, endTime }
}

// ─── realignSection ───────────────────────────────────────────────────────────

describe('realignSection', () => {
  it('re-aligns lines between good anchors without touching the anchors', () => {
    // Anchors: line 0 (good, 0-2s) and line 3 (good, 9-11s).
    // Lines 1-2 are needs_review with wrong timing (50-51s).
    // Transcript has words at 3-4s and 6-7s → those are the correct positions.
    const lines = [
      makeLine(0, 2, 'one'),
      makeLine(50, 51, 'two'),   // wrong timing
      makeLine(50, 51, 'three'), // wrong timing
      makeLine(9, 11, 'four'),
    ]
    const quality: LineAlignmentQuality[] = ['good', 'needs_review', 'needs_review', 'good']
    const words = [
      makeWord('one', 0, 2),
      makeWord('two', 3, 4),
      makeWord('three', 6, 7),
      makeWord('four', 9, 11),
    ]

    const result = realignSection(lines, 1, words, quality, 'ja')

    // Anchors are preserved exactly
    expect(result.lines[0]).toEqual(lines[0])
    expect(result.lines[3]).toEqual(lines[3])

    // Section lines have timing within anchor bounds
    expect(result.lines[1].startTime).toBeGreaterThanOrEqual(2)
    expect(result.lines[1].startTime).toBeLessThan(9)
    expect(result.lines[2].endTime).toBeLessThanOrEqual(9)

    // Section lines got different timing from the wrong starting values
    expect(result.lines[1].startTime).not.toBe(50)
    expect(result.lines[2].startTime).not.toBe(50)

    // Full-length arrays returned
    expect(result.lines).toHaveLength(4)
    expect(result.lineAlignmentQuality).toHaveLength(4)
    expect(result.anchorSources).toHaveLength(4)
  })

  it('returns unchanged when no transcript words fall within anchor bounds', () => {
    const lines = [
      makeLine(1, 2, 'anchor left'),
      makeLine(5, 6, 'target'),
      makeLine(9, 10, 'anchor right'),
    ]
    const quality: LineAlignmentQuality[] = ['good', 'needs_review', 'good']
    // Anchor range is 2–9s. Words are outside that range.
    const words = [
      makeWord('x', 0, 1),    // before left anchor end
      makeWord('y', 9.5, 10), // after right anchor start
    ]

    const result = realignSection(lines, 1, words, quality, 'ja')

    expect(result.lines[1].startTime).toBe(5) // unchanged
    expect(result.lines[1].endTime).toBe(6)
  })

  it('uses song start (t=0) as left boundary when no good anchor is left of target', () => {
    const lines = [
      makeLine(0, 1, 'a'),   // needs_review — not a good anchor
      makeLine(5, 6, 'b'),   // target (needs_review)
      makeLine(9, 10, 'c'),  // good anchor
    ]
    const quality: LineAlignmentQuality[] = ['needs_review', 'needs_review', 'good']
    const words = [
      makeWord('a', 0, 1),
      makeWord('b', 4, 5),
      makeWord('c', 9, 10),
    ]

    // Should not throw; section is lines 0-1, bounded 0s to 9s
    const result = realignSection(lines, 1, words, quality, 'ja')

    expect(result.lines).toHaveLength(3)
    expect(result.lines[2]).toEqual(lines[2]) // good anchor unchanged
  })

  it('uses last transcript word time as right boundary when no good anchor is right of target', () => {
    const lines = [
      makeLine(0, 2, 'a'),   // good anchor
      makeLine(5, 6, 'b'),   // target (needs_review)
      makeLine(8, 9, 'c'),   // needs_review — not a good anchor
    ]
    const quality: LineAlignmentQuality[] = ['good', 'needs_review', 'needs_review']
    const words = [
      makeWord('a', 0, 2),
      makeWord('b', 4, 5),
      makeWord('c', 8, 9),
    ]

    const result = realignSection(lines, 1, words, quality, 'ja')

    expect(result.lines).toHaveLength(3)
    expect(result.lines[0]).toEqual(lines[0]) // good anchor unchanged
  })

  it('non-timing fields (translation, tokens) are preserved on section lines', () => {
    const lines = [
      { startTime: 0, endTime: 2, original: 'one', translation: 'ONE', tokens: [{ text: 'one', reading: 'wan' }] } as unknown as TimedLine,
      { startTime: 50, endTime: 51, original: 'two', translation: 'TWO', tokens: [{ text: 'two', reading: 'tsu' }] } as unknown as TimedLine,
      { startTime: 9, endTime: 10, original: 'four', translation: 'FOUR' } as unknown as TimedLine,
    ]
    const quality: LineAlignmentQuality[] = ['good', 'needs_review', 'good']
    const words = [makeWord('one', 0, 2), makeWord('two', 4, 6), makeWord('four', 9, 10)]

    const result = realignSection(lines, 1, words, quality, 'ja')

    expect(result.lines[1].translation).toBe('TWO')
    // tokens is preserved (spread from original)
    expect((result.lines[1] as any).tokens).toEqual([{ text: 'two', reading: 'tsu' }])
  })
})

// ─── realignAllWeakSections ───────────────────────────────────────────────────

describe('realignAllWeakSections', () => {
  it('groups contiguous weak lines into sections and re-aligns each', () => {
    // Lines 1-2 are one section; lines 5-6 are another.
    const lines = [
      makeLine(0, 1, 'a'),    // good
      makeLine(50, 51, 'b'),  // needs_review (wrong)
      makeLine(50, 51, 'c'),  // needs_review (wrong)
      makeLine(8, 9, 'd'),    // good
      makeLine(10, 11, 'e'),  // good
      makeLine(60, 61, 'f'),  // needs_review (wrong)
      makeLine(60, 61, 'g'),  // needs_review (wrong)
      makeLine(18, 19, 'h'),  // good
    ]
    const quality: LineAlignmentQuality[] = [
      'good', 'needs_review', 'needs_review', 'good',
      'good', 'needs_review', 'needs_review', 'good',
    ]
    const words = [
      makeWord('a', 0, 1),
      makeWord('b', 2, 3),
      makeWord('c', 5, 6),
      makeWord('d', 8, 9),
      makeWord('e', 10, 11),
      makeWord('f', 13, 14),
      makeWord('g', 15, 16),
      makeWord('h', 18, 19),
    ]

    const result = realignAllWeakSections(lines, words, quality, 'ja')

    // Good anchors unchanged
    expect(result.lines[0]).toEqual(lines[0])
    expect(result.lines[3]).toEqual(lines[3])
    expect(result.lines[4]).toEqual(lines[4])
    expect(result.lines[7]).toEqual(lines[7])

    // Both sections got non-50/60 timing
    expect(result.lines[1].startTime).not.toBe(50)
    expect(result.lines[2].startTime).not.toBe(50)
    expect(result.lines[5].startTime).not.toBe(60)
    expect(result.lines[6].startTime).not.toBe(60)

    expect(result.lines).toHaveLength(8)
  })

  it('returns original arrays when there are no weak lines', () => {
    const lines = [makeLine(0, 1, 'a'), makeLine(2, 3, 'b')]
    const quality: LineAlignmentQuality[] = ['good', 'good']
    const words = [makeWord('a', 0, 1), makeWord('b', 2, 3)]

    const result = realignAllWeakSections(lines, words, quality, 'ja')

    expect(result.lines).toBe(lines) // same reference — nothing was copied
    expect(result.lineAlignmentQuality).toBe(quality)
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npx vitest run tests/lyrics/phraseAlignment.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: failures on `realignSection` and `realignAllWeakSections` (not defined).

### Step 3: Remove the old functions and add the new ones

In `src/lyrics/phraseAlignment.ts`, delete the entire `realignLocalSlice` function (lines 960–992) and the entire `realignAllWeakLines` function (lines 1000–1035 approximately). Replace them with:

```ts
const MAX_ANCHOR_SEARCH_LINES = 15

/**
 * Re-align the weak section that contains `targetIndex` using anchor-based
 * boundary detection. Walks outward (up to MAX_ANCHOR_SEARCH_LINES each
 * direction) to find `good`-quality anchor lines. The section between the
 * anchors is re-aligned from scratch using `alignLyrics` on the transcript
 * words that fall within the anchor time bounds, then refined with
 * `validateAndRetryLineTimings`.
 *
 * Anchor lines are never modified. Non-timing fields (translation, tokens,
 * furigana, etc.) are preserved on section lines.
 */
export function realignSection(
  lines: TimedLine[],
  targetIndex: number,
  transcriptWords: TranscriptWord[],
  qualityIn: LineAlignmentQuality[],
  sourceLanguage: Language,
  anchorSourcesIn?: LineAnchorSource[],
): {
  lines: TimedLine[]
  lineAlignmentQuality: LineAlignmentQuality[]
  anchorSources: LineAnchorSource[]
} {
  const clean = sanitizeTranscript(transcriptWords)
  const lastTime = clean.at(-1)?.endTime ?? 0

  // Walk left to find the nearest 'good' anchor, capped at MAX_ANCHOR_SEARCH_LINES.
  let leftAnchorIdx = -1 // -1 = use t=0 as boundary
  for (let i = targetIndex - 1; i >= 0 && targetIndex - i <= MAX_ANCHOR_SEARCH_LINES; i--) {
    if (qualityIn[i] === 'good') { leftAnchorIdx = i; break }
  }

  // Walk right to find the nearest 'good' anchor, capped at MAX_ANCHOR_SEARCH_LINES.
  let rightAnchorIdx = lines.length // lines.length = use lastTime as boundary
  for (let i = targetIndex + 1; i < lines.length && i - targetIndex <= MAX_ANCHOR_SEARCH_LINES; i++) {
    if (qualityIn[i] === 'good') { rightAnchorIdx = i; break }
  }

  const sectionLo = leftAnchorIdx + 1
  const sectionHi = rightAnchorIdx - 1
  // Guard: degenerate range (shouldn't happen in practice)
  if (sectionLo > sectionHi) {
    return {
      lines,
      lineAlignmentQuality: qualityIn,
      anchorSources: anchorSourcesIn ?? lines.map(() => 'interpolated' as LineAnchorSource),
    }
  }

  // Time range is between anchor endpoints.
  const timeFrom = leftAnchorIdx >= 0 ? lines[leftAnchorIdx].endTime : 0
  const timeTo = rightAnchorIdx < lines.length ? lines[rightAnchorIdx].startTime : lastTime

  // Words that overlap the anchor time range.
  const sectionWords = (clean as TranscriptWord[]).filter(
    (w) => w.endTime > timeFrom && w.startTime < timeTo,
  )

  // No words in range → can't improve; return unchanged.
  if (sectionWords.length === 0) {
    return {
      lines,
      lineAlignmentQuality: qualityIn,
      anchorSources: anchorSourcesIn ?? lines.map(() => 'interpolated' as LineAnchorSource),
    }
  }

  // Fresh alignment pass on the section.
  const sectionSlice = lines.slice(sectionLo, sectionHi + 1)
  const sectionTexts = sectionSlice.map((l) => l.original || l.translation)
  const { lines: aligned, anchorSources: pass1Anchors } = alignLyrics(
    sectionTexts,
    sectionWords,
    sectionSlice,
    sourceLanguage,
  )

  // Merge timing into originals (preserve translation, tokens, furigana, etc.)
  const mergedSection: TimedLine[] = sectionSlice.map((orig, k) => ({
    ...orig,
    startTime: aligned[k].startTime,
    endTime: aligned[k].endTime,
  }))

  // Refine and score.
  const refined = validateAndRetryLineTimings(
    mergedSection,
    sectionWords,
    sourceLanguage,
    pass1Anchors,
  )

  // Merge back into full-length output arrays.
  const outLines = [...lines]
  const outQuality: LineAlignmentQuality[] = [...qualityIn]
  const outAnchors: LineAnchorSource[] = anchorSourcesIn
    ? [...anchorSourcesIn]
    : lines.map(() => 'interpolated' as LineAnchorSource)

  for (let k = 0; k < refined.lines.length; k++) {
    const li = sectionLo + k
    outLines[li] = { ...sectionSlice[k], startTime: refined.lines[k].startTime, endTime: refined.lines[k].endTime }
    outQuality[li] = refined.lineAlignmentQuality[k]
    outAnchors[li] = refined.anchorSources[k]
  }

  return { lines: outLines, lineAlignmentQuality: outQuality, anchorSources: outAnchors }
}

/**
 * Re-align all `needs_review` and `approximate` lines by grouping them into
 * contiguous sections and calling `realignSection` once per section.
 * Sections are accumulated sequentially so each re-anchored section's updated
 * timing becomes anchor context for the next.
 */
export function realignAllWeakSections(
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

  // Group weak indices into contiguous runs.
  const sections: number[][] = []
  let current = [weakIndices[0]]
  for (let i = 1; i < weakIndices.length; i++) {
    if (weakIndices[i] === weakIndices[i - 1] + 1) {
      current.push(weakIndices[i])
    } else {
      sections.push(current)
      current = [weakIndices[i]]
    }
  }
  sections.push(current)

  // Re-align each section using the middle line's index as the target.
  let acc: { lines: TimedLine[]; lineAlignmentQuality: LineAlignmentQuality[]; anchorSources: LineAnchorSource[] | undefined } =
    { lines, lineAlignmentQuality: qualityIn, anchorSources: anchorSourcesIn }

  for (const section of sections) {
    const targetIndex = section[Math.floor(section.length / 2)]
    acc = realignSection(
      acc.lines,
      targetIndex,
      transcriptWords,
      acc.lineAlignmentQuality,
      sourceLanguage,
      acc.anchorSources,
    )
  }

  return acc as { lines: TimedLine[]; lineAlignmentQuality: LineAlignmentQuality[]; anchorSources: LineAnchorSource[] }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/lyrics/phraseAlignment.test.ts --reporter=verbose 2>&1 | tail -25
```

Expected: all tests pass (the 18 pre-existing tests + 7 new ones).

**If a test fails** because `clean as TranscriptWord[]` causes a type error: `sanitizeTranscript` returns `readonly TranscriptWord[]` but `.filter()` on that produces a plain `TranscriptWord[]`, so the cast on line `const sectionWords = (clean as TranscriptWord[]).filter(...)` is not actually needed. Remove the cast and write `const sectionWords = clean.filter(...)` — TypeScript infers `TranscriptWord[]` from `filter`.

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/phraseAlignment.ts tests/lyrics/phraseAlignment.test.ts
git -c gpg.format=openpgp -c commit.gpgsign=false -m "feat(align): replace realignLocalSlice with anchor-based realignSection"
```

---

## Task 2: Update `PlayerView.tsx` to call the new functions

**Files:**
- Modify: `src/player/PlayerView.tsx`

### Step 1: Update the import

Find this import (around line 16):

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

Change `realignLocalSlice` → `realignSection` and `realignAllWeakLines` → `realignAllWeakSections`:

```ts
import {
  refineAlignmentWithPhrases,
  sheetRowsForAlignment,
  applyRefinedAlignment,
  shouldRefineStoredAlignment,
  transcriptWordsToAlignInput,
  realignSection,
  realignAllWeakSections,
} from '../lyrics/phraseAlignment'
```

### Step 2: Update `handleLocalRealign`

Find `handleLocalRealign` (around line 774). Replace the `realignLocalSlice` call and its arguments:

**Before:**
```ts
      const { lines, lineAlignmentQuality, anchorSources } = realignLocalSlice(
        song.lyrics.lines,
        lineIndex,
        words,
        song.lyrics.sourceLanguage,
        song.lyrics.lineAlignmentQuality,
        song.lyrics.anchorSources as Parameters<typeof realignLocalSlice>[5],
      )
```

**After:**
```ts
      const { lines, lineAlignmentQuality, anchorSources } = realignSection(
        song.lyrics.lines,
        lineIndex,
        words,
        song.lyrics.lineAlignmentQuality ?? [],
        song.lyrics.sourceLanguage,
        song.lyrics.anchorSources as Parameters<typeof realignSection>[5],
      )
```

Note the parameter order change: `realignSection` takes `qualityIn` as the 4th parameter (before `sourceLanguage`), whereas `realignLocalSlice` had `qualityIn` as the 5th. Also `qualityIn` is now required (non-optional) — use `?? []` to handle the case where `lineAlignmentQuality` is undefined.

### Step 3: Update `handleRealignAllWeak`

Find `handleRealignAllWeak` (around line 829). Replace the `realignAllWeakLines` call:

**Before:**
```ts
        const { lines, lineAlignmentQuality, anchorSources } = realignAllWeakLines(
          song.lyrics.lines,
          words,
          song.lyrics.lineAlignmentQuality,
          song.lyrics.sourceLanguage,
          song.lyrics.anchorSources as Parameters<typeof realignAllWeakLines>[4],
        )
```

**After:**
```ts
        const { lines, lineAlignmentQuality, anchorSources } = realignAllWeakSections(
          song.lyrics.lines,
          words,
          song.lyrics.lineAlignmentQuality ?? [],
          song.lyrics.sourceLanguage,
          song.lyrics.anchorSources as Parameters<typeof realignAllWeakSections>[4],
        )
```

### Step 4: TypeScript check

```bash
npx tsc --noEmit 2>&1 | grep -E "error|realign" | head -20
```

Expected: no errors. If there are type errors on `Parameters<typeof realignSection>[5]` (because `anchorSourcesIn` is the 6th parameter, 0-indexed as `[5]`), verify the function signature has exactly 6 parameters in this order: `lines, targetIndex, transcriptWords, qualityIn, sourceLanguage, anchorSourcesIn`. Adjust the index if needed.

### Step 5: Run full test suite

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: 920+ passed, 0 failed.

### Step 6: Commit

```bash
git add src/player/PlayerView.tsx
git -c gpg.format=openpgp -c commit.gpgsign=false -m "feat(player): switch re-align handlers to anchor-based realignSection"
```

---

## Task 3: Final typecheck + smoke verification

**Files:** None modified in this task.

### Step 1: Full TypeScript check

```bash
npx tsc --noEmit 2>&1
```

Expected: zero errors.

### Step 2: Full test suite

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all tests pass, no regressions.

### Step 3: Verify old names are gone

```bash
grep -rn "realignLocalSlice\|realignAllWeakLines" src/ tests/
```

Expected: no matches (the old names are fully removed).

### Step 4: Verify new names are present

```bash
grep -rn "realignSection\|realignAllWeakSections" src/ tests/
```

Expected: matches in `src/lyrics/phraseAlignment.ts`, `src/player/PlayerView.tsx`, and `tests/lyrics/phraseAlignment.test.ts`.

### Step 5: Commit

```bash
git -c gpg.format=openpgp -c commit.gpgsign=false -m "chore: verify anchor realign — tsc clean, all tests pass"
```

---

## Self-review

**Spec coverage:**
- ✅ Anchor-based: walk outward to find `good` anchors — implemented in `realignSection`
- ✅ Fresh `alignLyrics` pass (not retry) — replaces `validateAndRetryLineTimings` as primary engine
- ✅ Adjusts nearby lines — section covers all weak lines between anchors, not just ±1
- ✅ Falls back to song boundaries when no good anchors — `leftAnchorIdx = -1` / `rightAnchorIdx = lines.length`
- ✅ Does not falsely align to earlier duplicate — word pool is bounded by anchor timestamps
- ✅ Cap on anchor search distance — `MAX_ANCHOR_SEARCH_LINES = 15`
- ✅ Non-timing fields preserved — spread `{ ...orig, startTime, endTime }`
- ✅ Bulk action updated — `realignAllWeakSections` groups contiguous sections
- ✅ No `EditMode.tsx` changes needed — quality badges naturally reflect outcome

**Placeholder scan:** None found.

**Type consistency:** `realignSection` and `realignAllWeakSections` parameter names and types are consistent across phraseAlignment.ts, PlayerView.tsx, and the test file.
