# Anchor-based Auto-fit (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a lyric alignment carry `(lineIndex → exact time)` anchors — from user taps or auto-detected start/end — and auto-fit all other line timing between them, so most timing fixes need zero or one tap.

**Architecture:** A new pure module (`src/lyrics/anchorRefit.ts`) holds the anchor type, the `refitAroundAnchors` re-fit engine, and the transcript-based `detectEdgeAnchors`. Anchors persist on `LyricsData.timingAnchors`. `applyRefinedAlignment` carries anchors forward and re-fits around them (sticky through re-align). A small Play-mode component captures a tap onto a flagged line and re-fits live.

**Tech Stack:** TypeScript, React, Vitest + @testing-library/react. Reuses `lineWeight` (aligner), `computeLineMatchedSpans` (contentAligner), `enforceLineMonotonicity` (phraseAlignment).

**Spec:** `docs/superpowers/specs/2026-07-21-anchor-based-auto-fit-design.md`

---

## File structure

- **Create** `src/lyrics/anchorRefit.ts` — `TimingAnchor` type, `refitAroundAnchors`, `detectEdgeAnchors`. Pure, no React/DB.
- **Create** `tests/lyrics/anchorRefit.test.ts` — unit tests for both functions.
- **Modify** `src/core/types/index.ts` — add `timingAnchors?` to `LyricsData`.
- **Modify** `src/lyrics/phraseAlignment.ts` — `applyRefinedAlignment` carries `timingAnchors` and re-fits.
- **Modify** `tests/ai-pipeline/mixedLanguageAlign.test.ts` or a new `tests/lyrics/phraseAlignment.anchors.test.ts` — sticky-anchor test.
- **Create** `src/player/TapAnchorPrompt.tsx` — the "tap when this line starts" affordance.
- **Modify** `src/player/PlayerView.tsx` — flagged-region detection, render the prompt, capture tap → refit → persist.
- **Create** `tests/player/TapAnchorPrompt.test.tsx` — RTL test for the tap → anchor callback.

---

### Task 1: Anchor type + data model field

**Files:**
- Create: `src/lyrics/anchorRefit.ts`
- Modify: `src/core/types/index.ts` (LyricsData interface, after `sheetLinesSnapshot?`)

- [ ] **Step 1: Add the `TimingAnchor` type**

Create `src/lyrics/anchorRefit.ts`:

```ts
import type { TimedLine, AlignmentLanguage } from '../core/types'
import { lineWeight } from '../ai-pipeline/aligner'
import { enforceLineMonotonicity } from './phraseAlignment'
import { computeLineMatchedSpans } from '../ai-pipeline/contentAligner'
import type { TranscriptWord } from '../ai-pipeline/aligner'

/** A hard timing pin: line `lineIndex` starts exactly at `time` (seconds). */
export interface TimingAnchor {
  lineIndex: number
  time: number
  source: 'user' | 'auto-start' | 'auto-end'
}
```

- [ ] **Step 2: Add the persisted field to `LyricsData`**

In `src/core/types/index.ts`, inside `interface LyricsData`, immediately after the `sheetLinesSnapshot?: TimedLine[]` line, add:

```ts
  /** Hard timing pins (user taps + auto-detected start/end). Line timing is
   * re-fit around these; they survive re-align. Absent ⇒ legacy behavior. */
  timingAnchors?: { lineIndex: number; time: number; source: 'user' | 'auto-start' | 'auto-end' }[]
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: exit 0 (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/lyrics/anchorRefit.ts src/core/types/index.ts
git commit --no-gpg-sign -m "feat(align): add TimingAnchor type + LyricsData.timingAnchors field"
```

---

### Task 2: `refitAroundAnchors` re-fit engine

