# Pre-Launch Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four pre-launch gaps identified in a robustness review: no offline indicator, no "update available" prompt for the PWA service worker, no undo/redo for lyric line edits, and no first-run onboarding.

**Architecture:** Each gap is an independent, self-contained UI addition with no shared state between them. Offline detection and the SW update banner are new small components mounted once near the app root (`App.tsx`). Undo/redo is a local history stack inside `EditMode.tsx`, the single place lyric edits already flow through (`onChangeLines`). Onboarding is a one-time overlay gated by `localStorage`, mounted from `App.tsx`.

**Tech Stack:** React, TypeScript, Vitest + Testing Library (existing conventions), `vite-plugin-pwa/react` (`virtual:pwa-register/react`), Tailwind utility classes matching existing `core/ui` components.

**Explicitly out of scope:** Swapping the LemonSqueezy placeholder checkout URL / public key in `src/payment/UpgradeModal.tsx:8` and `src/payment/license.ts:4` — those need real account credentials from the user and are not addressed here.

---

## Task 1: Offline detection banner

**Files:**
- Create: `src/core/ui/OfflineBanner.tsx`
- Modify: `src/App.tsx`
- Test: `tests/core/ui/OfflineBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/core/ui/OfflineBanner.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { OfflineBanner } from '../../../src/core/ui/OfflineBanner'

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value })
}

describe('OfflineBanner', () => {
  afterEach(() => {
    cleanup()
    setOnline(true)
  })

  it('renders nothing while online', () => {
    setOnline(true)
    render(<OfflineBanner />)
    expect(screen.queryByText(/you.re offline/i)).toBeNull()
  })

  it('shows a message when the offline event fires', () => {
    setOnline(true)
    render(<OfflineBanner />)
    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText(/you.re offline/i)).toBeTruthy()
  })

  it('hides again when the online event fires', () => {
    setOnline(false)
    render(<OfflineBanner />)
    expect(screen.getByText(/you.re offline/i)).toBeTruthy()
    act(() => {
      setOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByText(/you.re offline/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/ui/OfflineBanner.test.tsx`
Expected: FAIL — `Failed to resolve import "../../../src/core/ui/OfflineBanner"`

- [ ] **Step 3: Write the component**

