# Drag to Re-time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tap-at-an-instant line correction with a drag control that has live audio feedback, removing the systematic ~250–400ms reaction-latency bias that every manual correction currently carries and then locks in as truth.

**Architecture:** A pure drag→time mapping module, a small `DragRetimeStrip` component, and a swap at one render site in `PlayerView`. The commit path is unchanged — the strip calls the existing `handleTapAnchor`, so pinning, `refitAroundAnchors`, the quality-flag clear and the undo toast all keep working exactly as they do today. Onset snapping is added afterwards as an assist, not a second mechanism.

**Tech Stack:** TypeScript, React 19, Vite/Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-18-drag-to-retime-design.md`

**Baseline, from `TapAnchorPrompt`'s own docstring:** pinning ~4 flagged spots by tapping took a real song to **0.30s mean start error, no line worse than 0.82s**. That residual is the same order as human reaction latency, which is the evidence this plan acts on.

Be honest about what this plan can and cannot show. Re-measuring that 0.30s figure would need a human repeatedly tapping a real song, which no task here does. What IS verifiable is the mechanism: Task 5's bias test demonstrates a late time is recovered to the true onset, and the drag control has no reaction-latency term by construction. Do not claim the mean error improved — claim the systematic bias was removed, and say which.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/player/dragTiming.ts` (create) | Pure: map a drag position to a time within a window, and back. No DOM. |
| `src/player/DragRetimeStrip.tsx` (create) | The inline drag control. Presentational — owns no timing policy. |
| `src/player/PlayerView.tsx` (modify) | Swap `TapAnchorPrompt` for the strip at one render site. |
| `src/player/TapAnchorPrompt.tsx` (delete, Task 3) | Superseded. Its measured docstring moves to the new component. |
| `src/player/onsetSnap.ts` (create, Task 5) | Pure: snap a user-supplied time to a nearby acoustic onset. |

**Ordering matters.** Tasks 1–3 deliver the whole point — correction without reaction latency — and are independently shippable. Tasks 5–7 add onset snapping as an assist. **If this plan is cut short, stop after Task 4**; the core win is already banked.

---

## Task 1: Pure drag→time mapping

**Files:**
- Create: `src/player/dragTiming.ts`
- Test: `tests/player/dragTiming.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/player/dragTiming.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  dragWindowFor,
  timeAtFraction,
  fractionAtTime,
  DRAG_WINDOW_HALF_SEC,
} from '../../src/player/dragTiming'

describe('dragWindowFor', () => {
  it('centres the window on the current start', () => {
    const w = dragWindowFor(30, 2.5)
    expect(w.minSec).toBe(27.5)
    expect(w.maxSec).toBe(32.5)
  })

  // A line near t=0 must not offer negative times to drag to.
  it('clamps the window at the start of the track', () => {
    const w = dragWindowFor(1, 2.5)
    expect(w.minSec).toBe(0)
    expect(w.maxSec).toBe(3.5)
  })

  it('falls back to a valid window for a nonsense start', () => {
    const w = dragWindowFor(Number.NaN, 2.5)
    expect(w.minSec).toBe(0)
    expect(w.maxSec).toBeGreaterThan(0)
  })
})

describe('timeAtFraction / fractionAtTime', () => {
  const w = dragWindowFor(30, 2.5)

  it('maps the ends and the centre', () => {
    expect(timeAtFraction(w, 0)).toBe(27.5)
    expect(timeAtFraction(w, 1)).toBe(32.5)
    expect(timeAtFraction(w, 0.5)).toBe(30)
  })

  it('clamps out-of-range fractions rather than escaping the window', () => {
    expect(timeAtFraction(w, -1)).toBe(27.5)
    expect(timeAtFraction(w, 2)).toBe(32.5)
  })

  it('round-trips', () => {
    for (const t of [27.5, 28.3, 30, 31.9, 32.5]) {
      expect(timeAtFraction(w, fractionAtTime(w, t))).toBeCloseTo(t, 6)
    }
  })

  it('clamps a time outside the window to its edges', () => {
    expect(fractionAtTime(w, 0)).toBe(0)
    expect(fractionAtTime(w, 99)).toBe(1)
  })

  // Degenerate window must not produce NaN — a zero-width window would divide by
  // zero and put NaN into a stored line time.
  it('survives a zero-width window', () => {
    const z = { minSec: 5, maxSec: 5 }
    expect(Number.isFinite(timeAtFraction(z, 0.5))).toBe(true)
    expect(Number.isFinite(fractionAtTime(z, 5))).toBe(true)
  })
})

describe('DRAG_WINDOW_HALF_SEC', () => {
  // Provisional per the spec — Task 4 measures it. Pinned here so a change is a
  // deliberate edit with a test to update, not a silent drift.
  it('is a small local window, not the popover-sized one', () => {
    expect(DRAG_WINDOW_HALF_SEC).toBeGreaterThan(0)
    expect(DRAG_WINDOW_HALF_SEC).toBeLessThan(6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player/dragTiming.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/player/dragTiming.ts`:

