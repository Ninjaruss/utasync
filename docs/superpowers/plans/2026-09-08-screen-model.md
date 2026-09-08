# Two-Axis Screen Model (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "what is on screen" a single typed value, so the effects that today enumerate screens by name instead read a declared need — turning a whole class of silent bug into a compile error.

**Architecture:** A two-axis `Screen` type (`{ base, overlay }`) lands *alongside* the seven booleans it replaces, derived from them, so `main` ships at every commit. Effects then move onto `screenNeeds(screen)`, which switches exhaustively over the union. Each boolean is deleted only once nothing reads it. Before any of that, `<Overlay>` gains a real backdrop element so its two class props stop being the same prop under two names.

**Tech Stack:** React 19, TypeScript (strict), Vite, Tailwind 3, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-05-ui-finalization-design.md` (Phase 3)
**Registry:** `docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md` — 30 rows with `Base-or-overlay` and `tiers` columns. **Union membership comes from there, not from this plan's prose.**

## Global Constraints

- **This is the phase the spec calls highest-risk.** If the two-axis model does not fit a surface, **STOP and report** rather than bending the model. That instruction is in the spec and it is binding.
- **Do NOT split `PlayerView.tsx` or `PlayerControls.tsx`.** That is Phase 6, and its seams are supposed to come *from* this model.
- Do not touch `src/ai-pipeline` alignment math.
- No new features. No visual redesign. Every migration must be visually identical.
- Full suite is **296 files passed / 2 skipped, 2339 tests / 5 skipped** and must stay green.
- **Verify Tailwind class precedence against a full build, never dev-server `getComputedStyle`:** `npx tailwindcss -c tailwind.config.ts -i src/index.css -o /tmp/probe.css`. JIT appends newly-typed classes last so they appear to win; a real build re-sorts them. Equal specificity in the same media block is decided by source order, ascending scale — `p-6` beats `p-4` however you write them.
- **A `vitest -t` filter that matches nothing exits 0.** Never treat a green command as a gate; confirm a non-zero test count.
- **Two pre-existing flakes, separately owned — do not chase or edit:** `tests/player/PlayerView.staleLoad.test.tsx` (fixed `setTimeout` sleeps) and `tests/ai-pipeline/AutoAlignFlow.separation-stall.test.tsx` (`waitFor` timeout under load). If one fails, re-run that file alone, note it, move on.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/ui/Overlay.tsx` (modify) | Gains a real backdrop element for `sheet`/`contained`; `backdropClassName` starts meaning the backdrop. |
| `src/player/screen.ts` (create) | The `Screen` type, its constructors, and `screenNeeds`. Pure — no React, no DOM. |
| `tests/player/screen.test.ts` (create) | Exhaustiveness and need-folding, tested without rendering anything. |
| `src/player/PlayerView.tsx` (modify) | Derives `screen`, moves two effects onto `screenNeeds`, then sheds booleans. **Not split.** |
| The 8 `backdropClassName` call sites (modify, Task 1) | Reclassified per the table in Task 1. |

---

## Task 1: Give `<Overlay>` a real backdrop element

Today `Overlay.tsx` concatenates `[ROOT_CLASS[placement], backdropClassName, className]` onto **one** element, so the two props are the same prop under two names — and since CSS precedence is stylesheet source order, even their relative position is meaningless. The placement table's "Backdrop: yes" is therefore an obligation on callers that nothing enforces.

**Files:**
- Modify: `src/core/ui/Overlay.tsx`
- Modify: the 8 call sites in the table below
- Test: `tests/core/ui/Overlay.test.tsx`

**Interfaces:**
- Produces: `<Overlay>` where `backdropClassName` styles a **separate backdrop child** rendered only for `sheet` and `contained`; `className` styles the root. Later tasks and all future migrations depend on this distinction being real.

**The eight call sites, classified.** Read each before changing it; this table is the analysis, not a substitute for looking:

| Call site | Placement | Current `backdropClassName` | Where it belongs |
|---|---|---|---|
| `TapSyncEditor.tsx:92` | fullscreen | `bg-cinnabar-950` | `className` — opaque root, no backdrop |
| `OffsetAlignScreen.tsx:46` | fullscreen | `bg-cinnabar-950 overflow-hidden` | `className` — same |
| `SecondLanguagePanel.tsx:210` | fullscreen | `bg-cinnabar-950 overflow-hidden` | `className` — same |
| `PlayerView.tsx:2000` | fullscreen | `justify-end sm:justify-center items-center p-4` | `className` — layout only, no dim |
| `ConfirmDialog.tsx:32` | contained | `bg-black/50 rounded-inherit` | **split**: `bg-black/50` → backdrop; `rounded-inherit` → root |
| `Onboarding.tsx:62` | sheet | `z-[70] bg-black/70 items-center justify-center p-4` | **split**: `bg-black/70` → backdrop; rest → `className` |
| `SecondLanguagePanel.tsx:260` | fullscreen | `justify-end sm:justify-center items-center bg-black/60 p-4` | see note below |
| `AutoAlignFlow.tsx:786` | fullscreen | `justify-end md:justify-center items-center bg-black/80 p-4` | see note below |

**Note on the last two — do not silently re-classify them.** Both are `fullscreen` yet carry a dim and centre a panel, i.e. they are semantically *sheets* that chose `fullscreen` to escape `sheet`'s `z-40`. Changing their placement would change scroll-lock and history behaviour, so **leave the placement alone in this task** and put their dim on `className` with the rest. Record the observation in your report — whether the placement taxonomy should grow a `z` option is a question for Task 2's model work, not a change to make here.

- [ ] **Step 1: Write the failing tests**

```tsx
// append to tests/core/ui/Overlay.test.tsx
it('renders a backdrop element for a sheet, carrying backdropClassName', () => {
  const { container } = render(
    <Overlay onClose={vi.fn()} label="S" backdropClassName="bg-black/70">
      <button type="button">inside</button>
    </Overlay>,
  )
  const backdrop = container.querySelector('[data-overlay-backdrop]')
  expect(backdrop).not.toBeNull()
  expect(backdrop!.className).toContain('bg-black/70')
  expect(backdrop!.getAttribute('aria-hidden')).toBe('true')
})

it('does not render a backdrop for fullscreen or anchored', () => {
  const fs = render(
    <Overlay onClose={vi.fn()} placement="fullscreen" label="F"><button>a</button></Overlay>,
  )
  expect(fs.container.querySelector('[data-overlay-backdrop]')).toBeNull()
  fs.unmount()
  const an = render(
    <Overlay onClose={vi.fn()} placement="anchored" role="menu" label="A"><button>b</button></Overlay>,
  )
  expect(an.container.querySelector('[data-overlay-backdrop]')).toBeNull()
})

it('keeps the backdrop out of the focus trap', () => {
  render(
    <Overlay onClose={vi.fn()} label="S"><button type="button">inside</button></Overlay>,
  )
  expect((document.activeElement as HTMLElement).textContent).toBe('inside')
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/core/ui/Overlay.test.tsx`
Expected: the first two fail on a null backdrop. If the third *passes* already, that is fine — it guards a property the change must not break.

- [ ] **Step 3: Implement**

In `src/core/ui/Overlay.tsx`, add above the component:

```tsx
/* Placements whose table row says "Backdrop: yes". A real element rather than a
 * class on the root, so `backdropClassName` and `className` are genuinely two
 * boxes — before this they concatenated onto one element and were the same prop
 * under two names, which made the backdrop obligation unenforceable. */
const HAS_BACKDROP: Record<OverlayPlacement, boolean> = {
  sheet: true, contained: true, fullscreen: false, anchored: false,
}
const DEFAULT_DIM = 'bg-black/60'
```

Then render, replacing the single-div return:

```tsx
  return (
    <div
      ref={ref}
      role={role}
      aria-modal={role === 'dialog' || role === 'alertdialog' ? true : undefined}
      tabIndex={-1}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={[ROOT_CLASS[placement], className].filter(Boolean).join(' ')}
    >
      {HAS_BACKDROP[placement] && (
        /* aria-hidden keeps it out of focusableWithin's initial-focus scan — a
         * full-screen invisible element winning initial focus is a regression
         * this effort has already shipped once. */
        <div
          data-overlay-backdrop=""
          aria-hidden="true"
          className={['absolute inset-0', backdropClassName || DEFAULT_DIM].join(' ')}
        />
      )}
      {children}
    </div>
  )
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run tests/core/ui/Overlay.test.tsx`

- [ ] **Step 5: Reclassify the eight call sites per the table**

