import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { Onboarding, ONBOARDING_STORAGE_KEY } from '../../../src/core/ui/Onboarding'
import { AddSongSheet } from '../../../src/sources/AddSongSheet'
import { SettingsSheet } from '../../../src/settings/SettingsSheet'
import { PlayerControls } from '../../../src/player/PlayerControls'
import { OVERLAY_SURFACES, playerControlsBaseProps } from './overlaySurfaces'

// This mock must live in THIS file, not in overlaySurfaces.tsx. AddSongSheet/SettingsSheet are
// imported above, before OVERLAY_SURFACES, and both transitively reach src/core/opfs/audio
// (AddSongSheet -> UploadAudioFlow -> audioIngest -> saveAudio; SettingsSheet -> SettingsView ->
// core/storage/quota -> estimateOpfsAudioBytes). Vitest hoists vi.mock above every import WITHIN
// ITS OWN FILE, so declaring it here makes it apply regardless of import order; declaring it in
// the fixture instead lets the real module be captured by earlier importers. See the doc comment
// on OVERLAY_SURFACES in overlaySurfaces.tsx for the full explanation.
vi.mock('../../../src/core/opfs/audio', () => ({
  getAudioFile: vi.fn(async () => new File([], 'x.mp3')),
  estimateOpfsAudioBytes: vi.fn(async () => 0),
  deleteAudio: vi.fn(async () => {}),
  saveAudio: vi.fn(async () => {}),
  audioStoragePath: (id: string) => `songs/${id}.mp3`,
}))

// See the matching doc comment on OVERLAY_SURFACES in overlaySurfaces.tsx: the
// word-lookup popover's real dictionary lookup loads JMdict data, which is slow
// and irrelevant to this contract check.
vi.mock('../../../src/language/japanese/wordLookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/language/japanese/wordLookup')>()
  return {
    ...actual,
    lookupWord: async () => ({
      headword: 'x',
      reading: null,
      dictionaryReading: null,
      pos: null,
      posLabel: null,
      glosses: ['gloss'],
      senses: [],
      dictionaryAvailable: true,
    }),
  }
})

beforeEach(() => {
  localStorage.clear()
})

/** Every blocking overlay in the app should behave the same way: announce
 * itself, hold focus, and close on Escape. */
describe.each(OVERLAY_SURFACES)('$name as a modal dialog', ({ open, role }) => {
  it('is announced with the right role and an accessible name', async () => {
    open()
    const dialog = await screen.findByRole(role ?? 'dialog')
    // aria-modal only applies to dialog/alertdialog — a menu (role: 'menu') is
    // never modal, per Overlay's own contract (tests/core/ui/Overlay.test.tsx,
    // "does not emit aria-modal on a menu").
    if (role === 'menu') {
      expect(dialog.getAttribute('aria-modal')).toBeNull()
    } else {
      expect(dialog.getAttribute('aria-modal')).toBe('true')
    }
    expect(dialog.getAttribute('aria-label') || dialog.getAttribute('aria-labelledby')).toBeTruthy()
  })

  it('moves focus inside itself rather than leaving it on the page behind', async () => {
    open()
    const dialog = await screen.findByRole(role ?? 'dialog')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('closes on Escape', async () => {
    const expectClosed = open()
    await screen.findByRole(role ?? 'dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await expectClosed()
  })
})

describe('PlayerControls anchored menus and outside pointerdown', () => {
  // Task 8's stated goal for rows 27/28 was that both menus gain Escape *and*
  // keep working with outside pointerdown. The generic OVERLAY_SURFACES loop
  // above only asserts Escape (it shares that contract with every other
  // surface); the pointerdown half previously rested on shared-code-path
  // reasoning only ("Overlay's outside-dismiss is exercised elsewhere"). These
  // two tests make that half a real assertion instead of an inference.

  it('closes the playlist repeat-count menu on an outside pointerdown', async () => {
    render(
      <PlayerControls
        {...playerControlsBaseProps}
        playlistActive
        playlistEntries={[{ id: 'e1', a: 0, b: 4 }]}
        onTogglePlaylist={vi.fn()}
        onLoadPlaylistEntry={vi.fn()}
        onPlaylistRepeatCountChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /repeats:/i }))
    await screen.findByRole('dialog', { name: /repeats before next loop/i })

    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /repeats before next loop/i })).toBeNull())
  })

  it('closes the playback more-options menu on an outside pointerdown', async () => {
    render(<PlayerControls {...playerControlsBaseProps} showAbExport onExportAb={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /more playback options/i }))
    await screen.findByRole('dialog', { name: /more playback options/i })

    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /more playback options/i })).toBeNull())
  })
})

describe('sheets and the system Back gesture', () => {
  const goBack = async () => {
    await act(async () => {
      window.history.back()
      await new Promise((r) => setTimeout(r, 0))
    })
  }

  it('Back closes the Add-song sheet instead of leaving the app', async () => {
    window.history.replaceState(null, '', '/')
    const onClose = vi.fn()
    render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
    await screen.findByRole('dialog')

    await goBack()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('Back closes the Settings sheet', async () => {
    window.history.replaceState(null, '', '/')
    const onClose = vi.fn()
    render(<SettingsSheet onClose={onClose} />)
    await screen.findByRole('dialog')

    await goBack()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('Onboarding', () => {
  it('does not appear for a returning visitor who already dismissed it', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
    const { container } = render(<Onboarding />)
    expect(container.firstChild).toBeNull()
  })

  it('remembers the dismissal when closed with Escape', async () => {
    render(<Onboarding />)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('1'))
  })
})