```ts
/**
 * Drag→time mapping for inline line re-timing.
 *
 * Pure and DOM-free so the mapping can be tested without a pointer: given a
 * window and a fraction along it, what time does the user mean.
 *
 * The point of dragging rather than tapping: a tap commits the playhead at the
 * moment of the click, so it carries the user's reaction latency (~250-400ms,
 * always late) straight into stored timing. A drag has no such term — the user
 * adjusts until it matches and can overshoot and correct.
 */

/**
 * Half-width of the drag window, in seconds.
 *
 * PROVISIONAL. `TimestampPopover` uses ±6s, but that is a modal with a context
 * strip; an inline control wants a tighter window so small movements are
 * precise. Measured and tuned in Task 4 of this plan — do not treat this value
 * as evidence-backed until then.
 */
export const DRAG_WINDOW_HALF_SEC = 2.5

export interface DragWindow {
  minSec: number
  maxSec: number
}

/** Window centred on a line's current start, clamped at the start of the track. */
export function dragWindowFor(startSec: number, halfWidthSec = DRAG_WINDOW_HALF_SEC): DragWindow {
  const half = Number.isFinite(halfWidthSec) && halfWidthSec > 0 ? halfWidthSec : DRAG_WINDOW_HALF_SEC
  const centre = Number.isFinite(startSec) && startSec > 0 ? startSec : 0
  const minSec = Math.max(0, centre - half)
  return { minSec, maxSec: minSec + half * 2 }
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/** Time at a fraction (0..1) along the window. Out-of-range fractions clamp. */
export function timeAtFraction(window: DragWindow, fraction: number): number {
  return window.minSec + (window.maxSec - window.minSec) * clamp01(fraction)
}

/** Inverse of timeAtFraction. A zero-width window yields 0 rather than NaN. */
export function fractionAtTime(window: DragWindow, timeSec: number): number {
  const span = window.maxSec - window.minSec
  if (!(span > 0)) return 0
  return clamp01((timeSec - window.minSec) / span)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/player/dragTiming.test.ts`
Expected: PASS, 9 tests.

Also `npx tsc -b` and `npx eslint src/player/dragTiming.ts` — both clean.

- [ ] **Step 5: Commit**

```bash
git add src/player/dragTiming.ts tests/player/dragTiming.test.ts
git commit -m "feat(player): pure drag-to-time mapping for inline re-timing"
```

---

## Task 2: The drag strip component

**Files:**
- Create: `src/player/DragRetimeStrip.tsx`
- Test: `tests/player/DragRetimeStrip.test.tsx`

The component owns no timing policy — it maps pointer position to a time via Task 1 and reports it. Read `src/player/TapAnchorPrompt.tsx` and `src/core/ui/Banner.tsx` first and match their style; the strip replaces the former and should sit in the same visual slot.

