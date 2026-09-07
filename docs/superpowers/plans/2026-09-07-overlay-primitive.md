# `<Overlay>` Primitive (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every layered surface in the app one door — a shared `<Overlay>` whose `onClose` is non-optional, which composes the existing focus/Escape/Back hooks and adds the two things nothing in the codebase has yet: scroll lock, and Back-closes on more than two surfaces.

**Architecture:** `<Overlay>` is mostly **composition, not construction**. `useModalDialog` (focus trap, Escape, focus restore), `useHistoryDismiss` (Back), and `useOutsideDismiss` already exist and are carefully reasoned — this phase wraps them behind one component and one `placement` prop, adds a reference-counted scroll lock, then migrates surfaces in batches. Transient progress overlays get a deliberately *separate* component so the required-`onClose` contract is never weakened.

**Tech Stack:** React 19, TypeScript, Tailwind 3, Vitest + @testing-library/react, ESLint 10 (flat config).

**Spec:** `docs/superpowers/specs/2026-09-05-ui-finalization-design.md` (Phase 2)
**Inventory:** `docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md` — the 30-row registry this phase migrates from.

## Global Constraints

Copied from the spec and the Phase 1 audit. Every task's requirements implicitly include these.

- No new features. No visual redesign. **Migrations must be visually identical** — same Tailwind classes on the panel, same backdrop, same positioning. If a migration changes what the user sees, it is wrong.
- `src/ai-pipeline` alignment math is out of scope; any movement in alignment baselines means the boundary was crossed.
- No 320px header redesign — 375px is the real phone floor.
- **Do not retire `tests/player/menus.escape.test.tsx`** until the registry-driven table test demonstrably covers `DisplayMenu` *and* the Edit-mode More menu. Retiring them earlier drops real coverage while reporting 100% (spec success criterion 3).
- **The Tier-4 lint rule is keyed on `useModalDialog` / dialog roles, NOT on `fixed inset-0`.** That filter was Phase 1's Critical finding: it cannot see `ConfirmDialog` (`absolute inset-0`) or `DisplayMenu` (portalled `fixed z-50`).
- Registry **row 29 (mobile controls sheet) is phone-only** — `PlayerControls.tsx:1672` opens a `mode === 'play' && (isDesktop ? … : …)` ternary and it renders only in the non-desktop arm from `:1718`. Desktop uses a *different* surface for the same job, `SavedLoopsPanelSection` at `:1705`. Do not model them as one surface.
- The full suite must stay green: **291 files / 2260 tests / 2 skipped**. Run `npx vitest run` before every commit that touches `src/`.
- **Adding an export to `src/ai-pipeline/capability.ts` breaks partial `vi.mock` factories of that module.** This bit the previous session — five PlayerView test files mock it with an object literal and fail on any new export. Nothing in this plan should need to touch that module, but if you do, grep `vi.mock.*capability` and patch every factory.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/ui/scrollLock.ts` (create) | Reference-counted body scroll lock. Pure DOM, no React. |
| `src/core/ui/Overlay.tsx` (create) | The one door. Composes `useModalDialog` + `useHistoryDismiss` + `useOutsideDismiss` + scroll lock. `onClose` non-optional. |
| `src/core/ui/BlockingOverlay.tsx` (create) | Transient progress/loading layers that deliberately have **no** exit. Separate component so `<Overlay>`'s contract stays absolute. |
| `tests/core/ui/overlaySurfaces.tsx` (create) | The registry-driven table: one entry per migrated surface, with how to mount it and how to open it. |
| `tests/core/ui/Overlay.contract.test.tsx` (create) | The Tier-2 table test. Iterates the registry — a new surface is covered the moment it is registered. |
| `eslint.config.js` (modify) | Tier-4 ratchet: no `useModalDialog` / dialog role outside `Overlay.tsx`. |
| Migration targets (modify, batched) | `ConfirmDialog`, `Onboarding`, `AddSongSheet`, `SettingsSheet`, `TapSyncEditor`, `OffsetAlignScreen`, `AutoAlignFlow`, `PlayerView` dialogs, `EditMode` dialogs + More menu, `SecondLanguagePanel`, `AlignmentEditor`, `DisplayMenu`, `WordLookupPopover`, `TimestampPopover`, `TranslationRepairPopover`, `PlayerControls` menus + mobile sheet. |

**Out of scope for this phase** (they are not layers): registry rows 1, 2, 3, 8, 9 are **base** surfaces (Landing, Library, Player, Edit mode, song-not-in-library) and belong to Phase 3's base axis; rows 6, 7 and 30 are **inline** panels inside a surface, not layers over one.

---

## Task 1: Reference-counted scroll lock

Nothing in the codebase locks background scroll today — a grep for `document.body.style` returns nothing. Overlays therefore scroll the page behind them.

**Files:**
- Create: `src/core/ui/scrollLock.ts`
- Test: `tests/core/ui/scrollLock.test.ts`

**Interfaces:**
- Produces: `acquireScrollLock(): () => void` — call to lock, call the returned function to release. Later tasks call this from `<Overlay>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { acquireScrollLock } from '../../../src/core/ui/scrollLock'

afterEach(() => {
  document.body.style.overflow = ''
})