**Files:**
- Modify: `src/lyrics/anchorRefit.ts`
- Test: `tests/lyrics/anchorRefit.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lyrics/anchorRefit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { TimedLine } from '../../src/core/types'
import { refitAroundAnchors, type TimingAnchor } from '../../src/lyrics/anchorRefit'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original, translation: '', startTime, endTime,
})

describe('refitAroundAnchors', () => {
  it('returns a clone unchanged when there are no anchors', () => {
    const lines = [line('a', 1, 2), line('b', 2, 3)]
    const out = refitAroundAnchors(lines, [], 'en')
    expect(out.map((l) => l.startTime)).toEqual([1, 2])
    expect(out).not.toBe(lines)
  })

  it('pins an anchored line exactly to its time', () => {
    const lines = [line('a', 10, 11), line('b', 11, 12), line('c', 12, 13)]
    const anchors: TimingAnchor[] = [{ lineIndex: 1, time: 30, source: 'user' }]
    const out = refitAroundAnchors(lines, anchors, 'en')
    expect(out[1].startTime).toBe(30)
  })

  it('distributes lines between two anchors by singing weight, monotonic', () => {
    // 5 equal-weight EN lines; anchors at index 0 -> 0s and index 4 -> 40s.
    const lines = Array.from({ length: 5 }, (_, i) => line('word word', i, i + 1))
    const anchors: TimingAnchor[] = [
      { lineIndex: 0, time: 0, source: 'user' },
      { lineIndex: 4, time: 40, source: 'user' },
    ]
    const out = refitAroundAnchors(lines, anchors, 'en')
    const starts = out.map((l) => l.startTime)
    expect(starts[0]).toBe(0)
    expect(starts[4]).toBe(40)
    // Equal weights ⇒ evenly spaced ~10s apart.
    expect(starts[1]).toBeCloseTo(10, 1)
    expect(starts[2]).toBeCloseTo(20, 1)
    expect(starts[3]).toBeCloseTo(30, 1)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('translates lines outside the anchor span by the nearest anchor delta', () => {
    const lines = [line('a', 5, 6), line('b', 6, 7), line('c', 7, 8)]
    // Anchor the middle line 2s later; the outer lines shift by the same delta.
    const anchors: TimingAnchor[] = [{ lineIndex: 1, time: 8, source: 'user' }]
    const out = refitAroundAnchors(lines, anchors, 'en')
    expect(out[1].startTime).toBe(8)
    expect(out[0].startTime).toBeCloseTo(7, 5) // 5 + (8-6)
    expect(out[2].startTime).toBeCloseTo(9, 5) // 7 + (8-6)
  })

  it('drops a contradictory (backwards-in-time) anchor to keep pins exact', () => {
    const lines = [line('a', 0, 1), line('b', 1, 2), line('c', 2, 3)]
    const anchors: TimingAnchor[] = [
      { lineIndex: 0, time: 10, source: 'user' },
      { lineIndex: 2, time: 5, source: 'user' }, // earlier than line 0's pin ⇒ dropped
    ]
    const out = refitAroundAnchors(lines, anchors, 'en')
    expect(out[0].startTime).toBe(10)
    expect(out.map((l) => l.startTime)).toEqual([...out.map((l) => l.startTime)].sort((a, b) => a - b))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/anchorRefit.test.ts`
Expected: FAIL — `refitAroundAnchors is not a function` (not yet exported).

- [ ] **Step 3: Implement `refitAroundAnchors`**

Append to `src/lyrics/anchorRefit.ts`:

```ts
/**
 * Re-fit line start times so every anchored line lands exactly on its anchor
 * time, distributing lines between consecutive anchors by singing weight and
 * translating lines outside the anchor span by the nearest anchor's delta. Pure;
 * returns a new array. Empty/`undefined` anchors ⇒ input cloned unchanged.
 */
export function refitAroundAnchors(
  lines: TimedLine[],
  anchors: TimingAnchor[] | undefined,
  sourceLanguage: AlignmentLanguage,
): TimedLine[] {
  const out = lines.map((l) => ({ ...l }))
  if (!anchors?.length) return out

  // One anchor per line: 'user' wins over 'auto-*'; otherwise last write wins.
  const byLine = new Map<number, TimingAnchor>()
  for (const a of anchors) {
    if (a.lineIndex < 0 || a.lineIndex >= out.length || !Number.isFinite(a.time)) continue
    const prev = byLine.get(a.lineIndex)
    if (!prev || a.source === 'user' || prev.source !== 'user') byLine.set(a.lineIndex, a)
  }
  // Sort by line index, then greedily keep only time-monotonic pins so a
  // contradictory later anchor can never move an earlier exact pin.
  const pins: TimingAnchor[] = []
  for (const p of [...byLine.values()].sort((x, y) => x.lineIndex - y.lineIndex)) {
    if (!pins.length || p.time > pins[pins.length - 1].time) pins.push(p)
  }
  if (!pins.length) return out

  const weightOf = (i: number) =>
    Math.max(0.1, lineWeight(out[i].original || out[i].translation, sourceLanguage))

  for (const p of pins) out[p.lineIndex].startTime = p.time

  // Interpolate the lines strictly between each consecutive pin pair by weight.
  for (let s = 0; s < pins.length - 1; s++) {
    const a = pins[s]
    const b = pins[s + 1]
    if (b.lineIndex - a.lineIndex <= 1) continue
    let total = 0
    for (let i = a.lineIndex; i < b.lineIndex; i++) total += weightOf(i)
    let acc = 0
    for (let i = a.lineIndex + 1; i < b.lineIndex; i++) {
      acc += weightOf(i - 1)
      out[i].startTime = a.time + ((b.time - a.time) * acc) / total
    }
  }

  // Outside the anchor span: translate by the nearest pin's delta.
  const first = pins[0]
  const firstDelta = first.time - lines[first.lineIndex].startTime
  for (let i = 0; i < first.lineIndex; i++) out[i].startTime = lines[i].startTime + firstDelta
  const last = pins[pins.length - 1]
  const lastDelta = last.time - lines[last.lineIndex].startTime
  for (let i = last.lineIndex + 1; i < out.length; i++) out[i].startTime = lines[i].startTime + lastDelta

  // Ends follow the next start; clamps any residual disorder + zero-duration.
  enforceLineMonotonicity(out)
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/anchorRefit.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/anchorRefit.ts tests/lyrics/anchorRefit.test.ts
git commit --no-gpg-sign -m "feat(align): refitAroundAnchors weighted anchor re-fit engine"
```

---

### Task 3: `detectEdgeAnchors` (auto start/end)

**Files:**
- Modify: `src/lyrics/anchorRefit.ts`
- Test: `tests/lyrics/anchorRefit.test.ts`

**Note:** anchors pin a line's *start*. So `auto-end` pins the *last strongly-matched line's onset* (its `firstTime`), bounding the tail — not the raw song end. Both edge anchors therefore use `firstTime`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lyrics/anchorRefit.test.ts`:

```ts
import { detectEdgeAnchors } from '../../src/lyrics/anchorRefit'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