- [ ] **Step 1: Write the failing test**

Create `tests/player/DragRetimeStrip.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { DragRetimeStrip } from '../../src/player/DragRetimeStrip'

/**
 * The mechanic this replaces committed the playhead at the instant of a click,
 * so every correction carried the user's reaction latency (~250-400ms, always
 * late). A drag has no such term. These specs pin that the control reports a
 * time derived from POSITION, never from when the interaction happened.
 */

const setup = (over: Partial<ComponentProps<typeof DragRetimeStrip>> = {}) => {
  const onCommit = vi.fn()
  const onPreview = vi.fn()
  render(
    <DragRetimeStrip
      lineIndex={3}
      lineText="テスト行"
      startSec={30}
      remaining={2}
      onCommit={onCommit}
      onPreview={onPreview}
      {...over}
    />,
  )
  return { onCommit, onPreview }
}

describe('DragRetimeStrip', () => {
  it('renders nothing when there is no line to fix', () => {
    const { container } = render(
      <DragRetimeStrip lineIndex={null} startSec={0} onCommit={vi.fn()} onPreview={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('starts at the line current start', () => {
    setup()
    expect(screen.getByRole('slider')).toHaveValue('30')
  })

  // Live feedback is the whole reason a drag beats a tap: the user hears the
  // result while adjusting, instead of guessing and hoping.
  it('previews while dragging, without committing', () => {
    const { onPreview, onCommit } = setup()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '29.2' } })
    expect(onPreview).toHaveBeenCalledWith(29.2)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits the dragged time, not the time of the click', () => {
    const { onCommit } = setup()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '28.8' } })
    fireEvent.click(screen.getByRole('button', { name: /use this|set|apply/i }))
    expect(onCommit).toHaveBeenCalledWith(3, 28.8)
  })

  it('shows how many spots remain', () => {
    setup({ remaining: 3 })
    expect(screen.getByText(/3/)).toBeTruthy()
  })

  it('is operable by keyboard', () => {
    const { onPreview } = setup()
    const slider = screen.getByRole('slider')
    slider.focus()
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    // A range input handles arrows natively; assert it is focusable and labelled
    // so the control is reachable without a pointer.
    expect(document.activeElement).toBe(slider)
    expect(slider).toHaveAccessibleName()
  })
})
```

> If `toHaveValue` / `toHaveAccessibleName` are unavailable, check `src/test-setup.ts` for which jest-dom matchers are registered and use equivalents rather than dropping the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player/DragRetimeStrip.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/player/DragRetimeStrip.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Banner } from '../core/ui/Banner'
import { dragWindowFor, DRAG_WINDOW_HALF_SEC } from './dragTiming'

