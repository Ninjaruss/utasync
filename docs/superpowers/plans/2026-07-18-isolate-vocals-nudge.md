# "Isolate Vocals" Nudge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an Auto-align ran without vocal separation and produced a weak result, EditMode gently suggests enabling "Isolate vocals for timing" with a one-click re-align. Purely additive UI + one persisted boolean; no change to alignment output.

**Architecture:** Persist `vocalSeparationUsed` on `LyricsData` at align time; EditMode's existing accurate-realign hint gains a nudge (gated on not-used + device-supported); PlayerView wires a callback that enables the setting and re-aligns (a fresh `AutoAlignFlow` mount reads the just-enabled setting — no new plumbing).

**Tech Stack:** TypeScript, React, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-18-isolate-vocals-nudge-design.md`

**Verified integration facts:**
- `LyricsData` (`src/core/types/index.ts:100`) is a bag of optional alignment-metadata fields.
- `applyRefinedAlignment(lyrics, refined)` (`src/lyrics/phraseAlignment.ts`) returns `{ ...lyrics, <specific overrides> }` — it **spreads the input `lyrics`**, and `vocalSeparationUsed` is not in the override list, so it's preserved.
- AutoAlignFlow's one save site (`src/ai-pipeline/AutoAlignFlow.tsx:433`) builds the result via `applyRefinedAlignment({ ...song.lyrics, alignmentMode: 'auto', transcriptWords, gapRecoveryVersion: GAP_RECOVERY_VERSION }, ...)` then `onComplete(updated)` (line ~454). `willSeparate` (line 182; true only if separation actually ran — a separation failure returns early before this) is in scope here.
- EditMode computes `alignmentHint: 'lyrics-mismatch' | 'block-timing' | 'weak-labels' | 'off-timing' | null` (`src/lyrics/EditMode.tsx:485`) and renders each; `block-timing` and `weak-labels` already show a `Re-align accurately` button (`onAutoAlignAccurate`). EditMode Props are declared ~line 30; the component destructures at ~line 303. `toolbarActionBtn` is the button class used by the existing hint buttons.
- PlayerView: `AutoAlignFlow` is `lazy`-mounted only when `alignMode === 'auto'` (line 1452), initializing vocal separation from `useSettingsStore(s => s.vocalSeparationEnabled)` (AutoAlignFlow:104/110). `beginAlignment(mode, accurateReadings=false)` (PlayerView:695) sets `alignMode`. `realignReason` (PlayerView:896) is passed as `accurateRealignReason` to EditMode (1325). PlayerView does NOT yet read `setVocalSeparationEnabled` or `canUseVocalSeparation`.

## File structure
- Modify: `src/core/types/index.ts` — add `LyricsData.vocalSeparationUsed?`.
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx` — set it at the save site. Test: `tests/lyrics/phraseAlignment` (applyRefinedAlignment preserves it).
- Modify: `src/lyrics/EditMode.tsx` — nudge props + render. Test: `tests/lyrics/EditMode.vocalNudge.test.tsx`.
- Modify: `src/player/PlayerView.tsx` — wire the props + callback.

---

## Task 1: persist `vocalSeparationUsed`

**Files:**
- Modify: `src/core/types/index.ts`
- Modify: `src/ai-pipeline/AutoAlignFlow.tsx`
- Test: `tests/lyrics/phraseAlignment.vocalSeparationUsed.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/lyrics/phraseAlignment.vocalSeparationUsed.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyRefinedAlignment } from '../../src/lyrics/phraseAlignment'
import type { LyricsData } from '../../src/core/types'
import type { RefinedAlignment } from '../../src/lyrics/phraseAlignment'

const baseLyrics = (patch: Partial<LyricsData>): LyricsData => ({
  lines: [], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'auto', ...patch,
})
const refined = (): RefinedAlignment => ({
  lines: [], phrases: [], phraseLayout: 'sheet', anchorSources: [], lineAlignmentQuality: [], confidence: 1,
} as RefinedAlignment)

describe('applyRefinedAlignment preserves vocalSeparationUsed', () => {
  it('carries a true flag through from the input lyrics', () => {
    expect(applyRefinedAlignment(baseLyrics({ vocalSeparationUsed: true }), refined()).vocalSeparationUsed).toBe(true)
  })
  it('carries a false flag through', () => {
    expect(applyRefinedAlignment(baseLyrics({ vocalSeparationUsed: false }), refined()).vocalSeparationUsed).toBe(false)
  })
  it('leaves it undefined when the input has none (legacy songs)', () => {
    expect(applyRefinedAlignment(baseLyrics({}), refined()).vocalSeparationUsed).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lyrics/phraseAlignment.vocalSeparationUsed.test.ts`
Expected: FAIL to typecheck/compile — `vocalSeparationUsed` isn't on `LyricsData` yet.

- [ ] **Step 3: Add the field.** In `src/core/types/index.ts`, inside `LyricsData` (after `alignmentConfidence?`):