describe('detectEdgeAnchors', () => {
  const texts = ['first line here', 'middle noise', 'last line here']
  // Words that cover line 0 near 5s and line 2 near 40s (line 1 unmatched).
  const words: TranscriptWord[] = [
    { word: 'first', startTime: 5, endTime: 5.4 },
    { word: 'line', startTime: 5.4, endTime: 5.8 },
    { word: 'here', startTime: 5.8, endTime: 6.2 },
    { word: 'last', startTime: 40, endTime: 40.4 },
    { word: 'line', startTime: 40.4, endTime: 40.8 },
    { word: 'here', startTime: 40.8, endTime: 41.2 },
  ]

  it('emits a start anchor on the first strong line and an end anchor on the last', () => {
    const anchors = detectEdgeAnchors(texts, words, 0.5)
    const start = anchors.find((a) => a.source === 'auto-start')
    const end = anchors.find((a) => a.source === 'auto-end')
    expect(start?.lineIndex).toBe(0)
    expect(start?.time).toBeCloseTo(5, 0)
    expect(end?.lineIndex).toBe(2)
    expect(end?.time).toBeCloseTo(40, 0)
  })

  it('emits nothing when no line clears the coverage gate', () => {
    const anchors = detectEdgeAnchors(texts, [{ word: 'zzz', startTime: 1, endTime: 2 }], 0.5)
    expect(anchors).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/anchorRefit.test.ts -t detectEdgeAnchors`
Expected: FAIL — `detectEdgeAnchors is not a function`.

- [ ] **Step 3: Implement `detectEdgeAnchors`**

Append to `src/lyrics/anchorRefit.ts`:

```ts
/**
 * Transcript-based auto start/end anchors: the first and last lines whose
 * matched-char coverage clears `minCoverage` become 'auto-start' / 'auto-end'
 * pins at their onset (`firstTime`). Weak edges emit no anchor (never a wrong
 * one). Returns 0–2 anchors; never both on the same line index.
 */
export function detectEdgeAnchors(
  lineTexts: string[],
  words: TranscriptWord[],
  minCoverage = 0.5,
): TimingAnchor[] {
  const spans = computeLineMatchedSpans(lineTexts, words)
  const strong = (i: number) => {
    const s = spans[i]
    return !!s && s.totalChars > 0 && s.matchedChars / s.totalChars >= minCoverage && Number.isFinite(s.firstTime)
  }
  const anchors: TimingAnchor[] = []
  let startIdx = -1
  for (let i = 0; i < spans.length; i++) {
    if (strong(i)) { startIdx = i; anchors.push({ lineIndex: i, time: spans[i]!.firstTime, source: 'auto-start' }); break }
  }
  for (let i = spans.length - 1; i > startIdx; i--) {
    if (strong(i)) { anchors.push({ lineIndex: i, time: spans[i]!.firstTime, source: 'auto-end' }); break }
  }
  return anchors
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/anchorRefit.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lyrics/anchorRefit.ts tests/lyrics/anchorRefit.test.ts
git commit --no-gpg-sign -m "feat(align): detectEdgeAnchors transcript-based auto start/end"
```

---

### Task 4: Sticky anchors through `applyRefinedAlignment`

**Files:**
- Modify: `src/lyrics/phraseAlignment.ts` (`applyRefinedAlignment`, near line 1406)
- Test: Create `tests/lyrics/phraseAlignment.anchors.test.ts`

**Behavior:** when the stored `lyrics.timingAnchors` is non-empty, after a re-align produces fresh line timing, re-fit the fresh lines around the surviving anchors so a re-align never discards user pins. Auto-detected edge anchors are re-derivable, so only `'user'` anchors are carried forward.

- [ ] **Step 1: Read the current `applyRefinedAlignment`**

Run: `sed -n '1406,1460p' src/lyrics/phraseAlignment.ts`
Note where it builds the returned `LyricsData` (the object spreading `...lyrics` and setting `lines`, `lineAlignmentQuality`, etc.). The refit + carry-forward is inserted just before that object is assembled, operating on the `refined.lines` it is about to store.

- [ ] **Step 2: Write the failing test**

Create `tests/lyrics/phraseAlignment.anchors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { LyricsData, TimedLine } from '../../src/core/types'
import { applyRefinedAlignment, type RefinedAlignment } from '../../src/lyrics/phraseAlignment'

const line = (original: string, startTime: number, endTime: number): TimedLine => ({
  original, translation: '', startTime, endTime,
})

it('re-fits fresh alignment around a surviving user anchor (sticky)', () => {
  const lyrics = {
    lines: [line('a', 0, 1), line('b', 1, 2), line('c', 2, 3)],
    sourceLanguage: 'en',
    translationLanguage: 'en',
    alignmentMode: 'auto',
    timingAnchors: [{ lineIndex: 1, time: 30, source: 'user' as const }],
  } as unknown as LyricsData
  // A fresh re-align that would otherwise place line 1 at 11s.
  const refined = {
    lines: [line('a', 10, 11), line('b', 11, 12), line('c', 12, 13)],
    phrases: [],
    report: { merged: 0, split: 0, dropped: 0 },
    mode: 'content',
    confidence: 0.9,
    anchorSources: ['lcs', 'lcs', 'lcs'],
    lineAlignmentQuality: ['good', 'good', 'good'],
    phraseLayout: 'sheet',
    sheetLinesSnapshot: undefined,
  } as unknown as RefinedAlignment
  const next = applyRefinedAlignment(lyrics, refined)
  // The user's pin is honored despite the re-align.
  expect(next.lines[1].startTime).toBe(30)
  expect(next.timingAnchors?.some((a) => a.lineIndex === 1 && a.time === 30 && a.source === 'user')).toBe(true)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/phraseAlignment.anchors.test.ts`
Expected: FAIL — `expected 11 to be 30` (anchors not yet applied).

- [ ] **Step 4: Implement carry-forward + refit in `applyRefinedAlignment`**

At the top of `applyRefinedAlignment` (after the signature, before it uses `refined.lines`), add:

```ts
  // Sticky user anchors: re-fit fresh timing around surviving user pins so a
  // re-align never discards manual work. Auto-detected edges are re-derivable
  // and are NOT carried forward.
  const userAnchors = (lyrics.timingAnchors ?? []).filter((a) => a.source === 'user')
  if (userAnchors.length) {
    refined = {
      ...refined,
      lines: refitAroundAnchors(refined.lines, userAnchors, lyrics.sourceLanguage as AlignmentLanguage),
    }
  }
```

Add the import at the top of `phraseAlignment.ts` (with the other imports):

```ts
import { refitAroundAnchors } from './anchorRefit'
import type { AlignmentLanguage } from '../core/types'
```

Then, where the function assembles the returned `LyricsData`, add `timingAnchors: userAnchors.length ? userAnchors : lyrics.timingAnchors` to the returned object so the pins persist. (If `refined` is a `const` parameter, change it to a local `let refined = refinedArg` or reassign via a local `const refitted`.)

**Note on the import cycle:** `anchorRefit.ts` imports `enforceLineMonotonicity` from `phraseAlignment.ts`, and now `phraseAlignment.ts` imports `refitAroundAnchors` from `anchorRefit.ts`. This is a function-level (not top-level-execution) cycle and is safe in ESM; if the bundler warns, move `enforceLineMonotonicity` into a small shared `src/lyrics/lineMonotonicity.ts` and import it from both.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lyrics/phraseAlignment.anchors.test.ts`
Expected: PASS.

- [ ] **Step 6: Guard against regression on the whole suite + corpus**

Run: `npx vitest run tests/lyrics tests/ai-pipeline/mixedLanguageAlign.test.ts`
Expected: PASS.
Run: `npx tsx scripts/audit-corpus.mjs --check-baseline`
Expected: `✓ No regressions vs baseline.` (fixtures carry no anchors ⇒ identity).

- [ ] **Step 7: Commit**

```bash
git add src/lyrics/phraseAlignment.ts tests/lyrics/phraseAlignment.anchors.test.ts
git commit --no-gpg-sign -m "feat(align): sticky user anchors survive re-align (refit in applyRefinedAlignment)"
```

---

### Task 5: Tap-to-anchor Play-mode UI

**Files:**
- Create: `src/player/TapAnchorPrompt.tsx`
- Create: `tests/player/TapAnchorPrompt.test.tsx`
- Modify: `src/player/PlayerView.tsx` (render prompt in Play mode; capture tap → refit → persist)

**Behavior:** In Play mode, when the active line is inside a flagged run (`lineAlignmentQuality[i] === 'needs_review'`), show a single bar: *"Tap when this line starts."* Tapping calls back with the current line index and the current playhead time; PlayerView appends a `user` anchor, re-fits via `refitAroundAnchors`, and persists.

- [ ] **Step 1: Write the failing component test**

Create `tests/player/TapAnchorPrompt.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TapAnchorPrompt } from '../../src/player/TapAnchorPrompt'

describe('TapAnchorPrompt', () => {
  it('reports the line index and captured time on tap', () => {
    const onAnchor = vi.fn()
    render(<TapAnchorPrompt lineIndex={4} getTime={() => 12.5} onAnchor={onAnchor} />)
    fireEvent.click(screen.getByRole('button', { name: /tap when this line starts/i }))
    expect(onAnchor).toHaveBeenCalledWith(4, 12.5)
  })

  it('renders nothing when lineIndex is null', () => {
    const { container } = render(<TapAnchorPrompt lineIndex={null} getTime={() => 0} onAnchor={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player/TapAnchorPrompt.test.tsx`
Expected: FAIL — cannot find module `TapAnchorPrompt`.

- [ ] **Step 3: Implement the component**

Create `src/player/TapAnchorPrompt.tsx`:

```tsx
interface Props {
  /** Active flagged line to anchor, or null to render nothing. */
  lineIndex: number | null
  /** Reads the current playhead time (seconds) at tap moment. */
  getTime: () => number
  /** Called with (lineIndex, capturedTime) when the user taps. */
  onAnchor: (lineIndex: number, time: number) => void
}

/** One-tap anchor affordance: shown in Play mode over a needs_review line. */
export function TapAnchorPrompt({ lineIndex, getTime, onAnchor }: Props) {
  if (lineIndex === null) return null
  return (
    <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-cinnabar-900/80 bg-cinnabar-950/80 flex items-center gap-3">
      <p className="text-[11px] text-white/55 text-pretty leading-snug flex-1">
        This line’s timing is uncertain — tap right when it starts and the rest re-fits automatically.
      </p>
      <button
        type="button"
        onClick={() => onAnchor(lineIndex, getTime())}
        className="px-2.5 py-1.5 rounded-lg bg-cinnabar-accent text-white text-[11px] font-medium min-h-8 touch-manipulation shrink-0"
      >
        Tap when this line starts
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/player/TapAnchorPrompt.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into PlayerView**

Read the relevant PlayerView pieces first:

Run: `grep -n "mode === 'play'\|activeLine\|lineAlignmentQuality\|handleEditLines\|db.songs\|playhead\b\|position\b" src/player/PlayerView.tsx | head -40`

Add (a) an import `import { TapAnchorPrompt } from './TapAnchorPrompt'` and `import { refitAroundAnchors, type TimingAnchor } from '../lyrics/anchorRefit'`; (b) compute the flagged active line:

```ts
const flaggedActiveLine =
  mode === 'play' && song?.lyrics.alignmentMode === 'auto' && song.lyrics.lineAlignmentQuality
    ? (song.lyrics.lineAlignmentQuality[activeLineIndex] === 'needs_review' ? activeLineIndex : null)
    : null
```

(Use the existing active-line index variable — confirm its name from the grep, e.g. `activeLineIndex`/`activeLine`. If the index isn't already derived in Play mode, reuse `lineIndexAtPlayhead(lines, playhead())` from `../lyrics/lineTiming`.)

(c) a handler that appends the anchor, re-fits, and persists — modeled on the existing `applyAlignedSong`/`handleEditLines` persistence path:

```ts
const handleTapAnchor = async (lineIndex: number, time: number) => {
  if (!song) return
  const anchors: TimingAnchor[] = [
    ...(song.lyrics.timingAnchors ?? []).filter((a) => a.lineIndex !== lineIndex),
    { lineIndex, time, source: 'user' },
  ]
  const lines = refitAroundAnchors(song.lyrics.lines, anchors, song.lyrics.sourceLanguage as AlignmentLanguage)
  const lyrics = { ...song.lyrics, lines, timingAnchors: anchors }
  setSong({ ...song, lyrics })            // match the existing setSong/state name
  await db.songs.update(song.id, { lyrics })  // match the existing persist call
}
```

(d) render, right after the existing Play-mode `suggestWordLevelAlign` banner block:

```tsx
{mode === 'play' && (
  <TapAnchorPrompt lineIndex={flaggedActiveLine} getTime={playhead} onAnchor={handleTapAnchor} />
)}
```

- [ ] **Step 6: Typecheck + verify no test regressions**

Run: `npx tsc -b` → exit 0.
Run: `npx vitest run tests/player tests/lyrics` → PASS.

- [ ] **Step 7: Verify live in the browser (per verify-live-before-done)**

Start the dev server, open a stored auto-aligned song with at least one `needs_review` line, enter Play mode, confirm the "Tap when this line starts" bar appears on the flagged line, tap it mid-line, and confirm the surrounding lines re-fit and the change persists on reload.

- [ ] **Step 8: Commit**

```bash
git add src/player/TapAnchorPrompt.tsx tests/player/TapAnchorPrompt.test.tsx src/player/PlayerView.tsx
git commit --no-gpg-sign -m "feat(player): tap-to-anchor prompt re-fits + persists on a flagged line"
```

---

## Self-review

**Spec coverage:**
- Anchor data model → Task 1. ✓
- `refitAroundAnchors` → Task 2. ✓
- Auto start/end detector → Task 3. ✓
- Tap-to-anchor UI → Task 5. ✓
- Sticky anchors through re-align → Task 4. ✓
- Never-worsen invariants → enforced structurally (pins exact; contradictory anchors dropped; empty ⇒ identity, tested in Task 2) + corpus baseline guard (Task 4 Step 6). ✓
- **Gap:** the spec's "on open, auto start/end applied via refit" *wiring* (calling `detectEdgeAnchors` + `refitAroundAnchors` during the auto-align/open flow) is not yet a task — Task 3 builds the detector but nothing calls it in production. **Added as Task 6 below.**

**Placeholder scan:** No TBD/TODO. Task 5 Steps 5 references existing PlayerView identifiers to confirm by grep (setSong/db call/active-line index) — these are named with the grep that resolves them, not left blank.

**Type consistency:** `TimingAnchor` (Task 1) is used identically in Tasks 2–5. `refitAroundAnchors(lines, anchors, sourceLanguage)` signature consistent across Tasks 2, 4, 5. `detectEdgeAnchors(lineTexts, words, minCoverage)` consistent. `LyricsData.timingAnchors` shape matches `TimingAnchor[]`.

---

### Task 6: Apply auto start/end on alignment (wiring)

**Files:**
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx` (after `refined`/`transcriptWords` are produced, before persist)
- Test: extend `tests/lyrics/anchorRefit.test.ts` is not enough — add an integration assertion via a new `tests/ai-pipeline/autoAnchors.integration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ai-pipeline/autoAnchors.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { TimedLine } from '../../src/core/types'
import { detectEdgeAnchors, refitAroundAnchors } from '../../src/lyrics/anchorRefit'
import type { TranscriptWord } from '../../src/ai-pipeline/aligner'

it('auto start/end anchors pull the first line onto its detected onset', () => {
  const texts = ['intro line', 'x', 'outro line']
  const lines: TimedLine[] = texts.map((t, i) => ({ original: t, translation: '', startTime: i, endTime: i + 1 }))
  const words: TranscriptWord[] = [
    { word: 'intro', startTime: 4, endTime: 4.5 }, { word: 'line', startTime: 4.5, endTime: 5 },
    { word: 'outro', startTime: 30, endTime: 30.5 }, { word: 'line', startTime: 30.5, endTime: 31 },
  ]
  const anchors = detectEdgeAnchors(texts, words, 0.5)
  const out = refitAroundAnchors(lines, anchors, 'en')
  expect(out[0].startTime).toBeCloseTo(4, 0)
  expect(out[2].startTime).toBeCloseTo(30, 0)
})
```

- [ ] **Step 2: Run it to confirm it passes** (this pins the intended composition; Tasks 2–3 already make it green)

Run: `npx vitest run tests/ai-pipeline/autoAnchors.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Wire into AutoAlignFlow**

In `src/ai-pipeline/AutoAlignFlow.tsx`, after `refined`/`transcriptWords` exist and before `applyRefinedAlignment`/persist, add:

```ts
import { detectEdgeAnchors, refitAroundAnchors } from '../lyrics/anchorRefit'
// …
const edgeAnchors = detectEdgeAnchors(
  sheetRows.map((r) => r.original || r.translation),
  sanitizeTranscript(transcriptWords),
)
const userAnchors = (song.lyrics.timingAnchors ?? []).filter((a) => a.source === 'user')
const allAnchors = [...userAnchors, ...edgeAnchors]
if (allAnchors.length) {
  refined.lines = refitAroundAnchors(refined.lines, allAnchors, alignmentLanguage)
  refined.phrases = syncPhrasesFromValidatedLines(refined.phrases, refined.lines)
}
// carry anchors onto the persisted lyrics object below:
//   timingAnchors: allAnchors.length ? allAnchors : undefined
```

Confirm `sanitizeTranscript`, `syncPhrasesFromValidatedLines`, `alignmentLanguage`, and `sheetRows` are already in scope in `start()` (they are per the mixed/single branches); match the persisted-object assembly already present.

- [ ] **Step 4: Verify no regressions**

Run: `npx vitest run` (or the targeted `tests/ai-pipeline tests/lyrics tests/player`) → PASS.
Run: `npx tsx scripts/audit-corpus.mjs --check-baseline` → no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/ai-pipeline/AutoAlignFlow.tsx tests/ai-pipeline/autoAnchors.integration.test.ts
git commit --no-gpg-sign -m "feat(align): apply auto start/end anchors on fresh auto-align"
```