interface Props {
  /** Flagged line to re-time, or null to render nothing. */
  lineIndex: number | null
  /** The line's text, shown so the user knows what they are matching. */
  lineText?: string
  /** The line's current start (seconds) — the window centres here. */
  startSec: number
  /** How many uncertain spots remain in this song, including this one. */
  remaining?: number
  /** Fires continuously while dragging so the caller can seek and preview. */
  onPreview: (timeSec: number) => void
  /** Fires once, with the chosen time, when the user accepts. */
  onCommit: (lineIndex: number, timeSec: number) => void
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/**
 * Inline re-timing for a line the aligner was unsure of.
 *
 * Replaces a one-tap affordance that committed the playhead at the moment of
 * the click. That carried the user's reaction latency — roughly 250-400ms, and
 * always in the same direction, late — straight into stored timing, where it
 * was then marked 'good' and never revisited. Measured on a real song, tapping
 * the ~4 flagged spots left a 0.30s mean start error with no line worse than
 * 0.82s: the same order as the latency itself.
 *
 * Dragging removes that term entirely. The user adjusts until it matches,
 * hearing the result as they go, and can overshoot and correct — which a tap
 * structurally cannot allow.
 */
export function DragRetimeStrip({
  lineIndex, lineText, startSec, remaining, onPreview, onCommit,
}: Props) {
  const [value, setValue] = useState(startSec)

  // Re-centre when the target line changes, or the strip would keep showing the
  // previous line's time.
  useEffect(() => { setValue(startSec) }, [lineIndex, startSec])

  if (lineIndex === null) return null

  const win = dragWindowFor(startSec, DRAG_WINDOW_HALF_SEC)
  const more = typeof remaining === 'number' && remaining > 1 ? ` · ${remaining} spots left` : ''

  return (
    <Banner severity="action">
      <div className="space-y-2">
        <p className="text-xs text-white/70">
          Drag until it lines up with what you hear{more}
          {lineText ? <span className="block text-white/50 truncate">{lineText}</span> : null}
        </p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={win.minSec}
            max={win.maxSec}
            step={0.05}
            value={value}
            aria-label={`Line ${lineIndex + 1} start time`}
            className="flex-1 accent-cinnabar-accent slider-touch"
            onChange={(e) => {
              const t = Number(e.target.value)
              setValue(t)
              onPreview(t)
            }}
          />
          <span className="text-white/70 text-xs tabular-nums w-14 text-right">{fmt(value)}</span>
          <button
            type="button"
            className="min-h-11 px-3 rounded-lg text-sm font-medium bg-cinnabar-accent text-white touch-manipulation"
            onClick={() => onCommit(lineIndex, value)}
          >
            Use this
          </button>
        </div>
      </div>
    </Banner>
  )
}
```

> `Banner` may not accept arbitrary children in this shape. Read it first; if it only takes a string, either extend it minimally or render the strip alongside a `Banner` rather than inside it — and say which you chose and why.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/player/DragRetimeStrip.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/player/DragRetimeStrip.tsx tests/player/DragRetimeStrip.test.tsx
git commit -m "feat(player): drag strip for re-timing an uncertain line"
```

---

## Task 3: Swap it in

**Files:**
- Modify: `src/player/PlayerView.tsx`
- Delete: `src/player/TapAnchorPrompt.tsx`
- Test: `tests/player/PlayerView.dragRetime.test.tsx` (create)

- [ ] **Step 1: Find and read the render site**

It is the `{mode === 'play' && canPlayback && (<TapAnchorPrompt ... />)}` block, around `PlayerView.tsx:1381`. Locate by content, not line number.

- [ ] **Step 2: Write the failing test**

Create `tests/player/PlayerView.dragRetime.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { usePlayerStore } from '../../src/player/PlayerStore'
import { PlayerView } from '../../src/player/PlayerView'

/**
 * Correction used to commit the playhead at the instant of a click, carrying
 * the user's reaction latency (~250-400ms, always late) into stored timing --
 * which was then marked 'good' and never revisited. These specs pin that the
 * committed time comes from the drag POSITION, and that the swap reuses the
 * existing anchor commit path rather than duplicating it.
 */

vi.mock('../../src/core/opfs/audio', () => ({ getAudioFile: vi.fn(async () => new File([], 'x.mp3')) }))
vi.mock('../../src/player/AudioEngine', () => ({
  AudioEngine: class {
    duration = 120; position = 0
    async load() {} play() {} pause() {} seek() {} destroy() {} setRate() {} setVolume() {}
    onTimeUpdate() {} onEnd() {}
  },
}))

const song = () => ({
  id: 'drag-1', title: 'T', artist: 'A', audioStoredPath: 'drag-1',
  lyrics: {
    lines: [
      { startTime: 0, endTime: 5, original: 'first', translation: '' },
      { startTime: 30, endTime: 35, original: 'flagged line', translation: '' },
    ],
    sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'auto',
    // Marks line 1 as one selectAnchorTargets will return.
    lineAlignmentQuality: ['good', 'needs_review'],
  },
  syncState: 'synced', createdAt: new Date(),
})

beforeEach(async () => {
  usePlayerStore.setState({ duration: 0, position: 0, currentSongId: null })
  await db.songs.clear()
  await db.songs.put(song() as never)
})

/** Put the playhead on the flagged line so it becomes the active anchor target. */
async function openOnFlaggedLine() {
  render(<PlayerView songId="drag-1" onBack={vi.fn()} />)
  await waitFor(() => expect(screen.getByText('flagged line')).toBeTruthy())
  usePlayerStore.setState({ currentSongId: 'drag-1', position: 31, duration: 120 })
}

describe('re-timing a flagged line by dragging', () => {
  it('offers the drag strip for the flagged line', async () => {
    await openOnFlaggedLine()
    await waitFor(() => expect(screen.getByRole('slider', { name: /start time/i })).toBeTruthy())
  })

  it('commits the dragged time and routes through the anchor path', async () => {
    await openOnFlaggedLine()
    const slider = await screen.findByRole('slider', { name: /start time/i })

    fireEvent.change(slider, { target: { value: '29.4' } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))

    await waitFor(async () => {
      const saved = await db.songs.get('drag-1')
      expect(saved?.lyrics.lines[1].startTime).toBeCloseTo(29.4, 2)
      // Proves reuse of handleTapAnchor rather than a duplicate commit path.
      expect(saved?.lyrics.timingAnchors).toEqual(
        expect.arrayContaining([expect.objectContaining({ lineIndex: 1, source: 'user' })]),
      )
      expect(saved?.lyrics.lineAlignmentQuality?.[1]).toBe('good')
    })
  })
})
```

The third assertion is the important one: it proves the swap reuses the tested commit path rather than duplicating it.

> `selectAnchorTargets` and `selectActiveAnchorTarget` decide whether the strip shows, and the latter has a grace window (`ANCHOR_LATCH_LINES`). If the strip does not appear at position 31, read `src/lyrics/anchorRefit.ts` and adjust the seeded times or position so the flagged line is genuinely the active target — do NOT relax the assertion to make it pass.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/player/PlayerView.dragRetime.test.tsx`
Expected: FAIL — the strip does not render.

- [ ] **Step 4: Implement the swap**

Replace the import of `TapAnchorPrompt` with `DragRetimeStrip`, and the render block with:

```tsx
      {mode === 'play' && canPlayback && anchorTargetActive !== null && (
        <DragRetimeStrip
          lineIndex={anchorTargetActive}
          lineText={lines[anchorTargetActive]?.original}
          startSec={lines[anchorTargetActive]?.startTime ?? 0}
          remaining={anchorTargets.length}
          onPreview={(t) => seek(t)}
          onCommit={handleTapAnchor}
        />
      )}
```

`handleTapAnchor` is unchanged — it already takes `(lineIndex, time)`. Do not rename it in this task; a rename would obscure the diff. Note it in your report as a follow-up if you think it is now misnamed.

Use whatever seek function the file already uses for lyric-row seeking (`seek`/`goToLyricLine` are both in scope — read which is appropriate). Preview must seek WITHOUT committing.

- [ ] **Step 5: Delete the superseded component**

```bash
git rm src/player/TapAnchorPrompt.tsx
```

If any test imports it, update that test. If a test asserts tap-anchor behaviour that still matters, port the assertion rather than deleting it — and say which you ported.

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/player && npx tsc -b && npx eslint src/player`
Expected: all pass, clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(player): re-time uncertain lines by dragging, not tapping"
```

---

## Task 4: Measure the window and the feedback

The spec flags two values as provisional. Settle them by use, not intuition.

**Files:** possibly `src/player/dragTiming.ts` (the constant) — measurement otherwise.

- [ ] **Step 1: Drive it live**

Start the dev server and open a song with a flagged line (seed `lineAlignmentQuality` if needed). Use the drag strip on several lines.

- [ ] **Step 2: Judge the window**

`DRAG_WINDOW_HALF_SEC` is 2.5s provisionally. Too wide and small movements are imprecise; too narrow and a badly-placed line cannot be reached without repeated passes. Try 1.5s, 2.5s and 4s and report which is usable, with reasoning.

- [ ] **Step 3: Judge the feedback**

The strip currently seeks on drag (`onPreview`). The spec asks whether *looping* a short window around the line is better or maddening. Try it. **A finding of "looping is worse, plain scrub is better" is a legitimate and useful result** — do not implement looping just because the spec mentioned it.

- [ ] **Step 4: Record**

Update the constant if measurement justifies it, replace the "PROVISIONAL" comment with what was measured and why, and commit. If the value stands, say so explicitly rather than silently leaving it.

---

## Task 5: Onset snapping (pure)

Assist, not a second mechanism. Everything from here is additive to a working feature.

**Files:**
- Create: `src/player/onsetSnap.ts`
- Test: `tests/player/onsetSnap.drag.test.ts`

- [ ] **Step 1: Write the failing test**

Follow the synthetic-signal pattern in `tests/lyrics/onsetSnap.test.ts` (it builds a `VocalActivitySignal` with `hopSec`, `activity`, `onset`, `source`). Create `tests/player/onsetSnap.drag.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { snapToOnset } from '../../src/player/onsetSnap'
import type { VocalActivitySignal } from '../../src/ai-pipeline/vocalActivity'

/** activity 0 before onsetSec, 1 after; one strong onset frame at onsetSec. */
function signalWithOnset(onsetSec: number, durSec = 30): VocalActivitySignal {
  const hopSec = 0.02
  const frames = Math.ceil(durSec / hopSec)
  const activity = new Float32Array(frames)
  const onset = new Float32Array(frames)
  const oi = Math.floor(onsetSec / hopSec)
  for (let f = oi; f < frames; f++) activity[f] = 1
  onset[oi] = 1
  return { hopSec, activity, onset, source: 'stem' }
}

describe('snapToOnset', () => {
  // The claim the whole thread rests on: a correction landing late should be
  // pulled back to the real acoustic onset.
  it('recovers a real onset from a late tap', () => {
    const sig = signalWithOnset(10)
    const r = snapToOnset(sig, 10.25)
    expect(r.snapped).toBe(true)
    expect(r.timeSec).toBeCloseTo(10, 1)
  })

  // The negative half. Without this, a snap that moved EVERYTHING would pass the
  // test above and look correct while being useless.
  it('leaves a time alone when no onset is near', () => {
    const sig = signalWithOnset(10)
    const r = snapToOnset(sig, 25)
    expect(r.snapped).toBe(false)
    expect(r.timeSec).toBe(25)
  })

  it('leaves a time alone when the signal has no onsets at all', () => {
    const sig = signalWithOnset(10)
    sig.onset.fill(0)
    const r = snapToOnset(sig, 10.25)
    expect(r.snapped).toBe(false)
    expect(r.timeSec).toBe(10.25)
  })

  it('does not drag a time forward across a large gap', () => {
    const sig = signalWithOnset(10)
    const r = snapToOnset(sig, 8)
    expect(r.timeSec).toBeLessThanOrEqual(8 + 0.2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player/onsetSnap.drag.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/player/onsetSnap.ts`:

```ts
import { nearestOnset, type VocalActivitySignal } from '../ai-pipeline/vocalActivity'

/** How far back to look. A correction lands late far more often than early, so
 * the search is deliberately asymmetric — the same asymmetry nearestOnset was
 * built for. */
const MAX_BEFORE_SEC = 0.6
const SLACK_AFTER_SEC = 0.15
/** Onset strength a peak must clear to count. Below this, ordinary spectral
 * churn would "snap" a correct time to noise. */
const MIN_STRENGTH = 0.35

export interface SnapResult {
  timeSec: number
  /** False when nothing qualified — the caller's time is returned untouched. */
  snapped: boolean
}

/**
 * Pull a user-chosen time onto a nearby genuine vocal onset.
 *
 * Deliberately conservative: when no peak clears MIN_STRENGTH inside the
 * window, the user's own time wins. A snap that moved everything would be worse
 * than no snap — it would replace the user's judgement with the envelope's.
 */
export function snapToOnset(
  signal: VocalActivitySignal | null | undefined,
  timeSec: number,
  opts?: { maxBefore?: number; slackAfter?: number; minStrength?: number },
): SnapResult {
  if (!signal || !Number.isFinite(timeSec)) return { timeSec, snapped: false }
  const hit = nearestOnset(signal, timeSec, {
    maxBefore: opts?.maxBefore ?? MAX_BEFORE_SEC,
    slackAfter: opts?.slackAfter ?? SLACK_AFTER_SEC,
    minStrength: opts?.minStrength ?? MIN_STRENGTH,
  })
  return hit === null ? { timeSec, snapped: false } : { timeSec: hit, snapped: true }
}
```

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run tests/player/onsetSnap.drag.test.ts && npx tsc -b && npx eslint src/player/onsetSnap.ts`

```bash
git add src/player/onsetSnap.ts tests/player/onsetSnap.drag.test.ts
git commit -m "feat(player): snap a chosen time to a nearby vocal onset"
```

---

## Task 6: Decide how the signal becomes available

`VocalActivitySignal` is computed during alignment and discarded — it is not on the stored model. Snapping needs it at correction time. **Measure before choosing.**

**Files:** measurement; then whichever of `src/core/types/index.ts` / `AutoAlignFlow.tsx` the decision implies.

- [ ] **Step 1: Measure both costs**

- **Persist:** compute the byte size of a real song's `activity` + `onset` arrays as `Float32Array` (frames = duration / hopSec, two arrays). Confirm Dexie stores typed arrays without a JSON blow-up — test it, do not assume.
- **Recompute:** time `computeVocalActivity` on a decoded song on this machine. Include the decode.

- [ ] **Step 2: Choose and record**

Persisting costs storage on every song, including ones never corrected. Recomputing costs a wait at the moment the user wants to fix something. Pick, and write the measured numbers into the code comment justifying it.

If recompute is fast enough (say under ~2s), prefer it — no migration, no storage growth, no stale-signal risk when audio is replaced.

- [ ] **Step 3: Implement the chosen path and commit**

---

## Task 7: Wire snapping into the strip

**Files:** `src/player/DragRetimeStrip.tsx`, `src/player/PlayerView.tsx`, tests.

This task is deliberately specified by behaviour rather than exact code: how the signal reaches the strip depends on which option Task 6's measurement selected (a stored field vs an on-demand recompute), so the wiring cannot be pinned before that result exists. Everything below is required regardless of which was chosen.

- [ ] **Step 1: Snap on commit, not during drag**

Snapping mid-drag would fight the user's finger. Apply `snapToOnset` when the user accepts, and only when a signal is available.

- [ ] **Step 2: Show it happened**

If the time moved, say so — a silent adjustment of the user's explicit choice is worse than none. A brief "snapped to vocal onset" note is enough. The existing undo toast already covers reverting.

- [ ] **Step 3: Test**

Assert: with a signal, a late accept commits the snapped time; with no signal, it commits exactly what the user chose. The second is the regression guard for YouTube songs, which have no PCM.

- [ ] **Step 4: Verify and commit**

Run the full suite. `npx vitest run && npx tsc -b && npx eslint src`

---

## Out of Scope

- The Phase 2 global offset+scale fit (`linearTimingFit`, `SyncCalibrator`). Different engine, different spec.
- Changing `refitAroundAnchors`, `selectAnchorTargets`, or any alignment behaviour.
- Removing `TimestampPopover` — it stays for deliberate single-line editing, including end times.
- `TapSyncEditor`'s raw `audioPosition()` bias (thread C3). It has the same defect; fixing it is a larger change and is not attempted here.