```tsx
// src/core/ui/OfflineBanner.tsx
import { useEffect, useState } from 'react'

export function OfflineBanner() {
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  )

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[60] bg-yellow-900 text-white text-xs text-center py-1.5 px-3"
    >
      You're offline. Playback and editing still work — fetching new lyrics or models needs a connection.
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/ui/OfflineBanner.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Mount it in App.tsx**

In `src/App.tsx`, add the import and render `<OfflineBanner />` once near the top of the returned fragment:

```tsx
import { OfflineBanner } from './core/ui/OfflineBanner'
```

```tsx
  return (
    <>
      <OfflineBanner />
      {view === 'song' && songId ? (
```

- [ ] **Step 6: Commit**

```bash
git add src/core/ui/OfflineBanner.tsx src/App.tsx tests/core/ui/OfflineBanner.test.tsx
git commit -m "feat: show banner when the app goes offline"
```

---

## Task 2: Service worker "update available" banner

**Files:**
- Create: `src/core/ui/UpdateBanner.tsx`
- Modify: `src/App.tsx`
- Modify: `src/vite-env.d.ts`
- Test: `tests/core/ui/UpdateBanner.test.tsx`

`vite-plugin-pwa` (already configured in `vite.config.ts:209` with `registerType: 'autoUpdate'`) ships a React hook at the virtual module `virtual:pwa-register/react`. It exposes `needRefresh: [boolean, setter]` and an `updateServiceWorker(reloadPage?: boolean)` function. Today nothing calls this hook, so updates apply silently on next load. We add a banner that calls `useRegisterSW` and prompts the user instead of reloading for them.

- [ ] **Step 1: Add the virtual module's type reference**

`src/vite-env.d.ts` currently only has the vite/client reference. Add a second line:

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
```

- [ ] **Step 2: Write the failing test**

The virtual module only exists in a built/PWA context, so the test mocks it directly — this matches how the component will consume it.

```tsx
// tests/core/ui/UpdateBanner.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const updateServiceWorker = vi.fn()
let needRefresh = false

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [needRefresh, vi.fn()],
    updateServiceWorker,
  }),
}))

import { UpdateBanner } from '../../../src/core/ui/UpdateBanner'

describe('UpdateBanner', () => {
  it('renders nothing when no update is pending', () => {
    needRefresh = false
    render(<UpdateBanner />)
    expect(screen.queryByText(/new version available/i)).toBeNull()
  })

  it('shows a prompt and reloads via updateServiceWorker on click', () => {
    needRefresh = true
    render(<UpdateBanner />)
    const button = screen.getByRole('button', { name: /update/i })
    fireEvent.click(button)
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/core/ui/UpdateBanner.test.tsx`
Expected: FAIL — cannot resolve `../../../src/core/ui/UpdateBanner`

- [ ] **Step 4: Write the component**

```tsx
// src/core/ui/UpdateBanner.tsx
import { useRegisterSW } from 'virtual:pwa-register/react'

export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[60] bg-cinnabar-accent text-white text-xs flex items-center justify-center gap-3 py-1.5 px-3"
    >
      <span>New version available.</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="underline font-medium"
      >
        Update
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/core/ui/UpdateBanner.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Mount it in App.tsx**

`OfflineBanner` and `UpdateBanner` can both be fixed-top banners; if both fire at once they'll stack, which is acceptable (rare and self-resolving). Add below the `OfflineBanner` import/render from Task 1:

```tsx
import { UpdateBanner } from './core/ui/UpdateBanner'
```

```tsx
  return (
    <>
      <OfflineBanner />
      <UpdateBanner />
      {view === 'song' && songId ? (
```

- [ ] **Step 7: Verify the production build still resolves the virtual module**

Run: `npm run build`
Expected: build succeeds (vite-plugin-pwa generates `virtual:pwa-register/react` at build time; this only fails if the plugin config is broken).

- [ ] **Step 8: Commit**

```bash
git add src/core/ui/UpdateBanner.tsx src/App.tsx src/vite-env.d.ts tests/core/ui/UpdateBanner.test.tsx
git commit -m "feat: prompt before applying service worker updates"
```

---

## Task 3: Undo/redo for lyric line edits

**Files:**
- Modify: `src/lyrics/EditMode.tsx`
- Test: `tests/lyrics/EditMode.test.tsx`

All lyric mutations in `EditMode` already funnel through calls that end in `onChangeLines(nextLines)` — text commits (`onCommitText`), add line (`onAdd`), delete (`onConfirmDelete` → `confirmDelete`), timestamp commits (`onCommitTime`), and the second-language panel's `onApply`. We add a local undo/redo stack and route every one of those through a single `applyChange` wrapper instead of calling `onChangeLines` directly.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lyrics/EditMode.test.tsx` (inside the existing `describe('EditMode', ...)` block, after the last test):

```tsx
  it('undo restores the previous lines after a text edit', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    fireEvent.blur(input)
    expect(onChangeLines).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    const undone = onChangeLines.mock.calls[1][0] as TimedLine[]
    expect(undone[1].original).toBe('b')
  })

  it('redo re-applies the change after an undo', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    fireEvent.blur(input)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    const redone = onChangeLines.mock.calls[2][0] as TimedLine[]
    expect(redone[1].original).toBe('bb')
  })

  it('undo/redo buttons are disabled when there is nothing to undo/redo', () => {
    renderEditMode()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })

  it('a new edit clears the redo stack', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    fireEvent.blur(input)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Redo' })).not.toBeDisabled()

    fireEvent.click(screen.getByText('a'))
    const input2 = screen.getByLabelText('Original text')
    fireEvent.change(input2, { target: { value: 'aa' } })
    fireEvent.blur(input2)

    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lyrics/EditMode.test.tsx`
Expected: FAIL — no element with role `button` and name `Undo`/`Redo`

- [ ] **Step 3: Add the history stack and wire every mutation through it**

In `src/lyrics/EditMode.tsx`, inside `EditMode` (after the existing `useRef`/`useState` declarations around line 191-193), add:

```tsx
  const undoStack = useRef<TimedLine[][]>([])
  const redoStack = useRef<TimedLine[][]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const applyChange = (next: TimedLine[]) => {
    undoStack.current.push(lines)
    if (undoStack.current.length > 50) undoStack.current.shift()
    redoStack.current = []
    setCanUndo(true)
    setCanRedo(false)
    onChangeLines(next)
  }

  const undo = () => {
    const prev = undoStack.current.pop()
    if (!prev) return
    redoStack.current.push(lines)
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
    onChangeLines(prev)
  }

  const redo = () => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(lines)
    setCanUndo(true)
    setCanRedo(redoStack.current.length > 0)
    onChangeLines(next)
  }
```

Then replace every direct `onChangeLines(...)` call inside the component (not the prop itself) with `applyChange(...)`:

- Line ~245: `onChangeLines(deleteLine(lines, i))` → `applyChange(deleteLine(lines, i))`
- Line ~323: `onCommitText={(patch) => onChangeLines(setText(lines, i, patch))}` → `applyChange(setText(lines, i, patch))`
- Line ~324: `onAdd={() => onChangeLines(addLine(lines, i))}` → `applyChange(addLine(lines, i))`
- Line ~334: `onCommitTime={(t) => onChangeLines(stampStart(lines, i, t))}` → `applyChange(stampStart(lines, i, t))`
- Line ~359: `onApply={(next) => onChangeLines(next)}` → `onApply={(next) => applyChange(next)}`

Note: `lines` is read fresh from the closure on each call (it's a prop, re-evaluated every render), so `applyChange` always pushes the lines that were on screen immediately before the new change — correct for both single edits and edits made shortly after an undo.

- [ ] **Step 4: Add Undo/Redo buttons to the toolbar**

In the toolbar `div` (around line 270, inside `<div className="flex items-center gap-2 flex-wrap justify-end">`), add two buttons before the `Replace lyrics` button:

```tsx
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            aria-label="Undo"
            className={`${toolbarActionBtn} disabled:opacity-30`}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            aria-label="Redo"
            className={`${toolbarActionBtn} disabled:opacity-30`}
          >
            Redo
          </button>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/EditMode.test.tsx`
Expected: PASS (all tests, including the 4 new ones)

- [ ] **Step 6: Run the full test suite to catch regressions in callers**

Run: `npx vitest run`
Expected: PASS — `handleEditLines` in `PlayerView.tsx` is unaffected since `applyChange` still calls `onChangeLines` with the same shape of argument it always received.

- [ ] **Step 7: Commit**

```bash
git add src/lyrics/EditMode.tsx tests/lyrics/EditMode.test.tsx
git commit -m "feat: add undo/redo for lyric line edits"
```

---

## Task 4: First-run onboarding overlay

**Files:**
- Create: `src/core/ui/Onboarding.tsx`
- Modify: `src/App.tsx`
- Test: `tests/core/ui/Onboarding.test.tsx`

A 3-step overlay shown once, gated by a `localStorage` flag. Mounted from `App.tsx` only when on the library screen (it should never interrupt an in-progress song).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/core/ui/Onboarding.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Onboarding, ONBOARDING_STORAGE_KEY } from '../../../src/core/ui/Onboarding'

describe('Onboarding', () => {
  beforeEach(() => {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY)
  })

  it('shows the first step when never seen before', () => {
    render(<Onboarding />)
    expect(screen.getByText(/add a song/i)).toBeTruthy()
  })

  it('renders nothing once already seen', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
    render(<Onboarding />)
    expect(screen.queryByText(/add a song/i)).toBeNull()
  })

  it('advances through all three steps then dismisses and persists', () => {
    render(<Onboarding />)
    expect(screen.getByText(/add a song/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/sync lyrics/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/practice/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(screen.queryByText(/practice/i)).toBeNull()
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('1')
  })

  it('skip dismisses immediately and persists', () => {
    render(<Onboarding />)
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(screen.queryByText(/add a song/i)).toBeNull()
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/ui/Onboarding.test.tsx`
Expected: FAIL — cannot resolve `../../../src/core/ui/Onboarding`

- [ ] **Step 3: Write the component**

```tsx
// src/core/ui/Onboarding.tsx
import { useState } from 'react'

export const ONBOARDING_STORAGE_KEY = 'utasync_onboarding_seen'

const STEPS = [
  { title: 'Add a song', body: 'Paste a YouTube link or upload an audio file to get started.' },
  { title: 'Sync lyrics', body: 'Fetch lyrics automatically or paste your own, then align them to the audio.' },
  { title: 'Practice', body: 'Loop sections, slow down playback, and follow along word by word.' },
]

export function Onboarding() {
  const [seen, setSeen] = useState(() => localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1')
  const [step, setStep] = useState(0)

  const dismiss = () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
    setSeen(true)
  }

  if (seen) return null

  const isLast = step === STEPS.length - 1
  const current = STEPS[step]

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-cinnabar-900 rounded-2xl p-6 max-w-sm w-full space-y-4">
        <p className="text-[10px] uppercase tracking-wide text-white/35">
          {step + 1} of {STEPS.length}
        </p>
        <h2 className="text-white font-semibold text-lg">{current.title}</h2>
        <p className="text-white/70 text-sm">{current.body}</p>
        <div className="flex items-center justify-between gap-3 pt-2">
          <button onClick={dismiss} className="text-white/40 text-sm">
            Skip
          </button>
          <button
            onClick={() => (isLast ? dismiss() : setStep((s) => s + 1))}
            className="py-2 px-4 bg-cinnabar-accent text-white rounded-xl font-medium text-sm"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/ui/Onboarding.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Mount it in App.tsx, library screen only**

In `src/App.tsx`, import and render it only inside the `LibraryScreen` branch so it never appears over a song in progress:

```tsx
import { Onboarding } from './core/ui/Onboarding'
```

```tsx
      ) : (
        <>
          <LibraryScreen
            onOpen={openSong}
            onAdd={() => setAddOpen(true)}
            onSettings={() => setSettingsOpen(true)}
          />
          <Onboarding />
        </>
      )}
```

- [ ] **Step 6: Commit**

```bash
git add src/core/ui/Onboarding.tsx src/App.tsx tests/core/ui/Onboarding.test.tsx
git commit -m "feat: add first-run onboarding overlay"
```

---

## Final check

- [ ] **Run the full suite once more after all four tasks**

Run: `npx vitest run`
Expected: PASS, no regressions in `tests/App` (if any exist) or `tests/lyrics/EditMode.test.tsx`

- [ ] **Run the production build**

Run: `npm run build`
Expected: succeeds; confirms the `virtual:pwa-register/react` import resolves outside of test mocks too.