describe('acquireScrollLock', () => {
  it('locks the body while held and restores on release', () => {
    const release = acquireScrollLock()
    expect(document.body.style.overflow).toBe('hidden')
    release()
    expect(document.body.style.overflow).toBe('')
  })

  it('stays locked until the LAST holder releases', () => {
    const a = acquireScrollLock()
    const b = acquireScrollLock()
    a()
    expect(document.body.style.overflow).toBe('hidden')
    b()
    expect(document.body.style.overflow).toBe('')
  })

  it('restores whatever overflow the page already had', () => {
    document.body.style.overflow = 'scroll'
    const release = acquireScrollLock()
    expect(document.body.style.overflow).toBe('hidden')
    release()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('ignores a double release instead of unlocking someone else', () => {
    const a = acquireScrollLock()
    const b = acquireScrollLock()
    a()
    a()
    expect(document.body.style.overflow).toBe('hidden')
    b()
    expect(document.body.style.overflow).toBe('')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/core/ui/scrollLock.test.ts`
Expected: FAIL — cannot resolve `../../../src/core/ui/scrollLock`.

- [ ] **Step 3: Implement**

```ts
/**
 * Body scroll lock, reference-counted because overlays stack (a ConfirmDialog
 * over a sheet, a popover over the player). A naive lock/unlock pair would let
 * the inner overlay's unmount unlock the page while the outer one is still open.
 *
 * The pre-lock value is captured on the FIRST acquire and restored on the LAST
 * release, so a page that was deliberately `overflow: scroll` gets that back
 * rather than an empty string.
 */
let holders = 0
let previousOverflow = ''

export function acquireScrollLock(): () => void {
  if (holders === 0) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  holders += 1

  let released = false
  return () => {
    // Guard: React 19 StrictMode runs effect cleanups twice in development, and
    // a double release would decrement for a hold that no longer exists and
    // unlock the page under a still-open outer overlay.
    if (released) return
    released = true
    holders -= 1
    if (holders === 0) document.body.style.overflow = previousOverflow
  }
}

/** Test-only: drop all holds. */
export function resetScrollLock(): void {
  holders = 0
  previousOverflow = ''
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/core/ui/scrollLock.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/core/ui/scrollLock.ts tests/core/ui/scrollLock.test.ts
git commit -m "feat: reference-counted scroll lock for stacked overlays

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The `<Overlay>` component

**Files:**
- Create: `src/core/ui/Overlay.tsx`
- Test: `tests/core/ui/Overlay.test.tsx`

**Interfaces:**
- Consumes: `acquireScrollLock()` from Task 1; the existing `useModalDialog(ref, onClose, enabled?)`, `useHistoryDismiss(onDismiss, enabled?)`, `useOutsideDismiss(ref, active, onDismiss)`.
- Produces: `<Overlay>` with props `{ onClose: () => void; children: ReactNode; placement?: 'sheet' | 'fullscreen' | 'contained' | 'anchored'; role?: 'dialog' | 'alertdialog' | 'menu'; label?: string; labelledBy?: string; describedBy?: string; className?: string; backdropClassName?: string; panelRef?: RefObject<HTMLDivElement | null> }`. Every later task uses this exact shape.

**Read before writing.** `src/core/ui/useModalDialog.ts` and `src/core/ui/useHistoryDismiss.ts` carry long docstrings explaining non-obvious choices — `useModalDialog` derives keystroke ownership from DOM containment because effects run children-first, and `useHistoryDismiss` deliberately never pops its own entry because a late pop is indistinguishable from the user's Back. **Do not reimplement or "simplify" either.** Compose them.

**Why the four placements.** They are exactly the shapes in the registry, and they set the other behaviours so callers do not have to:

| `placement` | Position | Backdrop | Scroll lock | Back closes | Outside click closes |
|---|---|---|---|---|---|
| `sheet` | `fixed inset-0`, bottom on mobile / centred ≥md | yes | yes | yes | no |
| `fullscreen` | `fixed inset-0`, opaque panel fills it | n/a | yes | yes | no |
| `contained` | `absolute inset-0` within the nearest positioned ancestor | yes | no — the parent overlay already locked | no — the parent owns the history entry | no |
| `anchored` | caller positions the panel; Overlay adds no positioning | no | no | no | **yes** |

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Overlay } from '../../../src/core/ui/Overlay'
import { resetScrollLock } from '../../../src/core/ui/scrollLock'

afterEach(() => {
  resetScrollLock()
  document.body.style.overflow = ''
})

describe('Overlay', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose} label="Test"><button>inside</button></Overlay>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus into the panel on open', () => {
    render(<Overlay onClose={vi.fn()} label="Test"><button>inside</button></Overlay>)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'inside' }))
  })

  it('restores focus to the opener on unmount', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<Overlay onClose={vi.fn()} label="Test"><button>inside</button></Overlay>)
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('locks background scroll for a sheet and releases it on unmount', () => {
    const { unmount } = render(<Overlay onClose={vi.fn()} label="Test"><button>inside</button></Overlay>)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('does not lock scroll for an anchored menu', () => {
    render(
      <Overlay onClose={vi.fn()} placement="anchored" role="menu" label="Menu">
        <button>item</button>
      </Overlay>,
    )
    expect(document.body.style.overflow).toBe('')
  })

  it('closes an anchored menu on an outside pointerdown', () => {
    const onClose = vi.fn()
    render(
      <Overlay onClose={onClose} placement="anchored" role="menu" label="Menu">
        <button>item</button>
      </Overlay>,
    )
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close a sheet on an outside pointerdown', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose} label="Test"><button>inside</button></Overlay>)
    fireEvent.pointerDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('carries the accessible role and name onto the panel', () => {
    render(<Overlay onClose={vi.fn()} role="alertdialog" label="Discard?"><button>ok</button></Overlay>)
    const panel = screen.getByRole('alertdialog', { name: 'Discard?' })
    expect(panel.getAttribute('aria-modal')).toBe('true')
  })

  it('closes on the browser Back gesture for a sheet', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose} label="Test"><button>inside</button></Overlay>)
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/core/ui/Overlay.test.tsx`
Expected: FAIL — cannot resolve `../../../src/core/ui/Overlay`.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useModalDialog } from './useModalDialog'
import { useHistoryDismiss } from './useHistoryDismiss'
import { useOutsideDismiss } from './useOutsideDismiss'
import { acquireScrollLock } from './scrollLock'

export type OverlayPlacement = 'sheet' | 'fullscreen' | 'contained' | 'anchored'

interface Props {
  /** REQUIRED, and deliberately not optional: an overlay with no way out is the
   * single most repeated severe defect in this app's history (the tap-through
   * screen with no Back, the offset screen that was a dead end). Making the exit
   * part of the type means a dead-end overlay cannot be constructed. Transient
   * progress layers that genuinely have no exit use <BlockingOverlay> instead —
   * a separate component, so this contract never has to be weakened. */
  onClose: () => void
  children: ReactNode
  placement?: OverlayPlacement
  role?: 'dialog' | 'alertdialog' | 'menu'
  label?: string
  labelledBy?: string
  describedBy?: string
  /** Panel classes. Migrations pass the surface's existing classes verbatim so
   * nothing moves on screen. */
  className?: string
  backdropClassName?: string
  /** For callers that must measure or position the panel themselves. */
  panelRef?: RefObject<HTMLDivElement | null>
}

const ROOT_CLASS: Record<OverlayPlacement, string> = {
  sheet: 'fixed inset-0 z-40 flex flex-col justify-end md:justify-center md:items-center md:p-6',
  fullscreen: 'fixed inset-0 z-50 flex flex-col',
  contained: 'absolute inset-0 z-20 flex items-end sm:items-center justify-center p-4',
  anchored: '',
}

export function Overlay({
  onClose,
  children,
  placement = 'sheet',
  role = 'dialog',
  label,
  labelledBy,
  describedBy,
  className = '',
  backdropClassName = '',
  panelRef,
}: Props) {
  const localRef = useRef<HTMLDivElement>(null)
  const ref = panelRef ?? localRef

  const locksScroll = placement === 'sheet' || placement === 'fullscreen'
  const ownsHistory = locksScroll
  const dismissesOutside = placement === 'anchored'

  useModalDialog(ref, onClose)
  useHistoryDismiss(onClose, ownsHistory)
  useOutsideDismiss(ref, dismissesOutside, onClose)

  useEffect(() => {
    if (!locksScroll) return
    return acquireScrollLock()
  }, [locksScroll])

  return (
    <div
      ref={ref}
      role={role}
      aria-modal="true"
      tabIndex={-1}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={[ROOT_CLASS[placement], backdropClassName, className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/core/ui/Overlay.test.tsx`
Expected: PASS, 9/9.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: 291 files passed, 2 skipped, 0 failed. Nothing consumes `<Overlay>` yet, so a failure here means Task 1's module-level scroll-lock state leaked into another suite — fix that, do not proceed.

- [ ] **Step 6: Commit**

```bash
git add src/core/ui/Overlay.tsx tests/core/ui/Overlay.test.tsx
git commit -m "feat: one door for layered surfaces, with a non-optional exit

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: `<BlockingOverlay>` for transient layers

Registry rows 15 (`ProgressOverlay`) and 20 (`LoadingOverlay`) are transient and have **no exits by design** — they self-dismiss when the work finishes. They must not be forced through `<Overlay>`, because that would mean either giving them a fake `onClose` or making `onClose` optional, and an optional exit destroys the whole point of Task 2.

**Files:**
- Create: `src/core/ui/BlockingOverlay.tsx`
- Test: `tests/core/ui/BlockingOverlay.test.tsx`

**Interfaces:**
- Produces: `<BlockingOverlay>` with props `{ children: ReactNode; label: string; className?: string }`. It has **no** `onClose` and never will.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BlockingOverlay } from '../../../src/core/ui/BlockingOverlay'
import { resetScrollLock } from '../../../src/core/ui/scrollLock'

afterEach(() => {
  resetScrollLock()
  document.body.style.overflow = ''
})

describe('BlockingOverlay', () => {
  it('announces itself as a busy status, not a dialog', () => {
    render(<BlockingOverlay label="Loading models">…</BlockingOverlay>)
    const el = screen.getByRole('status', { name: 'Loading models' })
    expect(el.getAttribute('aria-live')).toBe('polite')
    expect(el.getAttribute('aria-busy')).toBe('true')
  })

  it('is not exposed as a dialog, because it traps no focus and has no exit', () => {
    render(<BlockingOverlay label="Loading models">…</BlockingOverlay>)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('locks background scroll while it is up', () => {
    const { unmount } = render(<BlockingOverlay label="Loading models">…</BlockingOverlay>)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/core/ui/BlockingOverlay.test.tsx`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, type ReactNode } from 'react'
import { acquireScrollLock } from './scrollLock'

interface Props {
  children: ReactNode
  /** Accessible name for the busy state, e.g. "Loading AI tools". */
  label: string
  className?: string
}

/**
 * A transient layer that covers the app while work finishes, and that
 * deliberately has NO exit — the work ending is what dismisses it.
 *
 * Separate from <Overlay> on purpose. <Overlay> requires a non-optional
 * `onClose` so a dead-end surface cannot be built; progress layers are the one
 * legitimate exception, and giving them their own component keeps that
 * exception visible, greppable and lint-allowlistable instead of weakening the
 * contract every other surface depends on.
 *
 * It is a `status`, not a `dialog`: it takes no focus, traps nothing, and has
 * no controls, so announcing it as a dialog would strand a screen-reader user
 * inside something they cannot act on or leave.
 */
export function BlockingOverlay({ children, label, className = '' }: Props) {
  useEffect(() => acquireScrollLock(), [])

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      className={['fixed inset-0 z-[60] flex items-center justify-center bg-black/80', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/core/ui/BlockingOverlay.test.tsx`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/core/ui/BlockingOverlay.tsx tests/core/ui/BlockingOverlay.test.tsx
git commit -m "feat: a named component for the one layer that has no exit

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The registry-driven contract test

This is the spec's Tier-2 test. Its whole value is that it iterates a table: **a surface is covered the moment it is registered**, unlike today's `tests/player/menus.escape.test.tsx`, which hand-writes two cases and therefore covers two of ~22 surfaces.

**Files:**
- Create: `tests/core/ui/overlaySurfaces.tsx`
- Create: `tests/core/ui/Overlay.contract.test.tsx`

**Interfaces:**
- Consumes: `<Overlay>` from Task 2.
- Produces: `OVERLAY_SURFACES: OverlaySurface[]` where `interface OverlaySurface { name: string; placement: 'sheet' | 'fullscreen' | 'contained' | 'anchored'; render: (onClose: () => void) => ReactElement }`. Every migration task appends to this array — that is how the migration is proven, and later tasks depend on this exact shape.

- [ ] **Step 1: Create the registry with the two components built so far**

```tsx
// tests/core/ui/overlaySurfaces.tsx
import type { ReactElement } from 'react'
import { Overlay } from '../../src/core/ui/Overlay'

export interface OverlaySurface {
  /** Registry row name from docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md */
  name: string
  placement: 'sheet' | 'fullscreen' | 'contained' | 'anchored'
  /** Mount the surface with `onClose` wired to its real exit path. */
  render: (onClose: () => void) => ReactElement
}

/**
 * Every layered surface that has been migrated to <Overlay>, and how to mount it.
 *
 * Append a row here as each surface migrates. The contract test iterates this
 * array, so a newly registered surface is covered without editing the test —
 * which is the point: the two hand-written Escape cases in
 * tests/player/menus.escape.test.tsx covered 2 of ~22 surfaces because each had
 * to be written by hand.
 */
export const OVERLAY_SURFACES: OverlaySurface[] = [
  {
    name: 'bare sheet (the primitive itself)',
    placement: 'sheet',
    render: (onClose) => (
      <Overlay onClose={onClose} label="Bare sheet">
        <button type="button">inside</button>
      </Overlay>
    ),
  },
  {
    name: 'bare anchored menu (the primitive itself)',
    placement: 'anchored',
    render: (onClose) => (
      <Overlay onClose={onClose} placement="anchored" role="menu" label="Bare menu">
        <button type="button">item</button>
      </Overlay>
    ),
  },
]
```

- [ ] **Step 2: Write the contract test**

```tsx
// tests/core/ui/Overlay.contract.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { OVERLAY_SURFACES } from './overlaySurfaces'
import { resetScrollLock } from '../../src/core/ui/scrollLock'

afterEach(() => {
  resetScrollLock()
  document.body.style.overflow = ''
})

/**
 * The contract every layered surface owes the user. Table-driven on purpose:
 * registering a surface in overlaySurfaces.tsx is what enrols it here.
 */
describe.each(OVERLAY_SURFACES)('overlay contract: $name', (surface) => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(surface.render(onClose))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('moves focus into itself on open', () => {
    const { container } = render(surface.render(vi.fn()))
    expect(container.contains(document.activeElement)).toBe(true)
  })

  it('restores focus to the opener when it unmounts', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(surface.render(vi.fn()))
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('exposes an accessible name, so it is not an anonymous layer', () => {
    const { container } = render(surface.render(vi.fn()))
    const panel = container.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')
    expect(panel).not.toBeNull()
    const named =
      panel!.getAttribute('aria-label') ?? panel!.getAttribute('aria-labelledby')
    expect(named).toBeTruthy()
  })
})

describe.each(OVERLAY_SURFACES.filter((s) => s.placement === 'sheet' || s.placement === 'fullscreen'))(
  'overlay contract (full-surface only): $name',
  (surface) => {
    it('closes on the system Back gesture instead of leaving the app', () => {
      const onClose = vi.fn()
      render(surface.render(onClose))
      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(onClose).toHaveBeenCalled()
    })

    it('locks background scroll while it is open', () => {
      render(surface.render(vi.fn()))
      expect(document.body.style.overflow).toBe('hidden')
    })
  },
)
```

- [ ] **Step 3: Run it and confirm it passes for the two primitives**

Run: `npx vitest run tests/core/ui/Overlay.contract.test.tsx`
Expected: PASS — 4 cases × 2 surfaces, plus 2 full-surface cases × 1 sheet = 10 tests.

- [ ] **Step 4: Commit**

```bash
git add tests/core/ui/overlaySurfaces.tsx tests/core/ui/Overlay.contract.test.tsx
git commit -m "test: a table-driven overlay contract that grows with the registry

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Migrate batch A — the shared dialogs

`ConfirmDialog` first, because it is one component behind **11 call sites** (registry row 23), so migrating it moves more surfaces than any other single edit.

**Files:**
- Modify: `src/core/ui/ConfirmDialog.tsx`
- Modify: `src/core/ui/Onboarding.tsx`
- Modify: `tests/core/ui/overlaySurfaces.tsx` (append two rows)
- Test: existing `tests/core/ui/*` plus the contract test

**Interfaces:**
- Consumes: `<Overlay>` from Task 2; `OVERLAY_SURFACES` from Task 4.

**Visual-identity rule.** `ConfirmDialog`'s root is currently:

```
absolute inset-0 z-20 flex items-end sm:items-center justify-center p-4 bg-black/50 rounded-inherit
```

`placement="contained"` supplies `absolute inset-0 z-20 flex items-end sm:items-center justify-center p-4`. Pass the remainder — `bg-black/50 rounded-inherit` — as `backdropClassName` so the rendered class string is unchanged.

- [ ] **Step 1: Migrate `ConfirmDialog` to `<Overlay>`**

Replace its `useRef` + `useModalDialog` + root `<div>` with:

```tsx
import { Overlay } from './Overlay'

// …inside the component, replacing the outer <div> and the hook call:
  return (
    <Overlay
      onClose={onCancel}
      placement="contained"
      role="alertdialog"
      labelledBy="confirm-dialog-title"
      describedBy="confirm-dialog-message"
      backdropClassName="bg-black/50 rounded-inherit"
    >
      {/* the existing inner panel <div className="w-full max-w-sm …"> unchanged */}
    </Overlay>
  )
```

Delete the now-unused `useRef` and `useModalDialog` imports. **Keep the comment** explaining that Escape maps to cancel because "don't do the destructive thing" is the safe option — move it above the `onClose={onCancel}` prop.

- [ ] **Step 2: Run the tests that already cover ConfirmDialog's callers**

Run: `npx vitest run tests/sources/AddSongSheet.dirtyClose.test.tsx tests/sources/LibraryScreen.test.tsx tests/player/menus.escape.test.tsx`
Expected: PASS. These exercise real call sites; a regression here means the migration changed behaviour.

- [ ] **Step 3: Migrate `Onboarding` to `<Overlay>`**

Its root is `fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4`. Use `placement="sheet"` and pass `backdropClassName="z-[70] bg-black/70 items-center justify-center p-4"`, then verify the rendered class list still contains every class it had before — `sheet`'s default `z-40` must be overridden to `z-[70]`, so put `z-[70]` in `backdropClassName` and confirm Tailwind's later-class-wins ordering holds in the emitted string. If it does not, add an explicit `z` prop rather than fighting class order.

- [ ] **Step 4: Register both in the contract table**

Append to `OVERLAY_SURFACES` in `tests/core/ui/overlaySurfaces.tsx`:

```tsx
  {
    name: 'row 23 — generic confirm dialog',
    placement: 'contained',
    render: (onClose) => (
      <ConfirmDialog
        title="Discard changes?"
        message="Your edits will be lost."
        onConfirm={() => {}}
        onCancel={onClose}
      />
    ),
  },
```

Add the `ConfirmDialog` import at the top of the file.

**`Onboarding` is deliberately NOT registered here, and that is not an oversight.**
`export function Onboarding()` (`src/core/ui/Onboarding.tsx:30`) takes **no props at all** —
it owns its own `seen` state, derives `dismiss` internally (`:35`), and passes it to
`useModalDialog` with an `enabled` flag (`:42`). There is no `onClose` a test can inject, so
it cannot satisfy the `render: (onClose) => …` contract without an API change — and an API
change is out of scope for a migration that must be behaviourally identical.

Still migrate its root element to `<Overlay>` in Step 3: it gains scroll lock and Back either
way. Record the absence beside the other rows so it reads as a decision:

```tsx
// Row 4 (onboarding) is migrated to <Overlay> but not registered here: Onboarding takes
// no props and owns its own dismiss, so there is no onClose to inject. Giving it one is a
// Phase 3 concern, when the screen model owns first-run state.

- [ ] **Step 5: Run the contract test and the full suite**

Run: `npx vitest run tests/core/ui/Overlay.contract.test.tsx`
Expected: PASS for all four registered surfaces.

Run: `npx vitest run`
Expected: 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/core/ui/ConfirmDialog.tsx src/core/ui/Onboarding.tsx tests/core/ui/overlaySurfaces.tsx
git commit -m "refactor: route the shared dialogs through Overlay

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Migrate batch B — the app-level sheets

**Files:**
- Modify: `src/sources/AddSongSheet.tsx` (row 5), `src/settings/SettingsSheet.tsx` (row 10)
- Modify: `tests/core/ui/overlaySurfaces.tsx`

These two are the *only* surfaces that already call `useHistoryDismiss`, so they are the reference for what Back-closing should feel like — and after this task `<Overlay>` gives it to everything else for free.

- [ ] **Step 1: Migrate `SettingsSheet`**

Root today: `fixed inset-0 z-40 flex flex-col justify-end md:justify-center md:items-center md:p-6`. That is exactly `placement="sheet"`'s default class string, so pass no `backdropClassName`. Remove its now-redundant `useModalDialog` and `useHistoryDismiss` calls — `<Overlay>` owns both. Keep its `useConfirmedClose` wiring and pass the guarded close as `onClose`, so Back and Escape inherit the confirmation exactly as the ✕ does.

- [ ] **Step 2: Run its tests**

Run: `npx vitest run tests/settings/SettingsSheet.test.tsx`
Expected: PASS.

- [ ] **Step 3: Migrate `AddSongSheet`**

Same root class string, same treatment. It has a nested `ConfirmDialog` (already migrated in Task 5) — after this task that is an `<Overlay placement="contained">` inside an `<Overlay placement="sheet">`, which is the stacking case `useModalDialog`'s DOM-containment ownership and Task 1's reference counting exist for. Verify both: Escape must dismiss only the confirm, and closing the confirm must leave the page still scroll-locked under the sheet.

- [ ] **Step 4: Write the stacking regression test**

```tsx
// tests/core/ui/Overlay.stacking.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { Overlay } from '../../src/core/ui/Overlay'
import { ConfirmDialog } from '../../src/core/ui/ConfirmDialog'
import { resetScrollLock } from '../../src/core/ui/scrollLock'

afterEach(() => {
  resetScrollLock()
  document.body.style.overflow = ''
})

describe('a confirm stacked over a sheet', () => {
  it('gives Escape to the confirm, not the sheet underneath', () => {
    const closeSheet = vi.fn()
    const cancelConfirm = vi.fn()
    render(
      <Overlay onClose={closeSheet} label="Sheet">
        <button type="button">sheet control</button>
        <ConfirmDialog title="Discard?" message="Lost." onConfirm={() => {}} onCancel={cancelConfirm} />
      </Overlay>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cancelConfirm).toHaveBeenCalledTimes(1)
    expect(closeSheet).not.toHaveBeenCalled()
  })

  it('keeps the page locked when the inner confirm unmounts', () => {
    const { rerender } = render(
      <Overlay onClose={vi.fn()} label="Sheet">
        <button type="button">sheet control</button>
        <ConfirmDialog title="Discard?" message="Lost." onConfirm={() => {}} onCancel={vi.fn()} />
      </Overlay>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    rerender(
      <Overlay onClose={vi.fn()} label="Sheet">
        <button type="button">sheet control</button>
      </Overlay>,
    )
    expect(document.body.style.overflow).toBe('hidden')
  })
})
```

- [ ] **Step 5: Run it, register both sheets, run the full suite**

Run: `npx vitest run tests/core/ui/Overlay.stacking.test.tsx`
Expected: PASS, 2/2.

Append rows for `row 5 — add-song sheet` and `row 10 — settings sheet` to `OVERLAY_SURFACES`, then:

Run: `npx vitest run`
Expected: 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/sources/AddSongSheet.tsx src/settings/SettingsSheet.tsx tests/core/ui/overlaySurfaces.tsx tests/core/ui/Overlay.stacking.test.tsx
git commit -m "refactor: route the app-level sheets through Overlay

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Migrate batch C — the player's full-surface overlays

**Files:**
- Modify: `src/player/TapSyncEditor.tsx` (row 17), `src/player/OffsetAlignScreen.tsx` (row 18), `src/ai-pipeline/AutoAlignFlow.tsx` (row 19), `src/player/PlayerView.tsx:1999` (row 16, replace-lyrics dialog)
- Modify: `tests/core/ui/overlaySurfaces.tsx`

**These four carry the scars this whole effort exists to prevent.** `TapSyncEditor` was the August critical — no Back, no Escape, and rendering it unmounted the YouTube iframe so every tap stamped 0:00. `OffsetAlignScreen` was the September dead end. Both were fixed by hand; this task makes the fixes structural. **Do not regress them:** `TapSyncEditor` must stay mounted as an overlay *inside* the main tree, not an early `return`, so `<YouTubePlayer>` keeps running underneath.

- [ ] **Step 1: Migrate each, one commit per file**

For each: replace the hand-rolled root `<div className="fixed inset-0 …">` plus its `useModalDialog` call with `<Overlay placement="fullscreen" …>`, passing the surface's remaining classes as `backdropClassName` so the rendering is byte-identical. Keep every existing exit control — `<Overlay>` adds Escape and Back; it does not replace a visible Cancel.

- [ ] **Step 2: Run the tests guarding the old defects, after each file**

Run: `npx vitest run tests/player/TapSyncEditor.exit.test.tsx tests/player/TapSyncEditor.test.tsx tests/player/PlayerView.tap-sync-overlay.test.tsx tests/player/PlayerView.offsetAlign.test.tsx`
Expected: PASS. `PlayerView.tap-sync-overlay.test.tsx` specifically asserts the YouTube player stays mounted — if that fails, the migration reintroduced the August critical.

- [ ] **Step 3: Register all four surfaces**

Append rows named `row 17 — tap-sync editor`, `row 18 — offset-align screen`, `row 19 — auto-align flow`, `row 16 — replace-lyrics dialog`. `AutoAlignFlow` is lazy-loaded and heavy; register it with the same `vi.mock` treatment its existing tests use, and if that proves impractical, register it with a `placement` row and a comment saying which existing test covers it instead — **do not silently omit it**.

- [ ] **Step 4: Full suite**

Run: `npx vitest run`
Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "refactor: route the player's full-surface overlays through Overlay

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Migrate batch D — the anchored menus and popovers

**Files:**
- Modify: `src/player/DisplayMenu.tsx` (row 21), `src/lyrics/EditMode.tsx` More menu (row 22), `src/lyrics/WordLookupPopover.tsx` (row 24), `src/lyrics/TimestampPopover.tsx` (row 25), `src/lyrics/TranslationRepairPopover.tsx` (row 26), `src/player/PlayerControls.tsx:736` and `:1237` (rows 27, 28)
- Modify: `tests/core/ui/overlaySurfaces.tsx`

**Rows 27 and 28 are the ones with a real gap:** both are `role="dialog"` menus dismissed by `pointerdown` only, with **no Escape at all**. Migrating them to `<Overlay placement="anchored">` is what gives them one.

`placement="anchored"` adds no positioning classes — each of these positions itself and must keep doing so exactly as it does now.

- [ ] **Step 1: Migrate the two `PlayerControls` menus first**

They are the ones gaining behaviour, so a bug is most visible here. After migrating, Escape must close each, and the existing pointerdown dismissal must still work.

- [ ] **Step 2: Migrate `DisplayMenu` and the Edit-mode More menu**

These two are the surfaces `tests/player/menus.escape.test.tsx` covers. **Do not touch that test file in this task** — it is the independent check that the migration preserved behaviour. It must still pass unchanged.

Run: `npx vitest run tests/player/menus.escape.test.tsx`
Expected: PASS, unmodified.

- [ ] **Step 3: Migrate the three popovers**

`WordLookupPopover`, `TimestampPopover`, `TranslationRepairPopover` all already call `useModalDialog`; they become `<Overlay placement="anchored" role="dialog">` and keep their own positioning and their own visible exits.

Run: `npx vitest run tests/lyrics/WordLookupPopover.test.tsx tests/lyrics/TimestampPopover.test.tsx tests/lyrics/TranslationRepairPopover.test.tsx`
Expected: PASS.

- [ ] **Step 4: Register all seven, then run everything**

Run: `npx vitest run`
Expected: 0 failures. The contract test should now cover 13+ surfaces.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "refactor: route anchored menus and popovers through Overlay

Gives rows 27 and 28 an Escape key they never had.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Migrate the transient layers and the remaining surfaces

**Files:**
- Modify: `src/core/ui/ProgressOverlay.tsx` (row 15), `src/core/ui/LoadingOverlay.tsx` (row 20) → `<BlockingOverlay>`
- Modify: `src/lyrics/SecondLanguagePanel.tsx` (rows 13, 14), `src/lyrics/AlignmentEditor.tsx` (row 12), `src/player/PlayerControls.tsx:1412` (row 29)
- Modify: `tests/core/ui/overlaySurfaces.tsx`

**Row 29 is phone-only.** `PlayerControls.tsx:1672` opens a `mode === 'play' && (isDesktop ? … : …)` ternary; the "Saved" chip (`:1759`) and `MobileControlsSheet` (`:1773`) render only in the non-desktop arm from `:1718`. Desktop uses `SavedLoopsPanelSection` (`:1705`), a different surface with no dialog role. Migrate the phone sheet only, and register it noting the device gate. Do not touch the desktop section.

- [ ] **Step 1: Convert the two transient overlays**

`ProgressOverlay` and `LoadingOverlay` become `<BlockingOverlay>`. They must **not** be added to `OVERLAY_SURFACES` — they have no exit by design, and the contract test asserts every registered surface closes on Escape. Add a comment in `overlaySurfaces.tsx` recording *why* rows 15 and 20 are absent, so their absence reads as a decision rather than an oversight.

Run: `npx vitest run tests/core/LoadingOverlay.test.tsx tests/core/ProcessProgress.test.tsx`
Expected: PASS.

- [ ] **Step 2: Migrate the second-language surfaces and row 29**

Same visual-identity rule: pass existing classes through so nothing moves.

- [ ] **Step 3: Register the migrated ones and run everything**

Run: `npx vitest run`
Expected: 0 failures.

- [ ] **Step 4: Commit**

```bash
git add -A src tests
git commit -m "refactor: transient layers to BlockingOverlay, remaining surfaces to Overlay

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: The Tier-4 lint ratchet, and only then retire the old Escape tests

**Files:**
- Modify: `eslint.config.js`
- Modify: `tests/player/menus.escape.test.tsx` (delete — **only if Step 2 passes**)

**Keyed on the real boundary.** Phase 1's Critical was that `fixed inset-0` is the wrong filter: it cannot see `ConfirmDialog`'s `absolute inset-0` or `DisplayMenu`'s portalled `fixed z-50`. The rule below keys on `useModalDialog` instead — the hook that actually marks a modal surface.

- [ ] **Step 1: Add the rule**

Use `patterns`, **not** `paths`. `paths` matches an import specifier literally, and this hook
is imported as `'./useModalDialog'` from inside `src/core/ui/` but as
`'../core/ui/useModalDialog'` from everywhere else — a literal rule would silently miss every
caller outside that directory. That is precisely the class of half-blind filter that caused
Phase 1's Critical finding.

`eslint.config.js` is a flat config built with `defineConfig([...])`, so append a new config
object after the existing `files: ['**/*.{ts,tsx}']` block:

```js
{
  files: ['src/**/*.tsx'],
  ignores: ['src/core/ui/Overlay.tsx'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/useModalDialog'],
        message:
          'Do not call useModalDialog directly — render the surface through <Overlay> ' +
          '(src/core/ui/Overlay.tsx), which owns focus, Escape, Back and scroll lock and ' +
          'requires a non-optional onClose. Transient layers with no exit use <BlockingOverlay>.',
      }],
    }],
  },
},
```

`src/core/ui/Overlay.tsx` is the one legitimate caller, so it is the only `ignores` entry.
`src/core/ui/useModalDialog.ts` needs no exemption: the rule targets `*.tsx`, and the hook
defines rather than imports itself.

**Prove the rule bites before trusting it** — a pattern that matches nothing passes silently,
which would leave you with a ratchet that only looks like one:

```bash
npx eslint src 2>&1 | tail -5          # after Tasks 5-9: expected clean
git stash && npx eslint src 2>&1 | grep -c 'useModalDialog'; git stash pop
```

The stashed run is against the pre-migration tree and **must report a non-zero count**. Zero
means the pattern is not matching.

Run: `npx eslint src` — expected: clean, because Tasks 5–9 removed every other direct call.

**If it is not clean, that is the ratchet working:** the remaining files are unmigrated surfaces. Migrate them or record them in the plan's follow-ups; do not weaken the rule to make it pass.

- [ ] **Step 2: Prove the contract test covers what the old tests covered**

This is a hard gate from the spec (success criterion 3). `tests/player/menus.escape.test.tsx` covers `DisplayMenu` and the Edit-mode More menu.

Run: `npx vitest run tests/core/ui/Overlay.contract.test.tsx -t "DisplayMenu"`
Run: `npx vitest run tests/core/ui/Overlay.contract.test.tsx -t "More menu"`

Both must select and pass real tests. If either selects **zero** tests, those surfaces are not registered — **stop, register them, and do not delete anything.**

- [ ] **Step 3: Retire the superseded tests**

Only once Step 2 passed for both:

```bash
git rm tests/player/menus.escape.test.tsx
```

- [ ] **Step 4: Full suite and lint**

Run: `npx vitest run` — expected: 0 failures.
Run: `npx eslint .` — expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: lint every modal surface through Overlay, and retire the hand-written Escape tests

The table-driven contract test now covers DisplayMenu and the Edit-mode More
menu, verified by name before deleting the file that covered them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Phase 2 requires: a shared `<Overlay>` with required `onClose` (Task 2), focus/Escape/Back/scroll lock (Tasks 1–2), migration of the surfaces one at a time (Tasks 5–9, batched by shape so each ships alone), the Tier-2 registry-driven table test growing as surfaces land (Task 4, appended in every migration task), and the Tier-4 lint ratchet (Task 10). Success criterion 3's hard gate — do not retire the two Escape tests until their surfaces are demonstrably covered — is Task 10 Step 2, and it fails closed. Covered.

**Placeholder scan.** Every task carries runnable code or an exact edit with the class strings named. Tasks 7–9 describe per-file edits rather than quoting each file's full JSX, because the visual-identity rule ("pass the existing classes through") is the actual requirement and quoting ~15 unchanged panels would invite copy errors; each names its files, its verification command, and the expected result.

**Type consistency.** `<Overlay>`'s prop shape is declared once in Task 2's Interfaces block and used unchanged in Tasks 5–9. `OverlaySurface` is declared in Task 4 and appended to identically thereafter. `acquireScrollLock` returns `() => void` in Task 1 and is consumed as a `useEffect` teardown in Tasks 2 and 3.

**Known risk, stated rather than hidden.** Task 5 Step 3 (`Onboarding`, `z-[70]`) and every migration depend on Tailwind class-order precedence when a placement default (`z-40`) is overridden by `backdropClassName`. Tailwind does not guarantee order-based wins for same-property utilities. Each migration must verify the *rendered* class string, and Task 2's API includes `backdropClassName` precisely so a conflict is visible rather than silent. If a conflict does appear, add an explicit prop rather than reordering strings.