Move each value to `className` or split it as the table says. **Then verify visual identity properly:** build the stylesheet once and confirm no class you moved now loses to a `ROOT_CLASS` utility for the same property.

```bash
npx tailwindcss -c tailwind.config.ts -i src/index.css -o /tmp/probe.css
```

Callers that already render their own backdrop child (`SettingsSheet`, `AddSongSheet`, `MobileControlsSheet`, `PlayerView`'s replace-lyrics) now have **two** backdrops if they also pass `backdropClassName`. Check each: keep the caller's own (it carries a click handler) and pass no `backdropClassName`, or delete the caller's and move its handler — say which you chose per surface and why.

- [ ] **Step 6: Full verification and commit**

Run: `npx vitest run` — expected 296 files / 2339 tests, plus your new ones.

```bash
git add -A src tests
git commit -m "refactor: give Overlay a real backdrop element

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The `Screen` type and `screenNeeds`

**Files:**
- Create: `src/player/screen.ts`
- Test: `tests/player/screen.test.ts`

**Interfaces:**
- Produces: `type Screen`, `type ScreenOverlay`, `screenNeeds(screen: Screen): ScreenNeeds`. Tasks 3–7 import all three.

**Why two axes.** A flat union cannot express "the retime overlay is open on top of edit mode", which is a real state. It also mismodels the August critical: tap-through was written as a *replacement* for the player when it is a *layer over* it, which is why entering it unmounted `<YouTubePlayer>` and every tap stamped 0:00. Needs must therefore fold across both axes — an overlay may **add** a need without cancelling the base's.

**Membership** comes from the registry's `Base-or-overlay` column. Two corrections it already records, which the spec's draft union got wrong:
- `songMissing` is **base**, not an overlay — `PlayerView.tsx:1647` is an early `return` with no base underneath.
- `retimeLine` is **inline** today. Modelling it as an overlay is a decision to make and record, not a transcription. If it does not fit, that is a STOP-and-report case.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { screenNeeds, type Screen } from '../../src/player/screen'

const play: Screen = { base: 'play', overlay: null }
const edit: Screen = { base: 'edit', overlay: null }

describe('screenNeeds', () => {
  it('keeps the YouTube iframe mounted under every overlay', () => {
    // The August critical: tap-through replaced the player instead of layering
    // over it, unmounting the iframe so every tap stamped 0:00.
    const overlays: Screen['overlay'][] = [
      { kind: 'tapSync' }, { kind: 'offsetAlign' }, { kind: 'autoAlign' },
      { kind: 'retimeLine', lineIndex: 0 }, { kind: 'lyricsReimport' },
    ]
    for (const overlay of overlays) {
      expect(screenNeeds({ base: 'play', overlay }).youtubeIframe).toBe(true)
    }
  })

  it('lets an overlay ADD the waveform without the base needing it', () => {
    expect(screenNeeds(play).waveform).toBe(false)
    expect(screenNeeds({ base: 'play', overlay: { kind: 'offsetAlign' } }).waveform).toBe(true)
    expect(screenNeeds({ base: 'play', overlay: { kind: 'retimeLine', lineIndex: 3 } }).waveform).toBe(true)
  })

  it('keeps the base need when the overlay does not want it', () => {
    expect(screenNeeds(edit).waveform).toBe(true)
    expect(screenNeeds({ base: 'edit', overlay: { kind: 'lyricsReimport' } }).waveform).toBe(true)
  })

  it('gives global keys to the base alone — any overlay owns its own keystrokes', () => {
    expect(screenNeeds(play).globalKeys).toBe(true)
    expect(screenNeeds({ base: 'play', overlay: { kind: 'tapSync' } }).globalKeys).toBe(false)
  })

  it('drops playback needs on the song-missing base', () => {
    const missing = screenNeeds({ base: 'songMissing', overlay: null })
    expect(missing.youtubeIframe).toBe(false)
    expect(missing.audioEngine).toBe(false)
    expect(missing.globalKeys).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/player/screen.test.ts`
Expected: FAIL — cannot resolve `../../src/player/screen`.

- [ ] **Step 3: Implement**

```ts
// src/player/screen.ts
//
// One value answers "what is on screen". Before this, display was a conjunction
// of seven booleans in PlayerView, and every effect that needed a resource had
// to enumerate the screens that wanted it — so a new screen silently missed one.
// See the waveform gate that sat on "Reading the audio…" forever because the
// offset screen was an unlisted call site.

/** The base layer. A base REPLACES the player; an overlay LAYERS OVER it. */
export type ScreenBase = 'play' | 'edit' | 'songMissing'

/** Layers that open over a base and return to it. Membership comes from the
 * `Base-or-overlay` column of docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md. */
export type ScreenOverlay =
  | { kind: 'tapSync' }
  | { kind: 'offsetAlign' }
  | { kind: 'autoAlign' }
  | { kind: 'retimeLine'; lineIndex: number }
  | { kind: 'lyricsReimport' }

export type Screen = { base: ScreenBase; overlay: ScreenOverlay | null }

export interface ScreenNeeds {
  /** Decoded audio peaks. */
  waveform: boolean
  /** The <YouTubePlayer> iframe must stay mounted — unmounting it stops the clock. */
  youtubeIframe: boolean
  /** The window-level Space/Arrow handler. */
  globalKeys: boolean
  audioEngine: boolean
  autoScroll: boolean
}

const BASE_NEEDS: Record<ScreenBase, ScreenNeeds> = {
  play: { waveform: false, youtubeIframe: true, globalKeys: true, audioEngine: true, autoScroll: true },
  edit: { waveform: true, youtubeIframe: true, globalKeys: true, audioEngine: true, autoScroll: false },
  // An early return with nothing underneath: no transport, no keys.
  songMissing: { waveform: false, youtubeIframe: false, globalKeys: false, audioEngine: false, autoScroll: false },
}

/** What an overlay ADDS to its base. Absent keys mean "inherit the base". */
const OVERLAY_ADDS: Record<ScreenOverlay['kind'], Partial<ScreenNeeds>> = {
  tapSync: { waveform: false },
  offsetAlign: { waveform: true },
  autoAlign: {},
  retimeLine: { waveform: true },
  lyricsReimport: {},
}

/**
 * Folds both axes. An overlay may ADD a need without cancelling the base's —
 * which is the whole point: tap-through needs no waveform, but the iframe
 * underneath it must keep running.
 *
 * The switch over `kind` is exhaustive, so a new overlay that has not declared
 * its needs will not compile. That is the bug class this phase exists to kill.
 */
export function screenNeeds(screen: Screen): ScreenNeeds {
  const base = BASE_NEEDS[screen.base]
  if (!screen.overlay) return base
  const adds = OVERLAY_ADDS[screen.overlay.kind]
  return {
    ...base,
    ...adds,
    // Any overlay owns its own keystrokes; the window-level handler stands down.
    globalKeys: false,
    // Never cancelled by an overlay — see the August critical.
    youtubeIframe: base.youtubeIframe,
  }
}
```

- [ ] **Step 4: Run and see it pass**

Run: `npx vitest run tests/player/screen.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Prove exhaustiveness actually bites**

Temporarily add `| { kind: 'probe' }` to `ScreenOverlay` and run `npx tsc --noEmit`. It **must** error on `OVERLAY_ADDS` for the missing key. Remove the probe and re-run to confirm clean. Report both outputs — a union that compiles with a missing member is not a guard.

- [ ] **Step 6: Commit**

```bash
git add src/player/screen.ts tests/player/screen.test.ts
git commit -m "feat: one typed value for what is on screen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Derive `screen` in `PlayerView` from the existing booleans

Strangler step. The value lands **alongside** what it will replace, so nothing changes behaviour and `main` ships.

**Files:**
- Modify: `src/player/PlayerView.tsx`
- Test: `tests/player/screen.derive.test.ts`

**Interfaces:**
- Consumes: `Screen`, `ScreenOverlay` from Task 2.
- Produces: an exported pure `deriveScreen(...)` that Task 4 onward reads, plus a `screen` value inside the component.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { deriveScreen } from '../../src/player/PlayerView'

describe('deriveScreen', () => {
  it('maps songMissing to a base, not an overlay', () => {
    expect(deriveScreen({ songMissing: true, mode: 'play', alignMode: null, anchorTargetActive: null, showLyricsReimport: false }))
      .toEqual({ base: 'songMissing', overlay: null })
  })

  it('maps the three align modes onto overlays over their base', () => {
    expect(deriveScreen({ songMissing: false, mode: 'play', alignMode: 'tap', anchorTargetActive: null, showLyricsReimport: false }))
      .toEqual({ base: 'play', overlay: { kind: 'tapSync' } })
    expect(deriveScreen({ songMissing: false, mode: 'edit', alignMode: 'offset', anchorTargetActive: null, showLyricsReimport: false }))
      .toEqual({ base: 'edit', overlay: { kind: 'offsetAlign' } })
  })

  it('carries the line index for a retime target, whether user-opened or app-suggested', () => {
    // anchorTargetActive is `retimingLine ?? anchorTargetSuggested` — the app
    // suggests lines it is unsure about, and the strip renders for those too.
    // Keying on retimingLine alone would silently drop the waveform for every
    // suggested retime.
    expect(deriveScreen({ songMissing: false, mode: 'play', alignMode: null, anchorTargetActive: 7, showLyricsReimport: false }))
      .toEqual({ base: 'play', overlay: { kind: 'retimeLine', lineIndex: 7 } })
  })

  it('is plain play with nothing set', () => {
    expect(deriveScreen({ songMissing: false, mode: 'play', alignMode: null, anchorTargetActive: null, showLyricsReimport: false }))
      .toEqual({ base: 'play', overlay: null })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/player/screen.derive.test.ts`

- [ ] **Step 3: Implement**

Export from `PlayerView.tsx`, above the component:

```tsx
/** Derives the screen from the booleans it will replace. Strangler step: the
 * value lands alongside them so nothing changes behaviour, and each boolean is
 * deleted only once nothing reads it. Precedence matters — songMissing is a
 * BASE (an early return with nothing underneath), so it wins over everything. */
export function deriveScreen(s: {
  songMissing: boolean
  mode: 'play' | 'edit'
  alignMode: AlignMode | null
  /** `retimingLine ?? anchorTargetSuggested`, already gated to play mode by
   * PlayerView:750. NOT `retimingLine` — the app suggests retime targets the
   * user never opened, and the strip renders for those too. */
  anchorTargetActive: number | null
  showLyricsReimport: boolean
}): Screen {
  if (s.songMissing) return { base: 'songMissing', overlay: null }
  const base: ScreenBase = s.mode
  if (s.alignMode === 'tap') return { base, overlay: { kind: 'tapSync' } }
  if (s.alignMode === 'offset') return { base, overlay: { kind: 'offsetAlign' } }
  if (s.alignMode === 'auto') return { base, overlay: { kind: 'autoAlign' } }
  if (s.anchorTargetActive !== null) return { base, overlay: { kind: 'retimeLine', lineIndex: s.anchorTargetActive } }
  if (s.showLyricsReimport) return { base, overlay: { kind: 'lyricsReimport' } }
  return { base, overlay: null }
}
```

Inside the component, after the seven `useState` bindings:

```tsx
  const screen = deriveScreen({ songMissing, mode, alignMode, anchorTargetActive, showLyricsReimport })
  const needs = screenNeeds(screen)
```

**Nothing reads `needs` yet.** Add `// eslint-disable-next-line @typescript-eslint/no-unused-vars` only if lint objects; do not invent a consumer to silence it.

- [ ] **Step 4: Run, then run the full suite**

Run: `npx vitest run tests/player/screen.derive.test.ts` then `npx vitest run`.
Expected: no behaviour change at all — this task adds a derived value and reads nothing.

- [ ] **Step 5: Commit**

```bash
git add src/player/PlayerView.tsx tests/player/screen.derive.test.ts
git commit -m "refactor: derive the screen value alongside the booleans it will replace

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Move the waveform effect onto `screenNeeds`

This is the effect whose enumeration caused a shipped bug: the offset screen sat on "Reading the audio…" indefinitely because it was an unlisted call site.

**Files:**
- Modify: `src/player/PlayerView.tsx:823`
- Test: existing `tests/player/PlayerView.offsetAlign.test.tsx`, `tests/player/PlayerView.dragRetime.test.tsx`

**Interfaces:**
- Consumes: `needs` from Task 3.

- [ ] **Step 1: Replace the enumeration**

The line today is:

```ts
    if ((anchorTargetActive === null && mode !== 'edit' && alignMode !== 'offset') || !id) return
```

Replace with:

```ts
    if (!needs.waveform || !id) return
```

and add `needs.waveform` to the dependency array in place of `anchorTargetActive`, `mode` and `alignMode`.

**This was checked while writing the plan, and it nearly bit.** `anchorTargetActive` (`PlayerView.tsx:750`) is `mode === 'play' ? (retimingLine ?? anchorTargetSuggested) : null` — **not** `retimingLine`. `anchorTargetSuggested` is the app proposing a line it is unsure about, and the drag-retime strip renders for those too (`:1739`). Task 3's `deriveScreen` therefore keys on `anchorTargetActive`, so both the user-opened and app-suggested cases map to the `retimeLine` overlay and keep the waveform.

Confirm that holds before you delete the old clause: `screenNeeds` must return `waveform: true` for a play base with a `retimeLine` overlay, and the strip's own render at `:1739` must still gate on the same value. If any *other* reader of `anchorTargetActive` turns out not to be represented, STOP and report — do not keep the old clause alongside the new one.

- [ ] **Step 2: Run the guarding tests**

Run: `npx vitest run tests/player/PlayerView.offsetAlign.test.tsx tests/player/PlayerView.dragRetime.test.tsx tests/player/PlayerView.dragRetime.lifecycle.test.tsx`
Expected: PASS. A failure here means the need mapping is wrong, not the test.

- [ ] **Step 3: Full suite and commit**

```bash
npx vitest run
git add src/player/PlayerView.tsx
git commit -m "refactor: the waveform effect declares a need instead of listing screens

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Move the global keyboard handler onto `screenNeeds`

**Files:**
- Modify: `src/player/PlayerView.tsx:1397`
- Test: `tests/player/PlayerView.keyboard.test.tsx`, `tests/player/PlayerView.shortcut-guard.test.tsx`

- [ ] **Step 1: Replace the enumeration**

Today:

```ts
    if (alignMode) return
```

Replace with:

```ts
    if (!needs.globalKeys) return
```

and swap `alignMode` for `needs.globalKeys` in the dependency array.

This is a **behaviour widening**: the handler previously stood down only for `alignMode`, and now stands down for every overlay — including `retimeLine` and `lyricsReimport`, where Space previously toggled playback underneath an open panel. That is the intended fix, but it is a change: verify the existing keyboard tests still pass and say in your report which overlays newly suppress the handler.

- [ ] **Step 2: Run the guarding tests, then the suite**

Run: `npx vitest run tests/player/PlayerView.keyboard.test.tsx tests/player/PlayerView.shortcut-guard.test.tsx` then `npx vitest run`.

- [ ] **Step 3: Commit**

```bash
git add src/player/PlayerView.tsx
git commit -m "refactor: the keyboard handler stands down for every overlay, not just align

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Render from `screen`, and delete `alignMode` and `mode`

**Files:**
- Modify: `src/player/PlayerView.tsx`
- Test: `tests/player/PlayerView.tap-sync-overlay.test.tsx`, `PlayerView.offsetAlign.test.tsx`, `PlayerView.edit-toggle.test.tsx`, `PlayerView.auto-align-result.test.tsx`

- [ ] **Step 1: Switch the render sites**

The three overlay render sites currently gate on `alignMode === 'tap' | 'offset' | 'auto'`. Change each to read `screen.overlay?.kind`. Change the Play/Edit gating to `screen.base`.

**`tests/player/PlayerView.tap-sync-overlay.test.tsx` asserts `<YouTubePlayer>` stays mounted while tap-through is open.** If it fails, the render change reintroduced the August critical — fix the render, never the test.

- [ ] **Step 2: Replace the setters with one transition function**

Add beside `deriveScreen`:

```tsx
/** The only way to change screens. A single entry point is what makes
 * "reopened after dismissal" unreachable rather than guarded by a useRef. */
function openOverlay(next: ScreenOverlay) { /* set the backing state for `next` */ }
function closeOverlay() { /* clear it */ }
```

Implement them over the still-present booleans — this task changes *reads*, not storage.

- [ ] **Step 3: Delete `alignMode` and `mode` only once nothing reads them**

Run `grep -n "alignMode\|\bmode\b" src/player/PlayerView.tsx` and confirm the only remaining uses are inside `deriveScreen`'s inputs and the setters. Then collapse them into `screen` state proper.

**If a read remains that does not fit the model, STOP and report it.** That is the spec's instruction and this is the task where it is most likely to trigger.

- [ ] **Step 4: Guarding tests, full suite, commit**

```bash
npx vitest run tests/player/PlayerView.tap-sync-overlay.test.tsx tests/player/PlayerView.offsetAlign.test.tsx tests/player/PlayerView.edit-toggle.test.tsx
npx vitest run
git add src/player/PlayerView.tsx
git commit -m "refactor: render from the screen value and retire alignMode/mode

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Shed the remaining booleans

**Files:**
- Modify: `src/player/PlayerView.tsx`

Collapse, one commit each so a regression is bisectable: `songMissing`, `retimingLine`, `showLyricsReimport`. Leave `pendingReplace` and `lyricsLoading` alone — `pendingReplace` carries data rather than screen identity, and `lyricsLoading` is transient progress owned by `<BlockingOverlay>`. Record that decision rather than forcing them into the union.

- [ ] **Step 1: One boolean at a time**

For each: confirm every read is served by `screen`, delete the `useState`, run the full suite, commit. Do not batch three deletions into one commit.

- [ ] **Step 2: Report the final state count**

`grep -c "const \[" src/player/PlayerView.tsx` — was 23 at the start of this phase. Report the number and which bindings remain and why.

---

## Task 8: Lock the model in

**Files:**
- Modify: `src/player/screen.ts`
- Test: `tests/player/screen.test.ts`
- Modify: `docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md`

- [ ] **Step 1: Add an exhaustiveness assertion**

```ts
/** Compile-time proof that every overlay kind declares its needs. */
const _exhaustive: Record<ScreenOverlay['kind'], Partial<ScreenNeeds>> = OVERLAY_ADDS
void _exhaustive
```

- [ ] **Step 2: Record the outcome in the registry**

Add a short section to the audit noting which registry rows became `ScreenOverlay` members, which stayed inline, and why — so Phase 4 reads the model's real membership rather than re-deriving it.

- [ ] **Step 3: Full verification and commit**

```bash
npx tsc --noEmit && npx eslint src && npx vitest run
git add -A src tests docs
git commit -m "test: lock the screen model's exhaustiveness and record its membership

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Phase 3 requires: the two-axis model (Task 2), `screenNeeds` exhaustive over the union (Tasks 2 and 8), effects reading needs instead of enumerating call sites (Tasks 4 and 5), the strangler migration with every commit shipping (Tasks 3, 6, 7), and membership from the registry rather than invention (Tasks 2 and 8). The user's backdrop decision is Task 1. The spec's "do not bend the model — stop and report" instruction is repeated at the two points it is most likely to trigger (Tasks 4 and 6). Covered.

**Placeholder scan.** Tasks 1–5 and 8 carry runnable code. Tasks 6 and 7 describe edits rather than quoting `PlayerView.tsx` wholesale, because the requirement there is *"change reads, keep storage"* and *"delete only once nothing reads it"* — quoting a 2125-line file's render tree would invite copy errors and go stale against the earlier tasks in the same phase. Each names its files, its verification command, and its stop condition.

**Type consistency.** `Screen`, `ScreenBase`, `ScreenOverlay`, `ScreenNeeds` and `screenNeeds` are declared once in Task 2 and used unchanged in 3–8. `deriveScreen`'s parameter object in Task 3 matches the five booleans Task 6 later retires. `OVERLAY_ADDS` is keyed on `ScreenOverlay['kind']` in both Task 2 and Task 8's assertion.

**A defect this self-review caught, and the reason the model changed shape.** The plan originally had `deriveScreen` key on `retimingLine`. It is wrong: the waveform effect keys on `anchorTargetActive` = `retimingLine ?? anchorTargetSuggested`, and `anchorTargetSuggested` is an app-proposed retime target the user never opened. Keying on `retimingLine` would have silently stopped the waveform loading for every suggested retime — the same failure as the offset screen sitting on "Reading the audio…", reintroduced by the very phase meant to eliminate it. `deriveScreen` now takes `anchorTargetActive`, and Task 4 states the finding instead of posing it as an open question.

**Remaining risk.** `retimeLine` is modelled as an overlay although the strip is inline today (registry row 30). Task 2 records this as a decision rather than a transcription; if it does not fit during Task 6, the spec's stop-and-report instruction applies.