```ts
  /** Whether Demucs vocal separation was used for the last auto-align. Drives the
   * EditMode "Isolate vocals" nudge (shown only when it wasn't used). Undefined on
   * songs aligned before this field existed (treated as not-used). */
  vocalSeparationUsed?: boolean
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/lyrics/phraseAlignment.vocalSeparationUsed.test.ts`
Expected: PASS (3/3) — `applyRefinedAlignment` already spreads `...lyrics`, so the field round-trips.

- [ ] **Step 5: Set it at the AutoAlignFlow save site.** In `src/ai-pipeline/AutoAlignFlow.tsx`, the `applyRefinedAlignment({ ...song.lyrics, alignmentMode: 'auto', transcriptWords, gapRecoveryVersion: GAP_RECOVERY_VERSION }, ...)` call (~line 433) — add `vocalSeparationUsed: willSeparate` to that first object:

```ts
        lyrics: applyRefinedAlignment(
          { ...song.lyrics, alignmentMode: 'auto', transcriptWords, gapRecoveryVersion: GAP_RECOVERY_VERSION, vocalSeparationUsed: willSeparate },
          // ...rest unchanged
```
(Preserve the exact rest of the call. `willSeparate` is in scope from line ~182 and is `true` only when separation actually ran.)

- [ ] **Step 6: `npx tsc --noEmit` clean + full suite; commit**

Run: `npx tsc --noEmit && npx vitest run tests/lyrics/phraseAlignment.vocalSeparationUsed.test.ts`
```bash
git add src/core/types/index.ts src/ai-pipeline/AutoAlignFlow.tsx tests/lyrics/phraseAlignment.vocalSeparationUsed.test.ts
git commit --no-gpg-sign -m "feat(align): persist vocalSeparationUsed on the alignment"
```

---

## Task 2: the EditMode nudge

**Files:**
- Modify: `src/lyrics/EditMode.tsx`
- Test: `tests/lyrics/EditMode.vocalNudge.test.tsx`

- [ ] **Step 1: Write the failing test** — `tests/lyrics/EditMode.vocalNudge.test.tsx`. First read an existing EditMode test (e.g. any `tests/lyrics/EditMode*.test.tsx`) and reuse its render-props helper for the ~12 required props; then add this describe with the nudge-specific props:

```tsx
// Assumes a helper `renderEditMode(overrides)` that supplies the required props
// (lines, playhead, playheadPosition, seek, onScrubStart, onScrubEnd, hasLocalAudio:true,
//  title, artist, sourceLanguage, onChangeLines, onAutoAlign) and renders <EditMode {...} />.
// If no such helper exists, create a minimal one in this file mirroring an existing EditMode test.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditMode } from '../../src/lyrics/EditMode'
import type { TimedLine } from '../../src/core/types'

const required = () => ({
  lines: [{ original: 'a', translation: '', startTime: 0, endTime: 2 }] as TimedLine[],
  playhead: 0, playheadPosition: 0, seek: vi.fn(), onScrubStart: vi.fn(), onScrubEnd: vi.fn(),
  hasLocalAudio: true, title: 'T', artist: 'A', sourceLanguage: 'ja' as const,
  onChangeLines: vi.fn(), onAutoAlign: vi.fn(),
})

describe('EditMode "Isolate vocals" nudge', () => {
  const weak = { accurateRealignReason: 'weak-labels' as const, showAlignmentQuality: true, lineAlignmentQuality: ['needs_review' as const] }

  it('shows the nudge when the alignment is weak, separation was NOT used, and it is supported', () => {
    const onAutoAlignWithVocals = vi.fn()
    render(<EditMode {...required()} {...weak} vocalSeparationUsed={false} vocalSeparationSupported onAutoAlignWithVocals={onAutoAlignWithVocals} />)
    const btn = screen.getByRole('button', { name: /isolate vocals/i })
    expect(btn).toBeTruthy()
    btn.click()
    expect(onAutoAlignWithVocals).toHaveBeenCalledTimes(1)
  })

  it('does NOT show the nudge when vocals were already isolated', () => {
    render(<EditMode {...required()} {...weak} vocalSeparationUsed vocalSeparationSupported onAutoAlignWithVocals={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /isolate vocals/i })).toBeNull()
  })

  it('does NOT show the nudge when separation is unsupported on this device', () => {
    render(<EditMode {...required()} {...weak} vocalSeparationUsed={false} vocalSeparationSupported={false} onAutoAlignWithVocals={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /isolate vocals/i })).toBeNull()
  })

  it('does NOT show the nudge when there is no weak/off-timing hint', () => {
    render(<EditMode {...required()} vocalSeparationUsed={false} vocalSeparationSupported onAutoAlignWithVocals={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /isolate vocals/i })).toBeNull()
  })
})
```
(If the real `weak-labels` hint needs extra state to fire — e.g. a minimum `unverifiedCount` — read the `alignmentHint` computation at EditMode.tsx:485 and set the props so `alignmentHint === 'weak-labels'`. The nudge must be tied to the SAME condition.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lyrics/EditMode.vocalNudge.test.tsx`
Expected: FAIL — the props/nudge don't exist.

- [ ] **Step 3: Add the props.** In `src/lyrics/EditMode.tsx` Props interface (near `onAutoAlignAccurate?`):

```ts
  /** Whether Demucs vocal separation was used for the stored alignment. */
  vocalSeparationUsed?: boolean
  /** Whether this device can run vocal separation (gates the nudge). */
  vocalSeparationSupported?: boolean
  /** Enable "Isolate vocals for timing" and re-run Auto-align. */
  onAutoAlignWithVocals?: () => void
```
Add them to the component's destructured params (line ~303): `…, vocalSeparationUsed, vocalSeparationSupported = false, onAutoAlignWithVocals`.

- [ ] **Step 4: Render the nudge.** Immediately AFTER the `alignmentHint === 'off-timing'` block (so it appears under whichever hint fired), add:

```tsx
        {onAutoAlignWithVocals && !vocalSeparationUsed && vocalSeparationSupported &&
          (alignmentHint === 'weak-labels' || alignmentHint === 'block-timing' || alignmentHint === 'off-timing') && (
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-xs text-white/45 text-pretty flex-1 min-w-[12rem]">
              Isolating the vocals first often sharpens timing on busy or live recordings.
            </p>
            <button
              type="button"
              onClick={onAutoAlignWithVocals}
              className={`${toolbarActionBtn} self-start`}
            >
              Isolate vocals &amp; re-align
            </button>
          </div>
        )}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/lyrics/EditMode.vocalNudge.test.tsx`
Expected: PASS (4/4).

- [ ] **Step 6: `npx tsc --noEmit` clean + existing EditMode tests green; commit**

Run: `npx tsc --noEmit && npx vitest run tests/lyrics/EditMode`
```bash
git add src/lyrics/EditMode.tsx tests/lyrics/EditMode.vocalNudge.test.tsx
git commit --no-gpg-sign -m "feat(align): EditMode nudge to isolate vocals after a weak alignment"
```

---

## Task 3: PlayerView wiring

**Files:**
- Modify: `src/player/PlayerView.tsx`

- [ ] **Step 1: Add the settings reads.** Near the other `useSettingsStore` reads in PlayerView, add (import `canUseVocalSeparation` + `getDeviceTier` from `../ai-pipeline/capability` if not already imported):

```ts
  const setVocalSeparationEnabled = useSettingsStore((s) => s.setVocalSeparationEnabled)
  const vocalSeparationSupported = canUseVocalSeparation(getDeviceTier())
```

- [ ] **Step 2: Pass the new props to `<EditMode>`** (near `onAutoAlignAccurate={() => beginAlignment('auto', true)}`, line ~1326):

```tsx
              vocalSeparationUsed={song.lyrics.vocalSeparationUsed}
              vocalSeparationSupported={vocalSeparationSupported}
              onAutoAlignWithVocals={() => { setVocalSeparationEnabled(true); beginAlignment('auto') }}
```
Rationale (verified): `beginAlignment('auto')` sets `alignMode='auto'`, which lazy-mounts a fresh `AutoAlignFlow`; its vocal-separation state initializes from `useSettingsStore(s => s.vocalSeparationEnabled)`, which the preceding `setVocalSeparationEnabled(true)` just set — so the re-align runs with separation on, and the setting also sticks for future aligns.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run` (full suite — PlayerView tests + everything green).
Expected: clean; green. Confirm `canUseVocalSeparation`/`getDeviceTier` imports resolve.

- [ ] **Step 4: Commit**

```bash
git add src/player/PlayerView.tsx
git commit --no-gpg-sign -m "feat(align): wire the isolate-vocals nudge (enable + re-align) in PlayerView"
```

---

## Final verification
- [ ] Full suite: `npx vitest run` → green.
- [ ] Typecheck: `npx tsc --noEmit` → clean.
- [ ] Live (dev server): open a stored song aligned WITHOUT vocal separation that has weak/off-timing lines, enter Edit mode → the "Isolate vocals & re-align" nudge appears under the hint; clicking it enables the setting and starts Auto-align with separation. A song already aligned with separation shows NO nudge. Report a screenshot.

## Self-review notes (author)
- **Spec coverage:** persistence (T1); nudge UI gated on not-used + supported + weak/block/off hint (T2); PlayerView wiring incl. the verified enable-then-remount mechanism (T3). Back-compat: `vocalSeparationUsed?` optional; legacy `undefined` → `!vocalSeparationUsed` true → nudge eligible (intended).
- **No alignment-output change:** only a persisted boolean + UI; the field isn't read by any timing logic.
- **Type consistency:** `vocalSeparationUsed?: boolean` on both `LyricsData` and EditMode Props; the callback name `onAutoAlignWithVocals` matches across EditMode + PlayerView.
