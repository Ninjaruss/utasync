import { vi, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Onboarding } from '../../../src/core/ui/Onboarding'
import { AddSongSheet } from '../../../src/sources/AddSongSheet'
import { SettingsSheet } from '../../../src/settings/SettingsSheet'
import { Overlay } from '../../../src/core/ui/Overlay'
import { ConfirmDialog } from '../../../src/core/ui/ConfirmDialog'

export interface OverlaySurface {
  /** Registry row name from docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md */
  name: string
  /** Render the surface, and return a function that asserts it has closed. */
  open: () => () => Promise<void> | void
  /** The role this surface is announced with. Defaults to 'dialog'. */
  role?: 'dialog' | 'alertdialog' | 'menu'
}

/**
 * Every layered surface that has been migrated to <Overlay>, and how to open it.
 *
 * Append a row as each surface migrates: modal-dialogs.test.tsx runs the contract over this
 * array, so registering a surface is what enrols it — no test edit required. That is the
 * difference between this and tests/player/menus.escape.test.tsx, which covers two surfaces
 * because each had to be hand-written.
 *
 * `open` returns an assertion rather than taking an onClose, because some surfaces (Onboarding)
 * own their own dismissal and report to nobody.
 *
 * `BlockingOverlay` is deliberately NOT registered here. It's a transient progress layer with no
 * exit of its own — the work finishing dismisses it, not the user — so it doesn't satisfy this
 * table's "closes on Escape" assertion. Its absence is intentional, not an oversight; adding it
 * would just fail confusingly.
 *
 * IMPORTANT — mocks belong in the consuming test file, not here: a `vi.mock(...)` declared in
 * this fixture only patches modules that are first resolved *through* the fixture's own import
 * graph. `modal-dialogs.test.tsx` imports `AddSongSheet` and `SettingsSheet` directly, before it
 * imports this file, so by the time this file's (hoisted) `vi.mock` would run, those components
 * and their dependency subgraph — including the real `src/core/opfs/audio` — are already loaded
 * and cached under the unmocked module identity. Every file that consumes `OVERLAY_SURFACES` and
 * renders `AddSongSheet`/`SettingsSheet` must declare this mock itself:
 *
 *   vi.mock('../../../src/core/opfs/audio', () => ({
 *     getAudioFile: vi.fn(async () => new File([], 'x.mp3')),
 *     estimateOpfsAudioBytes: vi.fn(async () => 0),
 *     deleteAudio: vi.fn(async () => {}),
 *     saveAudio: vi.fn(async () => {}),
 *     audioStoragePath: (id: string) => `songs/${id}.mp3`,
 *   }))
 *
 * Vitest hoists `vi.mock` above every import within its own file, so this only works when placed
 * directly in the file doing the importing — not here.
 */
export const OVERLAY_SURFACES: OverlaySurface[] = [
  {
    // Not registered in OVERLAY_SURFACES beyond this row's own contract check:
    // Onboarding takes no props and owns its own dismiss, so there is no onClose
    // to inject into the contract's render(onClose) shape. Giving it one is a
    // Phase 3 concern, when the screen model owns first-run state.
    name: 'Onboarding',
    open: () => {
      render(<Onboarding />)
      // It closes itself rather than reporting up, so observe the DOM.
      return () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    },
  },
  {
    name: 'AddSongSheet',
    open: () => {
      const onClose = vi.fn()
      render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
      return () => waitFor(() => expect(onClose).toHaveBeenCalled())
    },
  },
  {
    name: 'SettingsSheet',
    open: () => {
      const onClose = vi.fn()
      render(<SettingsSheet onClose={onClose} />)
      return () => waitFor(() => expect(onClose).toHaveBeenCalled())
    },
  },
  {
    name: 'row 23 — generic confirm dialog',
    role: 'alertdialog',
    open: () => {
      const onCancel = vi.fn()
      render(
        <ConfirmDialog
          title="Discard changes?"
          message="Your edits will be lost."
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      )
      return () => waitFor(() => expect(onCancel).toHaveBeenCalled())
    },
  },
  {
    name: 'primitive — bare sheet',
    open: () => {
      const onClose = vi.fn()
      render(
        <Overlay onClose={onClose} label="Bare sheet">
          <button type="button">inside</button>
        </Overlay>,
      )
      return () => waitFor(() => expect(onClose).toHaveBeenCalled())
    },
  },
]
